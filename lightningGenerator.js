onmessage = (event) => {
  const msg = event.data || {};
  const width = Math.max(96, Math.floor(msg.width || 1024));
  const height = Math.max(192, Math.floor(msg.height || 2048));
  const seed = (msg.seed ?? Date.now()) >>> 0;

  try {
    const luminanceData = generateLightningLuminance(width, height, seed);
    postMessage({id : msg.id, width, height, luminanceData}, [ luminanceData.buffer ]);
  } catch (err) {
    const fallback = new Uint8Array(width * height);
    postMessage({id : msg.id, width, height, luminanceData : fallback, error : String(err)}, [ fallback.buffer ]);
  }
};

function generateLightningLuminance(width, height, seed)
{
  const out = new Uint8Array(width * height);

  let rngState = seed || 1;
  function rand()
  {
    rngState = (1664525 * rngState + 1013904223) >>> 0;
    return rngState / 4294967296;
  }

  const trunk = [];
  let x = width * (0.5 + (rand() - 0.5) * 0.06);
  let y = 0;
  let heading = (rand() - 0.5) * 0.10;
  const segments = Math.max(180, Math.floor(height * 0.72));
  const stepY = height / segments;
  let targetOffset = (rand() - 0.5) * 0.24;

  trunk.push({x, y});

  for (let i = 0; i < segments && y < height - 1; i++) {
    const t = i / Math.max(segments - 1, 1);

    if (i % 8 === 0)
      targetOffset = (rand() - 0.5) * mix(0.42, 0.20, t);

    heading = mix(heading, targetOffset, 0.38);
    heading += (rand() - 0.5) * 0.08;

    const dx = heading * (1.1 + stepY * 0.45);
    const dy = Math.max(1.0, stepY * (1.55 + (rand() - 0.5) * 0.32));

    const nx = clamp(x + dx, 1, width - 2);
    const ny = clamp(y + dy, 1, height - 2);

    const trunkLum = Math.floor(mix(255.0, 184.0, t));
    drawStroke(out, width, height, x, y, nx, ny, trunkLum, mix(2.1, 1.2, t));
    trunk.push({x : nx, y : ny});

    const branchChance = mix(0.11, 0.03, t);
    if (rand() < branchChance) {
      const branchDir = heading + (rand() < 0.5 ? -1.0 : 1.0) * mix(0.55, 1.0, rand());
      drawBranch(out, width, height, nx, ny, branchDir, mix(22, 8, t), trunkLum * 0.78, rand);
    }

    x = nx;
    y = ny;
  }

  for (let i = 0; i < trunk.length; i++) {
    const p = trunk[i];
    const coreLum = Math.floor(mix(250.0, 210.0, i / Math.max(trunk.length - 1, 1)));
    stampCircle(out, width, height, p.x, p.y, 0.7, coreLum);
  }

  bridgeSparseGaps(out, width, height);
  softenLightningGrain(out, width, height);
  keepConnectedToTrunk(out, width, height, trunk);

  return out;
}

function softenLightningGrain(data, width, height)
{
  const src = data.slice();
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (src[idx] < 8)
        continue;
      const avg = (src[idx] * 4 + src[idx - 1] + src[idx + 1] + src[idx - width] + src[idx + width]) / 8;
      data[idx] = Math.max(data[idx], Math.floor(avg));
    }
  }
}

function drawBranch(out, width, height, startX, startY, heading, budget, baseLum, rand)
{
  let x = startX;
  let y = startY;
  let remaining = budget;
  let lum = baseLum;

  while (remaining > 0.0 && x > 1 && x < width - 2 && y > 1 && y < height - 2) {
    const step = mix(1.1, 2.6, rand());
    heading += (rand() - 0.5) * 0.26;
    heading *= 0.96;

    const nx = x + heading * step * 1.15;
    const ny = y + step * (0.95 + rand() * 0.35);
    drawStroke(out, width, height, x, y, nx, ny, lum, 0.9);

    if (rand() < 0.06 && remaining > 8.0) {
      const twigDir = heading + (rand() < 0.5 ? -1.0 : 1.0) * mix(0.65, 1.25, rand());
      const twigLen = remaining * mix(0.28, 0.44, rand());
      drawBranch(out, width, height, nx, ny, twigDir, twigLen, lum * 0.72, rand);
    }

    x = nx;
    y = ny;
    remaining -= step;
    lum *= 0.96;

    if (lum < 24)
      break;
  }
}

function drawStroke(out, width, height, x0, y0, x1, y1, lum, radius)
{
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.max(1, Math.ceil(Math.hypot(dx, dy)));

  for (let i = 0; i <= len; i++) {
    const t = i / len;
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    stampCircle(out, width, height, x, y, radius, lum);
  }
}

function stampCircle(out, width, height, cx, cy, radius, lum)
{
  const r = Math.max(0.4, radius);
  const minX = Math.floor(cx - r);
  const maxX = Math.ceil(cx + r);
  const minY = Math.floor(cy - r);
  const maxY = Math.ceil(cy + r);

  for (let y = minY; y <= maxY; y++) {
    if (y < 0 || y >= height)
      continue;
    for (let x = minX; x <= maxX; x++) {
      if (x < 0 || x >= width)
        continue;
      const dist = Math.hypot(x - cx, y - cy);
      if (dist > r)
        continue;
      const falloff = 1.0 - dist / Math.max(r, 0.0001);
      const value = Math.floor(lum * (0.65 + falloff * 0.35));
      const idx = y * width + x;
      out[idx] = Math.max(out[idx], value);
    }
  }
}

function bridgeSparseGaps(data, width, height)
{
  const src = data.slice();
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (src[idx] >= 20)
        continue;
      const left = src[idx - 1];
      const right = src[idx + 1];
      const up = src[idx - width];
      const down = src[idx + width];
      const ul = src[idx - width - 1];
      const ur = src[idx - width + 1];
      const dl = src[idx + width - 1];
      const dr = src[idx + width + 1];
      const straight = (left >= 55 && right >= 55) || (up >= 55 && down >= 55);
      const diagonal = (ul >= 60 && dr >= 60) || (ur >= 60 && dl >= 60);
      if (straight || diagonal) {
        const m = Math.max(Math.min(left, right), Math.min(up, down), Math.min(ul, dr), Math.min(ur, dl));
        data[idx] = Math.max(data[idx], Math.floor(m * 0.7));
      }
    }
  }
}

function keepConnectedToTrunk(data, width, height, trunk)
{
  if (!trunk.length)
    return;
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;

  for (let i = 0; i < trunk.length; i++) {
    const x = Math.round(trunk[i].x);
    const y = Math.round(trunk[i].y);
    if (x < 0 || x >= width || y < 0 || y >= height)
      continue;
    const idx = y * width + x;
    if (visited[idx])
      continue;
    visited[idx] = 1;
    queue[tail++] = idx;
  }

  while (head < tail) {
    const idx = queue[head++];
    const x = idx % width;
    const y = (idx / width) | 0;

    for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
      for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
        const nIdx = ny * width + nx;
        if (visited[nIdx] || data[nIdx] <= 0)
          continue;
        visited[nIdx] = 1;
        queue[tail++] = nIdx;
      }
    }
  }

  for (let i = 0; i < data.length; i++) {
    if (!visited[i])
      data[i] = 0;
  }
}

function clamp(v, lo, hi)
{
  return Math.min(Math.max(v, lo), hi);
}

function mix(a, b, t)
{
  return a + (b - a) * t;
}
