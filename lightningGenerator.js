onmessage = (event) => {
  const msg = event.data || {};
  const width = Math.max(96, Math.floor(msg.width || 1024));
  const height = Math.max(192, Math.floor(msg.height || 2048));
  const seed = (msg.seed ?? Date.now()) >>> 0;

  try {
    const profile = normalizeLightningProfile(msg.profile || {});
    const result = generateLightningLuminance(width, height, seed, profile);
    postMessage({id : msg.id, width, height, luminanceData : result.luminanceData}, [ result.luminanceData.buffer ]);
  } catch (err) {
    const fallback = new Uint8Array(width * height);
    postMessage({id : msg.id, width, height, luminanceData : fallback, error : String(err)}, [ fallback.buffer ]);
  }
};

function normalizeLightningProfile(profile)
{
  const style = typeof profile.style == 'string' ? profile.style : 'Forked Classic';
  const branchScale = Number.isFinite(profile.branchScale) ? clamp(profile.branchScale, 0.45, 3.0) : 1.0;
  const complexity = Number.isFinite(profile.complexity) ? clamp(profile.complexity, 0.45, 3.0) : 1.0;
  return {style, branchScale, complexity};
}

function clamp(v, lo, hi)
{
  return Math.min(Math.max(v, lo), hi);
}

function createRng(seed)
{
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

function generateLightningLuminance(width, height, seed, profile)
{
  const luminanceData = new Uint8Array(width * height);
  const rng = createRng(seed);

  const stylePhase = profile.style == 'Chaotic Fractal' ? 1.42 : profile.style == 'Branch Spider' ? 1.26 : profile.style == 'Ribbon Arc' ? 0.86 : 1.0;
  const trunkPoints = [];

  let x = width * (0.5 + (rng() - 0.5) * 0.10);
  let y = 0;
  let heading = (rng() - 0.5) * 0.20;

  const segments = Math.max(820, Math.floor(height * (1.3 + profile.complexity * 0.95)));
  const baseStepY = height / segments;

  trunkPoints.push({x, y});

  for (let i = 0; i < segments && y < height - 1; i++) {
    const t = i / Math.max(segments - 1, 1);
    const dx = Math.sin(heading) * (0.45 + baseStepY * 0.33);
    const dy = Math.max(0.24, Math.cos(heading) * (baseStepY * 1.30));

    const nx = x + dx;
    const ny = y + dy;

    const trunkRadius = (1.50 + (1.0 - t) * 1.2) * (1.15 / stylePhase);
    const trunkLum = Math.floor(198 + (1.0 - t) * 44);
    stampSegment(luminanceData, width, height, x, y, nx, ny, trunkRadius, trunkLum);

    if (rng() < (0.0065 + (1.0 - t) * 0.012) * profile.branchScale * (0.88 + profile.complexity * 0.28)) {
      const branchAngle = heading + (rng() < 0.5 ? -1 : 1) * (0.32 + rng() * 0.74) * stylePhase;
      const branchLen = Math.floor((height * (0.075 + rng() * 0.18)) * (0.66 + (1.0 - t) * 0.70));
      drawBranch(luminanceData, width, height, rng, nx, ny, branchAngle, branchLen, profile, stylePhase, 0);
    }

    trunkPoints.push({x : nx, y : ny});
    x = nx;
    y = ny;

    heading += (rng() - 0.5) * (0.36 * stylePhase + (1.0 - t) * 0.22 * profile.complexity);
    heading *= 0.88;
  }

  bridgeSparseGaps(luminanceData, width, height);
  reinforceTrunk(luminanceData, width, height, trunkPoints);
  filterDisconnectedLightning(luminanceData, width, height, trunkPoints);

  return {luminanceData};
}

function drawBranch(luminanceData, width, height, rng, sx, sy, heading, maxLenPx, profile, stylePhase, depth)
{
  if (depth > 5)
    return;

  let x = sx;
  let y = sy;
  let traveled = 0;

  const step = 1.25;
  const recurseChance = clamp(0.042 * profile.branchScale * (0.95 + profile.complexity * 0.25), 0.01, 0.26);

  while (traveled < maxLenPx && y >= 0 && y < height && x >= -2 && x <= width + 2) {
    const nx = x + Math.sin(heading) * step;
    const ny = y + Math.cos(heading) * step;

    const life = 1.0 - traveled / Math.max(maxLenPx, 1);
    const radius = (0.95 + life * 0.9) * (0.70 + profile.complexity * 0.22);
    const lum = Math.floor(126 + life * 98);
    stampSegment(luminanceData, width, height, x, y, nx, ny, radius, lum);

    if (rng() < recurseChance * life) {
      const splitHeading = heading + (rng() < 0.5 ? -1 : 1) * (0.35 + rng() * 0.74) * stylePhase;
      drawBranch(luminanceData, width, height, rng, nx, ny, splitHeading, maxLenPx * (0.40 + rng() * 0.38), profile, stylePhase, depth + 1);
    }

    x = nx;
    y = ny;
    traveled += step;

    heading += (rng() - 0.5) * 0.42 * stylePhase;
    heading *= 0.985;
  }
}

function stampSegment(luminanceData, width, height, x0, y0, x1, y1, radius, lum)
{
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.max(Math.hypot(dx, dy), 0.001);
  const steps = Math.ceil(dist * 1.2);

  for (let i = 0; i <= steps; i++) {
    const t = i / Math.max(steps, 1);
    const px = x0 + dx * t;
    const py = y0 + dy * t;
    stampDisc(luminanceData, width, height, px, py, radius, lum);
  }
}

function stampDisc(luminanceData, width, height, cx, cy, radius, lum)
{
  const r = Math.max(radius, 0.55);
  const minX = Math.max(0, Math.floor(cx - r - 1));
  const maxX = Math.min(width - 1, Math.ceil(cx + r + 1));
  const minY = Math.max(0, Math.floor(cy - r - 1));
  const maxY = Math.min(height - 1, Math.ceil(cy + r + 1));
  const invR = 1.0 / Math.max(r, 0.001);

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dist = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) * invR;
      if (dist > 1.45)
        continue;
      const falloff = clamp(1.25 - dist, 0.0, 1.0);
      const value = Math.floor(lum * falloff);
      const idx = y * width + x;
      if (value > luminanceData[idx])
        luminanceData[idx] = value;
    }
  }
}

function reinforceTrunk(luminanceData, width, height, trunkPoints)
{
  if (!trunkPoints || trunkPoints.length < 2)
    return;

  for (let i = 1; i < trunkPoints.length; i++) {
    stampSegment(
      luminanceData,
      width,
      height,
      trunkPoints[i - 1].x,
      trunkPoints[i - 1].y,
      trunkPoints[i].x,
      trunkPoints[i].y,
      1.15,
      236
    );
  }
}

function bridgeSparseGaps(luminanceData, width, height)
{
  const src = luminanceData.slice();
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (src[idx] >= 24)
        continue;

      const l = src[idx - 1];
      const r = src[idx + 1];
      const u = src[idx - width];
      const d = src[idx + width];
      const ul = src[idx - width - 1];
      const ur = src[idx - width + 1];
      const dl = src[idx + width - 1];
      const dr = src[idx + width + 1];

      const hv = (l >= 68 && r >= 68) || (u >= 68 && d >= 68);
      const diag = (ul >= 60 && dr >= 60) || (ur >= 60 && dl >= 60);
      if (!hv && !diag)
        continue;

      const bridge = Math.max(
        Math.min(l, r),
        Math.min(u, d),
        Math.min(ul, dr),
        Math.min(ur, dl)
      );
      luminanceData[idx] = Math.max(luminanceData[idx], Math.floor(bridge * 0.72));
    }
  }
}

function filterDisconnectedLightning(luminanceData, width, height, trunkPoints)
{
  const connectedMask = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const threshold = 24;

  if (trunkPoints && trunkPoints.length > 0) {
    const seedCount = Math.min(6, trunkPoints.length);
    for (let i = 0; i < seedCount; i++) {
      const x = Math.round(trunkPoints[i].x);
      const y = Math.round(trunkPoints[i].y);
      if (x < 0 || x >= width || y < 0 || y >= height)
        continue;
      const idx = y * width + x;
      connectedMask[idx] = 1;
      queue[tail++] = idx;
    }
  }

  if (tail == 0) {
    for (let x = 0; x < width; x++) {
      const idx = x;
      if (luminanceData[idx] >= threshold) {
        connectedMask[idx] = 1;
        queue[tail++] = idx;
      }
    }
  }

  while (head < tail) {
    const idx = queue[head++];
    const x = idx % width;
    const y = (idx / width) | 0;

    for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
      for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
        const nIdx = ny * width + nx;
        if (connectedMask[nIdx] || luminanceData[nIdx] < threshold)
          continue;
        connectedMask[nIdx] = 1;
        queue[tail++] = nIdx;
      }
    }
  }

  for (let i = 0; i < luminanceData.length; i++) {
    if (!connectedMask[i])
      luminanceData[i] = 0;
  }
}
