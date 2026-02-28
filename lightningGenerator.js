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
      trunkSteps : 420,
      branchSteps : 120,
      splitChance : 0.11,
      maxDepth : 2,
      haloWidth : 3.1,
      glowWidth : 1.7,
      branchWidth : 0.9,
      coreWidth : 0.45,
      haloAlpha : 0.20,
      glowAlpha : 0.44,
      bloomAlpha : 0.0,
      branchDecay : 0.968,
      minTrunkCoverage : 0.90,
      minVisibleBranches : 28
    };
  }

  if (quality == 'medium') {
    return {
      trunkSteps : 620,
      branchSteps : 175,
      splitChance : 0.145,
      maxDepth : 3,
      haloWidth : 3.8,
      glowWidth : 1.95,
      branchWidth : 0.95,
      coreWidth : 0.50,
      haloAlpha : 0.24,
      glowAlpha : 0.52,
      bloomAlpha : 0.06,
      branchDecay : 0.972,
      minTrunkCoverage : 0.93,
      minVisibleBranches : 40
    };
  }

  return {
    trunkSteps : 820,
    branchSteps : 230,
    splitChance : 0.175,
    maxDepth : 4,
    haloWidth : 4.5,
    glowWidth : 2.25,
    branchWidth : 1.0,
    coreWidth : 0.55,
    haloAlpha : 0.29,
    glowAlpha : 0.60,
    bloomAlpha : 0.10,
    branchDecay : 0.976,
    minTrunkCoverage : 0.96,
    minVisibleBranches : 56
  };
}

onmessage = (event) => {
  const msg = event.data || {};
  const width = Math.max(96, Math.floor(msg.width || 1024));
  const height = Math.max(192, Math.floor(msg.height || 2048));
  const seed = (msg.seed ?? ((Date.now() ^ (width * 2654435761)) >>> 0)) >>> 0;
  const quality = msg.quality || 'high';

  try {
    const imageData = generateLightningTexture(width, height, seed, quality);
    postMessage({id : msg.id, imageData});
  } catch (err) {
    const fallback = new ImageData(width, height);
    postMessage({id : msg.id, imageData : fallback, error : String(err)});
  }
};

function generateLightningTexture(width, height, seed, quality)
{
  const cfg = getQualityConfig(quality);
  const rand = createRng(seed);
  const detailScale = clamp(Math.sqrt((width * height) / (2200.0 * 4400.0)), 0.55, 1.0);
  const trunkSteps = Math.max(180, Math.floor(cfg.trunkSteps * detailScale));
  const branchSteps = Math.max(64, Math.floor(cfg.branchSteps * detailScale));

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', {alpha : true, desynchronized : true});
  ctx.clearRect(0, 0, width, height);

  const trunk = [];
  const branches = [];

  const startX = width * (0.46 + (rand() - 0.5) * 0.12);
  const trunkWobbleFreq = 1.1 + rand() * 2.2;
  const trunkWobbleAmp = 0.09 + rand() * 0.12;
  const trunkJagSeed = rand();
  tracePath({
    x : startX,
    y : 0,
    angle : (rand() - 0.5) * 0.10,
    step : Math.max(1.25, height / 1550),
    width : Math.max(2.4, width / 720),
    energy : 1.0,
    depth : 0,
    list : trunk,
    maxSteps : trunkSteps
  });


  ensureGroundConnection(trunk, startX, width, height, cfg, rand);
  seedFallbackBranches(trunk, branches, cfg, rand, width, height, branchSteps);

  drawSegments(ctx, trunk, `rgba(160, 205, 255, ${cfg.haloAlpha})`, cfg.haloWidth, 'screen');
  drawSegments(ctx, trunk, `rgba(208, 232, 255, ${cfg.glowAlpha})`, cfg.glowWidth, 'screen');
  drawSegments(ctx, branches, 'rgba(232, 244, 255, 0.72)', cfg.branchWidth, 'source-over');
  drawSegments(ctx, trunk, 'rgba(255, 255, 255, 1.0)', cfg.coreWidth, 'lighter');

  if (cfg.bloomAlpha > 0.0)
    drawColumnBloom(ctx, width, height, cfg.bloomAlpha);

  return ctx.getImageData(0, 0, width, height);

  function tracePath(state)
  {
    let current = {
      x : state.x,
      y : state.y,
      angle : state.angle,
      step : state.step,
      width : state.width,
      energy : state.energy,
      depth : state.depth,
      list : state.list,
      maxSteps : state.maxSteps
    };

    for (let i = 0; i < current.maxSteps; i++) {
      if (current.y >= height || current.width < 0.35)
        return;

      const descendBias = 0.20 + current.depth * 0.02;
      const wiggle = (rand() - 0.5) * (0.28 + current.depth * 0.08);
      const centerPull = (startX - current.x) / width * 0.08;
      const curvature = Math.sin((current.y / height) * Math.PI * (1.25 + current.depth * 0.35) + rand() * 0.6) * (0.075 + current.depth * 0.028);
      const kink = (rand() < 0.06) ? ((rand() < 0.5 ? -1 : 1) * (0.10 + rand() * 0.16)) : 0.0;
      const jagBand = Math.floor((current.y / height) * 26.0);
      const segmentJitter = (rand() - 0.5) * 0.07 + (Math.sin((current.y / height) * Math.PI * 2.0 * trunkWobbleFreq + trunkJagSeed * 6.2831) * trunkWobbleAmp);
      const segmentedBend = (Math.sin(floatSafe(jagBand) * (0.9 + trunkJagSeed * 0.5) + trunkJagSeed * 3.0) * 0.06);

      current.angle = current.angle * 0.78 + wiggle + centerPull + curvature + kink + segmentJitter + segmentedBend;

      const dx = Math.sin(current.angle) * current.step;
      const dy = Math.max(0.48, Math.cos(current.angle) * current.step + descendBias * current.step);

      const x2 = clamp(current.x + dx, 0, width - 1);
      const y2 = Math.min(height, current.y + dy);
      const seg = {x0 : current.x, y0 : current.y, x1 : x2, y1 : y2, w : current.width};

      if (current.depth === 0)
        trunk.push(seg);
      else
        branches.push(seg);

      current.x = x2;
      current.y = y2;
      current.width *= cfg.branchDecay;
      current.energy *= 0.992;

      const altitudeFactor = 1.0 - current.y / height;
      const depthPenalty = 1.0 - current.depth * 0.22;
      const branchChance = cfg.splitChance * altitudeFactor * Math.max(depthPenalty, 0.15) * current.energy;

      if (current.depth < cfg.maxDepth && rand() < branchChance) {
        const dir = rand() < 0.5 ? -1 : 1;
        tracePath({
          x : current.x,
          y : current.y,
          angle : current.angle + dir * (0.42 + rand() * 0.45),
          step : current.step * (0.78 + rand() * 0.24),
          width : current.width * (0.52 + rand() * 0.16),
          energy : current.energy * 0.84,
          depth : current.depth + 1,
          list : branches,
          maxSteps : Math.floor(branchSteps * (0.45 + rand() * 0.65))
        });
      }
    }
  }
}

function floatSafe(v)
{
  return Number.isFinite(v) ? v : 0;
}


function seedFallbackBranches(trunk, branches, cfg, rand, width, height, branchSteps)
{
  const minVisibleBranches = cfg.minVisibleBranches || 32;
  if (branches.length >= minVisibleBranches || trunk.length < 12)
    return;

  const attempts = Math.min(120, trunk.length);
  for (let i = 0; i < attempts && branches.length < minVisibleBranches; i++) {
    const idx = Math.floor(rand() * (trunk.length - 8)) + 4;
    const src = trunk[idx];
    const dir = rand() < 0.5 ? -1 : 1;
    const branchLen = Math.floor(branchSteps * (0.16 + rand() * 0.24));

    let x = src.x1;
    let y = src.y1;
    let angle = dir * (0.65 + rand() * 0.42);
    let step = Math.max(0.7, (height / 1750) * (0.75 + rand() * 0.55));
    let widthNow = Math.max(src.w * (0.48 + rand() * 0.28), 0.34);

    for (let j = 0; j < branchLen; j++) {
      if (y >= height || widthNow < 0.24)
        break;

      const lateralDrift = dir * (0.11 + rand() * 0.16);
      const meander = (rand() - 0.5) * 0.28;
      angle = angle * 0.84 + lateralDrift + meander;

      const dx = Math.sin(angle) * step;
      const dy = Math.max(0.33, Math.cos(angle) * step + step * 0.30);
      const x2 = clamp(x + dx, 0, width - 1);
      const y2 = Math.min(height, y + dy);

      branches.push({x0 : x, y0 : y, x1 : x2, y1 : y2, w : widthNow});

      if (j > 2 && rand() < 0.12) {
        const twigAngle = angle + dir * (0.35 + rand() * 0.42);
        const twigStep = step * (0.55 + rand() * 0.30);
        const tx = clamp(x2 + Math.sin(twigAngle) * twigStep, 0, width - 1);
        const ty = Math.min(height, y2 + Math.max(0.22, Math.cos(twigAngle) * twigStep));
        branches.push({x0 : x2, y0 : y2, x1 : tx, y1 : ty, w : Math.max(widthNow * 0.62, 0.20)});
      }

      x = x2;
      y = y2;
      widthNow *= 0.955;
      step *= 0.995;
    }
  }
}



function ensureGroundConnection(trunk, startX, width, height, cfg, rand)
{
  if (!trunk.length)
    return;

  const last = trunk[trunk.length - 1];
  const minCoverage = Math.floor(height * (cfg.minTrunkCoverage || 0.92));

  if (last.y1 >= minCoverage)
    return;

  let x = last.x1;
  let y = last.y1;
  let widthNow = Math.max(last.w * 0.96, 0.75);
  let angle = 0.0;
  const step = Math.max(1.20, height / 1700);
  const maxSteps = Math.ceil((height - y) / step) + 8;

  for (let i = 0; i < maxSteps && y < height; i++) {
    const centerPull = (startX - x) / width * 0.10;
    const wiggle = (rand() - 0.5) * 0.08;
    angle = angle * 0.82 + centerPull + wiggle;

    const dx = Math.sin(angle) * step * 0.75;
    const dy = Math.max(0.65, Math.cos(angle) * step + step * 0.70);

    const x2 = clamp(x + dx, 0, width - 1);
    const y2 = Math.min(height, y + dy);
    trunk.push({x0 : x, y0 : y, x1 : x2, y1 : y2, w : widthNow});

    x = x2;
    y = y2;
    widthNow = Math.max(widthNow * 0.985, 0.55);
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
    ctx.lineWidth = Math.max(0.25, seg.w * widthScale);
    ctx.moveTo(seg.x0, seg.y0);
    ctx.lineTo(seg.x1, seg.y1);
    ctx.stroke();
  }

  ctx.restore();
}

function drawColumnBloom(ctx, width, height, alpha)
{
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0.0, `rgba(112, 165, 255, ${alpha})`);
  gradient.addColorStop(0.45, `rgba(180, 210, 255, ${alpha * 0.6})`);
  gradient.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  ctx.fillStyle = gradient;
  ctx.fillRect(width * 0.25, 0, width * 0.50, height);
  ctx.restore();
}
