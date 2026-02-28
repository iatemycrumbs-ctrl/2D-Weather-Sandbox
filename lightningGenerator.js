function createRng(seed)
{
  let state = (seed >>> 0) || 1;
  return function rand()
  {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function clamp(v, lo, hi)
{
  return Math.min(Math.max(v, lo), hi);
}

function getConfig(quality)
{
  if (quality == 'low') {
    return {
      channelCount : 1,
      trunkSteps : 340,
      branchChance : 0.06,
      branchSteps : 62,
      maxDepth : 2,
      trunkWidth : 1.6,
      branchWidth : 0.7,
      glow : 0.34
    };
  }
  if (quality == 'medium') {
    return {
      channelCount : 1,
      trunkSteps : 520,
      branchChance : 0.095,
      branchSteps : 92,
      maxDepth : 3,
      trunkWidth : 2.0,
      branchWidth : 0.82,
      glow : 0.48
    };
  }
  return {
    channelCount : 1,
    trunkSteps : 700,
    branchChance : 0.128,
    branchSteps : 124,
    maxDepth : 4,
    trunkWidth : 2.3,
    branchWidth : 0.9,
    glow : 0.60
  };
}

onmessage = (event) => {
  const msg = event.data || {};
  const width = Math.max(96, Math.floor(msg.width || 768));
  const height = Math.max(192, Math.floor(msg.height || 1536));
  const seed = ((msg.seed ?? Date.now()) >>> 0) || 1;
  const quality = msg.quality || 'high';

  try {
    const luminanceData = generateLightning(width, height, seed, quality);
    postMessage({id : msg.id, width, height, luminanceData}, [ luminanceData.buffer ]);
  } catch (err) {
    const fallback = new Uint8Array(width * height);
    postMessage({id : msg.id, width, height, luminanceData : fallback, error : String(err)}, [ fallback.buffer ]);
  }
};

function generateLightning(width, height, seed, quality)
{
  const rand = createRng(seed);
  const cfg = getConfig(quality);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', {alpha : true, desynchronized : true});
  ctx.clearRect(0, 0, width, height);

  const segments = [];
  const branches = [];

  for (let c = 0; c < cfg.channelCount; c++) {
    const sx = width * (0.50 + (rand() - 0.5) * 0.18);
    traceLeader(sx, 0, (rand() - 0.5) * 0.08, Math.max(1.0, height / 1850), cfg.trunkWidth, cfg.trunkSteps, 0);
  }

  // Broad glow shell.
  drawList(ctx, segments, `rgba(170,215,255,${0.18 + cfg.glow * 0.28})`, 2.8, 'screen');
  drawList(ctx, branches, `rgba(190,225,255,${0.22 + cfg.glow * 0.20})`, 2.0, 'screen');

  // Main channel body.
  drawList(ctx, segments, 'rgba(230,245,255,0.82)', 1.0, 'lighter');
  drawList(ctx, branches, 'rgba(220,238,255,0.52)', 1.0, 'source-over');

  // Return stroke overlay from lower channel upward.
  drawReturnStroke(ctx, segments, cfg);

  const rgba = ctx.getImageData(0, 0, width, height).data;
  const out = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++)
    out[j] = rgba[i];
  return out;

  function traceLeader(x0, y0, angle0, step0, width0, steps, depth)
  {
    let x = x0;
    let y = y0;
    let angle = angle0;
    let step = step0;
    let w = width0;

    for (let i = 0; i < steps; i++) {
      if (y >= height || w < 0.16)
        return;

      const t = y / Math.max(height, 1);
      const ladder = Math.floor(t * 54.0);
      const stepped = (ladder % 2 == 0) ? 1.0 : 0.90;
      const zig = (rand() - 0.5) * (0.20 + depth * 0.06);
      const bend = Math.sin(t * Math.PI * (2.8 + depth * 0.5) + seed * 0.00013) * (0.05 + depth * 0.018);
      angle = angle * 0.79 + zig + bend;

      const dx = Math.sin(angle) * step * stepped;
      const dy = Math.max(0.38, Math.cos(angle) * step * stepped + step * (0.31 + depth * 0.04));
      const x2 = clamp(x + dx, 0, width - 1);
      const y2 = Math.min(y + dy, height);

      if (depth == 0)
        segments.push({x0 : x, y0 : y, x1 : x2, y1 : y2, w});
      else
        branches.push({x0 : x, y0 : y, x1 : x2, y1 : y2, w});

      x = x2;
      y = y2;
      w *= 0.987 - depth * 0.008;
      step *= 0.998;

      if (depth < cfg.maxDepth) {
        const altitude = 1.0 - t;
        const pBranch = cfg.branchChance * altitude * (1.0 - depth * 0.20);
        if (rand() < pBranch) {
          const dir = rand() < 0.5 ? -1 : 1;
          traceLeader(
            x,
            y,
            angle + dir * (0.34 + rand() * 0.36),
            step * (0.72 + rand() * 0.26),
            w * (0.60 + rand() * 0.20),
            Math.floor(cfg.branchSteps * (0.45 + rand() * 0.65)),
            depth + 1
          );
        }
      }
    }
  }
}

function drawList(ctx, list, color, widthMult, mode)
{
  if (!list.length)
    return;
  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    ctx.beginPath();
    ctx.lineWidth = Math.max(0.2, s.w * widthMult);
    ctx.moveTo(s.x0, s.y0);
    ctx.lineTo(s.x1, s.y1);
    ctx.stroke();
  }
  ctx.restore();
}

function drawReturnStroke(ctx, segments, cfg)
{
  if (!segments.length)
    return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineCap = 'round';
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i];
    const p = 1.0 - i / Math.max(segments.length - 1, 1);
    ctx.beginPath();
    ctx.lineWidth = Math.max(0.25, s.w * (0.52 + 0.48 * p) * (cfg.trunkWidth / 2.0));
    ctx.moveTo(s.x0, s.y0);
    ctx.lineTo(s.x1, s.y1);
    ctx.stroke();
  }
  ctx.restore();
}
