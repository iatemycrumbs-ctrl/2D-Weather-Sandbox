function createRng(seed)
{
  let state = (seed >>> 0) || 1;
  return function rand()
  {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function clamp(num, min, max)
{
  return Math.min(Math.max(num, min), max);
}

function getQualityConfig(quality)
{
  if (quality == 'low') {
    return {
      leaderSteps : 520,
      branchMaxSteps : 110,
      branchSpawnChance : 0.095,
      maxBranchDepth : 2,
      dartLeaderCount : 1,
      haloWidth : 2.9,
      glowWidth : 1.7,
      branchWidth : 0.85,
      coreWidth : 0.42,
      haloAlpha : 0.18,
      glowAlpha : 0.40,
      returnStrokeAlpha : 0.52,
      branchDecay : 0.970,
      minGroundCoverage : 0.90,
      minVisibleBranches : 30
    };
  }

  if (quality == 'medium') {
    return {
      leaderSteps : 720,
      branchMaxSteps : 170,
      branchSpawnChance : 0.128,
      maxBranchDepth : 3,
      dartLeaderCount : 2,
      haloWidth : 3.6,
      glowWidth : 2.05,
      branchWidth : 0.93,
      coreWidth : 0.49,
      haloAlpha : 0.23,
      glowAlpha : 0.50,
      returnStrokeAlpha : 0.68,
      branchDecay : 0.974,
      minGroundCoverage : 0.94,
      minVisibleBranches : 42
    };
  }

  return {
    leaderSteps : 920,
    branchMaxSteps : 230,
    branchSpawnChance : 0.162,
    maxBranchDepth : 4,
    dartLeaderCount : 3,
    haloWidth : 4.3,
    glowWidth : 2.35,
    branchWidth : 1.0,
    coreWidth : 0.56,
    haloAlpha : 0.30,
    glowAlpha : 0.62,
    returnStrokeAlpha : 0.80,
    branchDecay : 0.978,
    minGroundCoverage : 0.97,
    minVisibleBranches : 58
  };
}

onmessage = (event) => {
  const msg = event.data || {};
  const width = Math.max(96, Math.floor(msg.width || 1024));
  const height = Math.max(192, Math.floor(msg.height || 2048));
  const seed = (msg.seed ?? ((Date.now() ^ (width * 2654435761)) >>> 0)) >>> 0;
  const quality = msg.quality || 'high';

  try {
    const luminanceData = generateLightningTexture(width, height, seed, quality);
    postMessage({id : msg.id, width, height, luminanceData}, [ luminanceData.buffer ]);
  } catch (err) {
    const fallback = new Uint8Array(width * height);
    postMessage({id : msg.id, width, height, luminanceData : fallback, error : String(err)}, [ fallback.buffer ]);
  }
};

function generateLightningTexture(width, height, seed, quality)
{
  const cfg = getQualityConfig(quality);
  const rand = createRng(seed);
  const detailScale = clamp(Math.sqrt((width * height) / (2200.0 * 4400.0)), 0.56, 1.0);
  const leaderSteps = Math.max(220, Math.floor(cfg.leaderSteps * detailScale));

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', {alpha : true, desynchronized : true});
  ctx.clearRect(0, 0, width, height);

  const trunk = [];
  const branches = [];

  const startX = width * (0.48 + (rand() - 0.5) * 0.10);
  traceSteppedLeader({
    x : startX,
    y : 0,
    angle : (rand() - 0.5) * 0.09,
    step : Math.max(1.20, height / 1620),
    width : Math.max(2.2, width / 760),
    depth : 0,
    energy : 1.0,
    maxSteps : leaderSteps,
    branchBias : 1.0
  });

  ensureGroundConnection(trunk, startX, width, height, cfg, rand);
  seedFallbackBranches(trunk, branches, cfg, rand, width, height);

  drawSegments(ctx, branches, `rgba(208, 224, 255, ${0.44 + cfg.glowAlpha * 0.40})`, cfg.branchWidth, 'source-over');
  drawSegments(ctx, trunk, `rgba(150, 198, 255, ${cfg.haloAlpha})`, cfg.haloWidth, 'screen');
  drawSegments(ctx, trunk, `rgba(210, 236, 255, ${cfg.glowAlpha})`, cfg.glowWidth, 'screen');

  drawReturnStroke(ctx, trunk, cfg);
  drawDartLeaders(ctx, trunk, cfg, rand);

  const imageData = ctx.getImageData(0, 0, width, height).data;
  const luminanceData = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < imageData.length; i += 4, j++)
    luminanceData[j] = imageData[i];
  return luminanceData;

  function pushSeg(target, x0, y0, x1, y1, w, glow)
  {
    target.push({x0, y0, x1, y1, w, glow});
  }

  function traceSteppedLeader(state)
  {
    let x = state.x;
    let y = state.y;
    let angle = state.angle;
    let widthNow = state.width;
    let energy = state.energy;

    for (let i = 0; i < state.maxSteps; i++) {
      if (y >= height || widthNow < 0.32 || energy < 0.05)
        return;

      const descendBias = 0.24 + state.depth * 0.03;
      const phase = y / Math.max(height, 1);
      const steppedBand = Math.floor(phase * 44.0);
      const stepPause = (steppedBand % 2 == 0) ? 1.0 : 0.88;
      const jitter = (rand() - 0.5) * (0.21 + state.depth * 0.05);
      const centerPull = (startX - x) / width * (0.07 + state.depth * 0.012);
      const meander = Math.sin(phase * Math.PI * (2.5 + state.depth * 0.5) + rand() * 0.7) * (0.052 + state.depth * 0.018);
      const stepLadder = Math.sin(steppedBand * (0.72 + rand() * 0.09) + seed * 0.0002) * 0.035;

      angle = angle * 0.80 + jitter + centerPull + meander + stepLadder;

      const segStep = state.step * (0.86 + rand() * 0.24) * stepPause;
      const dx = Math.sin(angle) * segStep;
      const dy = Math.max(0.44, Math.cos(angle) * segStep + descendBias * segStep);

      const x2 = clamp(x + dx, 0, width - 1);
      const y2 = Math.min(height, y + dy);
      const glow = clamp(energy * (1.15 - state.depth * 0.18), 0.0, 1.0);
      pushSeg(state.depth === 0 ? trunk : branches, x, y, x2, y2, widthNow, glow);

      x = x2;
      y = y2;
      widthNow *= cfg.branchDecay;
      energy *= 0.992;

      if (state.depth < cfg.maxBranchDepth) {
        const altitudeFactor = 1.0 - y / height;
        const branchChance = cfg.branchSpawnChance * state.branchBias * altitudeFactor * energy * Math.max(1.0 - state.depth * 0.20, 0.30);
        if (rand() < branchChance) {
          const dir = rand() < 0.5 ? -1 : 1;
          traceSteppedLeader({
            x,
            y,
            angle : angle + dir * (0.40 + rand() * 0.44),
            step : state.step * (0.72 + rand() * 0.24),
            width : widthNow * (0.50 + rand() * 0.18),
            depth : state.depth + 1,
            energy : energy * (0.78 + rand() * 0.14),
            maxSteps : Math.floor(cfg.branchMaxSteps * (0.36 + rand() * 0.72)),
            branchBias : state.branchBias * 0.84
          });
        }
      }
    }
  }
}

function drawSegments(ctx, segments, color, widthScale, mode)
{
  if (!segments.length)
    return;

  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    ctx.beginPath();
    ctx.lineWidth = Math.max(0.24, seg.w * widthScale);
    ctx.moveTo(seg.x0, seg.y0);
    ctx.lineTo(seg.x1, seg.y1);
    ctx.stroke();
  }

  ctx.restore();
}

function drawReturnStroke(ctx, trunk, cfg)
{
  if (!trunk.length)
    return;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = `rgba(255, 255, 255, ${cfg.returnStrokeAlpha})`;

  for (let i = trunk.length - 1; i >= 0; i--) {
    const seg = trunk[i];
    const progress = 1.0 - i / Math.max(trunk.length - 1, 1);
    const pulse = 0.72 + Math.sin(progress * Math.PI * 4.0) * 0.11;
    ctx.beginPath();
    ctx.lineWidth = Math.max(0.34, seg.w * cfg.coreWidth * pulse);
    ctx.moveTo(seg.x0, seg.y0);
    ctx.lineTo(seg.x1, seg.y1);
    ctx.stroke();
  }

  ctx.restore();
}

function drawDartLeaders(ctx, trunk, cfg, rand)
{
  if (!trunk.length)
    return;

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.strokeStyle = 'rgba(204, 232, 255, 0.58)';
  ctx.lineCap = 'round';

  for (let i = 0; i < cfg.dartLeaderCount; i++) {
    const startIdx = Math.floor((0.12 + rand() * 0.55) * (trunk.length - 1));
    const maxLen = Math.max(18, Math.floor(trunk.length * (0.12 + rand() * 0.18)));

    for (let j = 0; j < maxLen; j++) {
      const idx = startIdx + j;
      if (idx < 0 || idx >= trunk.length)
        break;
      const seg = trunk[idx];
      const lead = 1.0 - j / Math.max(maxLen, 1);
      ctx.beginPath();
      ctx.lineWidth = Math.max(0.20, seg.w * cfg.coreWidth * 0.62 * lead);
      ctx.moveTo(seg.x0, seg.y0);
      ctx.lineTo(seg.x1, seg.y1);
      ctx.stroke();
    }
  }

  ctx.restore();
}

function ensureGroundConnection(trunk, startX, width, height, cfg, rand)
{
  if (!trunk.length)
    return;

  const last = trunk[trunk.length - 1];
  const minCoverage = Math.floor(height * (cfg.minGroundCoverage || 0.92));
  if (last.y1 >= minCoverage)
    return;

  let x = last.x1;
  let y = last.y1;
  let widthNow = Math.max(last.w * 0.96, 0.68);
  let angle = 0.0;
  const step = Math.max(1.12, height / 1760);
  const maxSteps = Math.ceil((height - y) / step) + 12;

  for (let i = 0; i < maxSteps && y < height; i++) {
    const centerPull = (startX - x) / width * 0.09;
    const wiggle = (rand() - 0.5) * 0.09;
    angle = angle * 0.81 + centerPull + wiggle;

    const dx = Math.sin(angle) * step * 0.70;
    const dy = Math.max(0.64, Math.cos(angle) * step + step * 0.74);

    const x2 = clamp(x + dx, 0, width - 1);
    const y2 = Math.min(height, y + dy);
    trunk.push({x0 : x, y0 : y, x1 : x2, y1 : y2, w : widthNow, glow : 0.8});

    x = x2;
    y = y2;
    widthNow = Math.max(widthNow * 0.986, 0.48);
  }
}

function seedFallbackBranches(trunk, branches, cfg, rand, width, height)
{
  const minVisibleBranches = cfg.minVisibleBranches || 32;
  if (branches.length >= minVisibleBranches || trunk.length < 12)
    return;

  const attempts = Math.min(150, trunk.length);
  for (let i = 0; i < attempts && branches.length < minVisibleBranches; i++) {
    const idx = Math.floor(rand() * (trunk.length - 8)) + 4;
    const src = trunk[idx];
    const dir = rand() < 0.5 ? -1 : 1;
    const branchLen = Math.floor(cfg.branchMaxSteps * (0.12 + rand() * 0.30));

    let x = src.x1;
    let y = src.y1;
    let angle = dir * (0.62 + rand() * 0.45);
    let step = Math.max(0.68, (height / 1780) * (0.80 + rand() * 0.56));
    let widthNow = Math.max(src.w * (0.42 + rand() * 0.25), 0.28);

    for (let j = 0; j < branchLen; j++) {
      if (y >= height || widthNow < 0.18)
        break;

      const meander = (rand() - 0.5) * 0.28;
      angle = angle * 0.85 + dir * (0.10 + rand() * 0.16) + meander;

      const dx = Math.sin(angle) * step;
      const dy = Math.max(0.30, Math.cos(angle) * step + step * 0.30);
      const x2 = clamp(x + dx, 0, width - 1);
      const y2 = Math.min(height, y + dy);

      branches.push({x0 : x, y0 : y, x1 : x2, y1 : y2, w : widthNow, glow : 0.55});

      if (j > 2 && rand() < 0.13) {
        const twigAngle = angle + dir * (0.32 + rand() * 0.44);
        const twigStep = step * (0.54 + rand() * 0.33);
        const tx = clamp(x2 + Math.sin(twigAngle) * twigStep, 0, width - 1);
        const ty = Math.min(height, y2 + Math.max(0.20, Math.cos(twigAngle) * twigStep));
        branches.push({x0 : x2, y0 : y2, x1 : tx, y1 : ty, w : Math.max(widthNow * 0.60, 0.16), glow : 0.45});
      }

      x = x2;
      y = y2;
      widthNow *= 0.956;
      step *= 0.995;
    }
  }
}
