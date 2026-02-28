onmessage = (event) => {
  const msg = event.data || {};
  const width = Math.max(96, Math.floor(msg.width || 1024));
  const height = Math.max(192, Math.floor(msg.height || 2048));
  const id = msg.id;

  try {
    const luminanceData = generateLightningBolt(width, height, msg.seed);
    postMessage({id, width, height, luminanceData}, [ luminanceData.buffer ]);
  } catch (err) {
    const fallback = new Uint8Array(width * height);
    postMessage({id, width, height, luminanceData : fallback, error : String(err)}, [ fallback.buffer ]);
  }
};

function generateLightningBolt(width, height, seed)
{
  const lightningCanvas = new OffscreenCanvas(width, height);
  const ctx = lightningCanvas.getContext('2d', {alpha : true, desynchronized : true});
  ctx.clearRect(0, 0, width, height);

  let rngState = ((seed ?? Date.now()) >>> 0) || 1;
  function rand()
  {
    rngState = (1664525 * rngState + 1013904223) >>> 0;
    return rngState / 4294967296;
  }

  function genLightningColor(lineWidth)
  {
    const base = Math.min(Math.pow(Math.max(lineWidth, 0.1), 1.60) * 28.0, 255.0);
    const col = Math.floor(base);
    return `rgb(${col}, ${col}, ${col})`;
  }

  const coreSegments = [];
  const branchSegments = [];

  function traceBolt(startX, startY, targetAngle, lineWidth, isBranch)
  {
    let angle = targetAngle;
    let x = startX;
    let y = startY;
    let w = lineWidth;
    const segmentList = isBranch ? branchSegments : coreSegments;

    while (y < height) {
      const stepScale = isBranch ? 1.05 : 1.25;
      const nextX = x + Math.sin(angle) * stepScale;
      const nextY = y + Math.cos(angle) * (isBranch ? 1.15 : 1.45);

      angle += (rand() - 0.5) * (isBranch ? 0.65 : 1.05);
      angle -= (angle - targetAngle) * 0.08;

      const cx = Math.min(Math.max(nextX, 0.0), width - 1.0);
      const cy = Math.min(Math.max(nextY, 0.0), height);

      segmentList.push({x0 : x, y0 : y, x1 : cx, y1 : cy, w});

      x = cx;
      y = cy;

      if (isBranch && rand() < 0.020) {
        w -= 0.18;
        if (w < 0.1)
          return;
        if (rand() < 0.12)
          traceBolt(x, y, targetAngle + (rand() - 0.5) * 1.4, w * 0.86, true);
      }

      if (!isBranch && rand() < 0.018 * (1.0 - y / height))
        traceBolt(x, y, targetAngle + (rand() - 0.5) * 2.4, w * (0.38 + rand() * 0.20), true);
    }
  }

  const startX = width / 2.0 + (rand() - 0.5) * width * 0.08;
  const startAngle = (rand() - 0.5) * 0.45;
  const coreWidth = Math.max(5.0, width / 240.0);
  traceBolt(startX, 0.0, startAngle, coreWidth, false);

  function drawSegments(list, widthMult, mode)
  {
    if (!list.length)
      return;
    ctx.save();
    ctx.globalCompositeOperation = mode;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      ctx.beginPath();
      ctx.moveTo(s.x0, s.y0);
      ctx.lineTo(s.x1, s.y1);
      ctx.lineWidth = Math.max(0.1, s.w * widthMult);
      ctx.strokeStyle = genLightningColor(s.w * widthMult);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Render passes from the SAME geometry to avoid fat flickering blobs.
  drawSegments(coreSegments, 1.65, 'screen');
  drawSegments(branchSegments, 1.35, 'screen');

  ctx.save();
  ctx.filter = 'blur(1.2px)';
  drawSegments(coreSegments, 1.18, 'screen');
  drawSegments(branchSegments, 1.08, 'screen');
  ctx.restore();
  ctx.filter = 'none';

  drawSegments(coreSegments, 0.92, 'lighter');
  drawSegments(branchSegments, 0.82, 'source-over');

  const imageData = ctx.getImageData(0, 0, width, height).data;
  const luminanceData = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < imageData.length; i += 4, j++)
    luminanceData[j] = imageData[i];
  return luminanceData;
}
