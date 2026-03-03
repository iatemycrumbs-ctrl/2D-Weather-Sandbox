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

function getStyleTuning(profile)
{
  if (profile.style == 'Chaotic Fractal') {
    return {meander : 1.18, branchProb : 1.25, branchLen : 1.15, trunkWidth : 0.95};
  }
  if (profile.style == 'Branch Spider') {
    return {meander : 1.08, branchProb : 1.35, branchLen : 0.95, trunkWidth : 0.92};
  }
  if (profile.style == 'Ribbon Arc') {
    return {meander : 0.82, branchProb : 0.78, branchLen : 1.05, trunkWidth : 1.22};
  }
  return {meander : 1.0, branchProb : 1.0, branchLen : 1.0, trunkWidth : 1.0};
}

function generateLightningLuminance(width, height, seed, profile)
{
  const luminanceData = new Uint8Array(width * height);
  const rng = createRng(seed);
  const style = getStyleTuning(profile);
  const trunkPoints = [];

  let x = width * (0.5 + (rng() - 0.5) * 0.08);
  let y = 0;
  let heading = (rng() - 0.5) * 0.12;

  const segments = Math.max(960, Math.floor(height * (1.58 + profile.complexity * 1.05)));
  const baseStepY = height / segments;

  trunkPoints.push({x, y});

  for (let i = 0; i < segments && y < height - 1; i++) {
    const t = i / Math.max(segments - 1, 1);
    const leaderPulse = 0.88 + Math.sin((t * 24.0 + rng() * 0.4) * Math.PI) * 0.16;
    const dx = Math.sin(heading) * (0.30 + baseStepY * 0.22) * leaderPulse;
    const dy = Math.max(0.22, Math.cos(heading) * (baseStepY * (1.42 + (1.0 - t) * 0.14)));

    const nx = x + dx;
    const ny = y + dy;

    const trunkRadius = (1.70 + (1.0 - t) * 1.35) * style.trunkWidth;
    const trunkLum = Math.floor(214 + (1.0 - t) * 38);
    stampSegment(luminanceData, width, height, x, y, nx, ny, trunkRadius, trunkLum);

    const branchChance = (0.010 + (1.0 - t) * 0.016) * profile.branchScale * (0.78 + profile.complexity * 0.34) * style.branchProb;
    if (rng() < branchChance) {
      const branchCount = rng() < 0.16 * profile.branchScale ? 2 : 1;
      for (let b = 0; b < branchCount; b++) {
        const side = rng() < 0.5 ? -1 : 1;
        const branchAngle = heading + side * (0.36 + rng() * 0.62);
        const branchLen = Math.floor((height * (0.08 + rng() * 0.22)) * (0.55 + (1.0 - t) * 0.72) * style.branchLen);
        drawBranch(luminanceData, width, height, rng, nx, ny, branchAngle, branchLen, profile, style, 0);
      }
    }

    trunkPoints.push({x : nx, y : ny});
    x = nx;
    y = ny;

    const meander = (rng() - 0.5) * (0.28 + (1.0 - t) * 0.20 * profile.complexity) * style.meander;
    const stratificationPull = (x / Math.max(width, 1) - 0.5) * -0.028;
    heading = (heading + meander + stratificationPull) * 0.90;
  }

  bridgeSparseGaps(luminanceData, width, height);
  reinforceTrunk(luminanceData, width, height, trunkPoints);
  filterDisconnectedLightning(luminanceData, width, height, trunkPoints);

  return {luminanceData};
}

function drawBranch(luminanceData, width, height, rng, sx, sy, heading, maxLenPx, profile, style, depth)
{
  if (depth > 6)
    return;

  let x = sx;
  let y = sy;
  let traveled = 0;

  const step = 1.15;
  const recurseChance = clamp(0.048 * profile.branchScale * (0.90 + profile.complexity * 0.30) * style.branchProb, 0.01, 0.32);

  while (traveled < maxLenPx && y >= -2 && y < height + 2 && x >= -2 && x <= width + 2) {
    const nx = x + Math.sin(heading) * step;
    const ny = y + Math.cos(heading) * step;

    const life = 1.0 - traveled / Math.max(maxLenPx, 1);
    const radius = (0.75 + life * 0.82) * (0.68 + profile.complexity * 0.24) * style.trunkWidth;
    const lum = Math.floor(132 + life * 92);
    stampSegment(luminanceData, width, height, x, y, nx, ny, radius, lum);

    if (life > 0.25 && rng() < recurseChance * life) {
      const splitHeading = heading + (rng() < 0.5 ? -1 : 1) * (0.38 + rng() * 0.66) * style.meander;
      drawBranch(luminanceData, width, height, rng, nx, ny, splitHeading, maxLenPx * (0.32 + rng() * 0.36), profile, style, depth + 1);
    }

    x = nx;
    y = ny;
    traveled += step;

    const gravityPull = y > sy ? -0.006 : 0.0;
    heading = (heading + (rng() - 0.5) * 0.30 * style.meander + gravityPull) * 0.986;
  }
}

function stampSegment(luminanceData, width, height, x0, y0, x1, y1, radius, lum)
{
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.max(Math.hypot(dx, dy), 0.001);
  const steps = Math.ceil(dist * 1.25);

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
      const falloff = clamp(1.28 - dist, 0.0, 1.0);
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
    const t = i / Math.max(trunkPoints.length - 1, 1);
    stampSegment(
      luminanceData,
      width,
      height,
      trunkPoints[i - 1].x,
      trunkPoints[i - 1].y,
      trunkPoints[i].x,
      trunkPoints[i].y,
      1.22 + (1.0 - t) * 0.28,
      Math.floor(236 + (1.0 - t) * 12)
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
    const seedCount = Math.min(10, trunkPoints.length);
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
