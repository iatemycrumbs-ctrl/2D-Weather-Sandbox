onmessage = (event) => {
  const msg = event.data || {};
  const width = Math.max(96, Math.floor(msg.width || 1024));
  const height = Math.max(192, Math.floor(msg.height || 2048));
  const seed = (msg.seed == null) ? ((Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0) : (msg.seed >>> 0);
  const profile = msg.profile || {};

  const img = generateLightningImage(width, height, seed, profile);
  const luminanceData = imageDataToLuminance(img);

  postMessage({
    id : msg.id,
    width,
    height,
    luminanceData
  }, [ luminanceData.buffer ]);
};

function generateLightningImage(width, height, seed, profile)
{
  const rng = createRng(seed);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  const style = String(profile.style || 'Forked Classic');
  const complexity = clamp(profile.complexity == null ? 1.0 : profile.complexity, 0.4, 2.8);
  const branchScale = clamp(profile.branchScale == null ? 1.0 : profile.branchScale, 0.5, 6.0);

  const boltCount = style == 'Ribbon Arc' ? 3 : (style == 'Chaotic Fractal' ? 5 : 4);

  for (let i = 0; i < boltCount; i++) {
    const channel = createModeChannel(width, height, rng, style, complexity, branchScale, i / Math.max(1, boltCount - 1));
    renderChannel(ctx, channel, true, style);
  }

  // mode-aware atmospheric bloom
  ctx.globalCompositeOperation = 'screen';
  if (style == 'Ribbon Arc')
    ctx.fillStyle = 'rgba(150, 130, 255, 0.11)';
  else if (style == 'Chaotic Fractal')
    ctx.fillStyle = 'rgba(150, 215, 255, 0.13)';
  else
    ctx.fillStyle = 'rgba(120, 190, 255, 0.10)';
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';

  return ctx.getImageData(0, 0, width, height);
}

function createModeChannel(width, height, rng, style, complexity, branchScale, channelT)
{
  let rootX = width * (0.2 + rng() * 0.6);
  let startY = -8;
  let targetY = height + 10;
  let drift = (rng() - 0.5) * 0.2;
  let jitter = 0.9;
  let step = 2.3;
  let baseWidth = 4.6;
  let branchChance = 0.05;
  let maxDepth = 3;

  if (style == 'Ribbon Arc') {
    targetY = height * (0.82 + rng() * 0.14);
    jitter = 0.55;
    drift = (rng() - 0.5) * 0.5;
    step = 2.0;
    baseWidth = 4.2;
    branchChance = 0.03;
    maxDepth = 2;
  } else if (style == 'Branch Spider') {
    startY = height * (0.35 + rng() * 0.22);
    targetY = height * (0.92 + rng() * 0.05);
    jitter = 1.1;
    drift = (rng() - 0.5) * 0.35;
    step = 2.05;
    baseWidth = 4.8;
    branchChance = 0.10;
    maxDepth = 4;
  } else if (style == 'Chaotic Fractal') {
    jitter = 1.3;
    drift = (rng() - 0.5) * 0.5;
    step = 1.9;
    baseWidth = 4.9;
    branchChance = 0.14;
    maxDepth = 5;
  }

  rootX += (channelT - 0.5) * width * 0.16;

  return generateChannel(rootX, startY, {
    targetY,
    drift,
    jitter : jitter * mapRange(complexity, 0.4, 2.8, 0.8, 1.45),
    step : step * mapRange(complexity, 0.4, 2.8, 0.75, 1.22),
    width : baseWidth * mapRange(complexity, 0.4, 2.8, 0.8, 1.35),
    branchChance : branchChance * mapRange(branchScale, 0.5, 6.0, 0.65, 2.4),
    maxDepth
  }, rng, 0, height, style);
}

function generateChannel(startX, startY, params, rng, depth, canvasHeight, style)
{
  const points = [ [ startX, startY ] ];
  let x = startX;
  let y = startY;
  let angle = 0.0;

  const targetY = params.targetY;
  const step = params.step * (0.82 + rng() * 0.46);
  const drift = params.drift;
  const jitter = params.jitter;
  const width = params.width;
  const branches = [];

  while (y < targetY) {
    angle += (rng() - 0.5) * jitter;
    angle *= (style == 'Ribbon Arc') ? 0.80 : 0.72;

    x += Math.sin(angle) * step * 0.9 + drift * step;
    y += Math.max(0.52, Math.cos(angle) * step);

    points.push([ x, y ]);

    const progress = y / Math.max(canvasHeight, 1);
    const branchBias = Math.max(0.0, 1.0 - progress * (style == 'Ribbon Arc' ? 0.92 : 1.05));
    if (depth < params.maxDepth && rng() < params.branchChance * branchBias) {
      const branch = generateChannel(x, y, {
        targetY : Math.min(targetY, y + canvasHeight * (0.10 + rng() * 0.28)),
        drift : drift + (rng() - 0.5) * (style == 'Chaotic Fractal' ? 0.9 : 0.6),
        jitter : jitter * (style == 'Ribbon Arc' ? 0.8 : 0.9),
        step : step * (0.72 + rng() * 0.25),
        width : Math.max(0.50, width * (0.42 + rng() * 0.24)),
        branchChance : params.branchChance * 0.55,
        maxDepth : params.maxDepth
      }, rng, depth + 1, canvasHeight, style);
      branches.push(branch);
    }
  }

  return { points, width, branches, depth, style };
}

function renderChannel(ctx, channel, isMain, style)
{
  if (channel.points.length < 2)
    return;

  const glowWidth = channel.width * (isMain ? 4.0 : 3.0);
  const midWidth = channel.width * (isMain ? 1.9 : 1.35);
  const coreWidth = Math.max(0.5, channel.width * 0.56);

  let glowCol = 'rgba(120, 190, 255, 0.16)';
  let midCol = 'rgba(170, 220, 255, 0.60)';
  let coreCol = 'rgba(250, 255, 255, 0.96)';

  if (style == 'Ribbon Arc') {
    glowCol = 'rgba(180, 120, 255, 0.16)';
    midCol = 'rgba(210, 170, 255, 0.58)';
    coreCol = 'rgba(250, 240, 255, 0.95)';
  } else if (style == 'Chaotic Fractal') {
    glowCol = 'rgba(130, 210, 255, 0.19)';
    midCol = 'rgba(185, 235, 255, 0.62)';
  }

  strokePolyline(ctx, channel.points, glowWidth, glowCol);
  strokePolyline(ctx, channel.points, midWidth, midCol);
  strokePolyline(ctx, channel.points, coreWidth, coreCol);

  for (let i = 0; i < channel.branches.length; i++) {
    renderChannel(ctx, channel.branches[i], false, style);
  }
}

function strokePolyline(ctx, points, lineWidth, strokeStyle)
{
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++)
    ctx.lineTo(points[i][0], points[i][1]);
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = strokeStyle;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function imageDataToLuminance(imgData)
{
  const src = imgData.data;
  const out = new Uint8Array(imgData.width * imgData.height);
  for (let i = 0, j = 0; i < src.length; i += 4, j++)
    out[j] = Math.max(src[i], src[i + 1], src[i + 2]);
  return out;
}

function createRng(seed)
{
  let state = (seed || 1) >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function mapRange(v, inMin, inMax, outMin, outMax)
{
  const t = clamp((v - inMin) / Math.max(inMax - inMin, 1e-6), 0.0, 1.0);
  return outMin + (outMax - outMin) * t;
}
