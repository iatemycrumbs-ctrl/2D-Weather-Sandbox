onmessage = (event) => {
  const msg = event.data || {};
  const width = Math.max(96, Math.floor(msg.width || 1024));
  const height = Math.max(192, Math.floor(msg.height || 2048));
  const seed = (msg.seed == null) ? ((Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0) : (msg.seed >>> 0);

  const img = generateLightningImage(width, height, seed);
  const luminanceData = imageDataToLuminance(img);

  postMessage({
    id : msg.id,
    width,
    height,
    luminanceData
  }, [ luminanceData.buffer ]);
};

function generateLightningImage(width, height, seed)
{
  const rng = createRng(seed);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);

  const rootX = width * (0.35 + rng() * 0.3);
  const bolt = generateChannel(rootX, -8, {
    targetY : height + 8,
    drift : (rng() - 0.5) * 0.22,
    jitter : 0.9,
    step : 2.4,
    width : 5.0,
    branchChance : 0.055,
    maxDepth : 3
  }, rng, 0, height);

  renderChannel(ctx, bolt, true);

  // atmospheric halo / flash bloom
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = 'rgba(125, 180, 255, 0.10)';
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';

  return ctx.getImageData(0, 0, width, height);
}

function generateChannel(startX, startY, params, rng, depth, canvasHeight)
{
  const points = [ [ startX, startY ] ];
  let x = startX;
  let y = startY;
  let angle = 0.0;

  const targetY = params.targetY;
  const step = params.step * (0.8 + rng() * 0.5);
  const drift = params.drift;
  const jitter = params.jitter;
  const width = params.width;
  const branches = [];

  while (y < targetY) {
    angle += (rng() - 0.5) * jitter;
    angle *= 0.72;

    x += Math.sin(angle) * step * 0.9 + drift * step;
    y += Math.max(0.6, Math.cos(angle) * step);

    points.push([ x, y ]);

    const progress = y / Math.max(canvasHeight, 1);
    const branchBias = Math.max(0.0, 1.0 - progress * 1.05);
    if (depth < params.maxDepth && rng() < params.branchChance * branchBias) {
      const branchTarget = y + (canvasHeight * (0.12 + rng() * 0.32));
      const branch = generateChannel(x, y, {
        targetY : Math.min(targetY, branchTarget),
        drift : drift + (rng() - 0.5) * 0.55,
        jitter : jitter * 0.9,
        step : step * (0.75 + rng() * 0.2),
        width : Math.max(0.65, width * (0.45 + rng() * 0.2)),
        branchChance : params.branchChance * 0.52,
        maxDepth : params.maxDepth
      }, rng, depth + 1, canvasHeight);
      branches.push(branch);
    }
  }

  return { points, width, depth, branches };
}

function renderChannel(ctx, channel, isMain)
{
  const points = channel.points;
  if (points.length < 2)
    return;

  const glowWidth = channel.width * (isMain ? 3.8 : 2.9);
  const midWidth = channel.width * (isMain ? 1.75 : 1.35);
  const coreWidth = Math.max(0.55, channel.width * 0.55);

  strokePolyline(ctx, points, glowWidth, 'rgba(120, 190, 255, 0.16)');
  strokePolyline(ctx, points, midWidth, 'rgba(170, 220, 255, 0.56)');
  strokePolyline(ctx, points, coreWidth, 'rgba(250, 255, 255, 0.95)');

  for (let i = 0; i < channel.branches.length; i++) {
    renderChannel(ctx, channel.branches[i], false);
  }
}

function strokePolyline(ctx, points, lineWidth, strokeStyle)
{
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = strokeStyle;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function imageDataToLuminance(imgData)
{
  const src = imgData.data;
  const luminance = new Uint8Array(imgData.width * imgData.height);
  for (let i = 0, j = 0; i < src.length; i += 4, j++) {
    const l = Math.max(src[i], src[i + 1], src[i + 2]);
    luminance[j] = l;
  }
  return luminance;
}

function createRng(seed)
{
  let state = (seed || 1) >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) / 4294967296);
  };
}
