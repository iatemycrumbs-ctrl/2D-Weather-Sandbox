function createRng(seed)
{
  let state = (seed >>> 0) || 1;
  return function rand()
  {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

onmessage = (event) => {
  const msg = event.data || {};
  const width = Math.max(64, Math.floor(msg.width || 1024));
  const height = Math.max(128, Math.floor(msg.height || 2048));
  const seed = (msg.seed ?? ((Date.now() ^ (width * 2654435761)) >>> 0)) >>> 0;
  const imageData = generateLightningBolt(width, height, seed);
  postMessage({id : msg.id, imageData});
};

function generateLightningBolt(width, height, seed)
{
  const lightningCanvas = new OffscreenCanvas(width, height);
  const ctx = lightningCanvas.getContext('2d', {alpha : true, desynchronized : true});
  const rand = createRng(seed);

  ctx.clearRect(0, 0, width, height);

  const channels = {
    core : [],
    branch : [],
    glow : [],
    halo : []
  };

  const trunkStartX = width * (0.48 + (rand() - 0.5) * 0.16);
  const trunkState = {
    x : trunkStartX,
    y : 0,
    angle : (rand() - 0.5) * 0.08,
    step : Math.max(1.2, height / 1300),
    width : Math.max(2.6, width / 540)
  };

  growBranch(trunkState, {
    biasAngle : 0,
    maxSteps : 5000,
    splitChance : 0.065,
    wiggle : 0.31,
    descendBias : 0.18,
    widthLoss : 0.986,
    minWidth : 0.55,
    forkDepth : 0,
    maxForkDepth : 4,
    energy : 1.0
  });

  drawSegments(channels.halo, 'rgba(130, 182, 255, 0.10)', 4.6, 'screen', 10.0);
  drawSegments(channels.glow, 'rgba(196, 222, 255, 0.24)', 2.1, 'screen', 5.0);
  drawSegments(channels.branch, 'rgba(220, 236, 255, 0.90)', 1.05, 'source-over');
  drawSegments(channels.core, 'rgba(255, 255, 255, 1.0)', 0.52, 'lighter');
  drawVerticalBloom();

  return ctx.getImageData(0, 0, width, height);

  function drawSegments(segments, color, widthScale, compositeOp, shadowBlur = 0.0)
  {
    ctx.save();
    ctx.globalCompositeOperation = compositeOp;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    if (shadowBlur > 0.0) {
      ctx.shadowColor = color;
      ctx.shadowBlur = shadowBlur;
    }
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      ctx.beginPath();
      ctx.lineWidth = Math.max(0.3, seg.w * widthScale);
      ctx.moveTo(seg.x0, seg.y0);
      ctx.lineTo(seg.x1, seg.y1);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawVerticalBloom()
  {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0.0, 'rgba(70, 122, 255, 0.08)');
    gradient.addColorStop(0.40, 'rgba(120, 165, 255, 0.06)');
    gradient.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = gradient;
    ctx.fillRect(width * 0.20, 0, width * 0.60, height);
    ctx.restore();
  }

  function pushSegment(x0, y0, x1, y1, w, energy)
  {
    const seg = {x0, y0, x1, y1, w};
    channels.halo.push(seg);
    channels.glow.push(seg);
    if (energy > 0.1)
      channels.branch.push(seg);
    if (energy > 0.35)
      channels.core.push(seg);
  }

  function growBranch(state, cfg)
  {
    let local = {
      x : state.x,
      y : state.y,
      angle : state.angle,
      step : state.step,
      width : state.width
    };

    for (let i = 0; i < cfg.maxSteps; i++) {
      if (local.y >= height || local.width <= cfg.minWidth)
        return;

      const wiggleForce = (rand() - 0.5) * cfg.wiggle;
      const returnToCenter = (trunkStartX - local.x) / width * 0.18;
      local.angle += wiggleForce + returnToCenter;
      local.angle *= 0.95;
      local.angle += cfg.biasAngle;

      const dx = Math.sin(local.angle) * local.step;
      const dy = Math.max(0.45, Math.cos(local.angle) * local.step + cfg.descendBias * local.step);

      const nextX = clamp(local.x + dx, 0, width - 1);
      const nextY = local.y + dy;

      pushSegment(local.x, local.y, nextX, nextY, local.width, cfg.energy);

      local.x = nextX;
      local.y = nextY;
      local.width *= cfg.widthLoss;

      const depthPenalty = cfg.forkDepth * 0.15;
      const attenuation = 1.0 - local.y / height;
      const dynamicSplitChance = Math.max(0.0, cfg.splitChance * attenuation * (1.0 - depthPenalty));
      if (cfg.forkDepth < cfg.maxForkDepth && rand() < dynamicSplitChance) {
        const branchDir = rand() < 0.5 ? -1 : 1;
        growBranch({
          x : local.x,
          y : local.y,
          angle : local.angle + branchDir * (0.45 + rand() * 0.5),
          step : local.step * (0.82 + rand() * 0.22),
          width : local.width * (0.56 + rand() * 0.18)
        }, {
          biasAngle : branchDir * (0.01 + rand() * 0.03),
          maxSteps : Math.floor(cfg.maxSteps * (0.28 + rand() * 0.32)),
          splitChance : cfg.splitChance * 0.82,
          wiggle : cfg.wiggle * (0.92 + rand() * 0.24),
          descendBias : cfg.descendBias * (0.92 + rand() * 0.15),
          widthLoss : cfg.widthLoss * 0.996,
          minWidth : cfg.minWidth * 0.92,
          forkDepth : cfg.forkDepth + 1,
          maxForkDepth : cfg.maxForkDepth,
          energy : cfg.energy * 0.74
        });
      }

      if (local.y > height * (0.9 + rand() * 0.08) && rand() < 0.16) {
        local.width *= 0.82;
      }
    }
  }
}

function clamp(num, min, max)
{
  return Math.min(Math.max(num, min), max);
}
