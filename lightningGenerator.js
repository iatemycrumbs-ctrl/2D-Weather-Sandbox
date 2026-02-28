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
    // Force-visible brightness curve for mobile and low-light scenes.
    const base = Math.min(Math.pow(Math.max(lineWidth, 0.1), 1.65) * 30.0, 255.0);
    const col = Math.floor(base);
    return `rgb(${col}, ${col}, ${col})`;
  }

  function drawCoreChannel()
  {
    ctx.beginPath();

    let startX = width / 2.0 + (rand() - 0.5) * width * 0.08;
    let startY = 0;
    let angle = (rand() - 0.5) * 0.5;
    let lineWidth = Math.max(5.2, width / 220.0);
    const targetAngle = 0.0;

    ctx.moveTo(startX, startY);
    ctx.lineWidth = lineWidth;

    while (startY < height) {
      const nextX = startX + Math.sin(angle) * 1.25;
      const nextY = startY + Math.cos(angle) * 1.45;

      angle += (rand() - 0.5) * 1.1;
      angle -= (angle - targetAngle) * 0.075;

      ctx.lineTo(nextX, nextY);
      startX = nextX;
      startY = nextY;

      if (rand() < 0.018 * (1.0 - nextY / height)) {
        ctx.strokeStyle = genLightningColor(lineWidth);
        ctx.stroke();
        drawBranch(nextX, nextY, targetAngle + (rand() - 0.5) * 2.4, lineWidth * (0.38 + rand() * 0.20));
        ctx.beginPath();
        ctx.moveTo(nextX, nextY);
        ctx.lineWidth = lineWidth;
      }
    }

    ctx.strokeStyle = genLightningColor(lineWidth);
    ctx.stroke();
  }

  function drawBranch(startX, startY, targetAngle, lineWidth)
  {
    let angle = targetAngle;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineWidth = lineWidth;

    while (startY < height) {
      const nextX = startX + Math.sin(angle) * 1.05;
      const nextY = startY + Math.cos(angle) * 1.15;

      angle += (rand() - 0.5) * 0.65;
      angle -= (angle - targetAngle) * 0.08;

      ctx.lineTo(nextX, nextY);

      startX = nextX;
      startY = nextY;

      if (rand() < 0.020) {
        ctx.strokeStyle = genLightningColor(lineWidth);
        ctx.stroke();
        lineWidth -= 0.18;

        if (lineWidth < 0.1)
          return;

        if (rand() < 0.12)
          drawBranch(nextX, nextY, targetAngle + (rand() - 0.5) * 1.4, lineWidth * 0.86);

        ctx.beginPath();
        ctx.moveTo(nextX, nextY);
        ctx.lineWidth = lineWidth;
      }
    }

    ctx.strokeStyle = genLightningColor(lineWidth);
    ctx.stroke();
  }

  // Glow + core for force-visible bolt.
  ctx.globalCompositeOperation = 'screen';
  drawCoreChannel();
  ctx.filter = 'blur(1.6px)';
  drawCoreChannel();
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'lighter';
  drawCoreChannel();

  const imageData = ctx.getImageData(0, 0, width, height).data;
  const luminanceData = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < imageData.length; i += 4, j++)
    luminanceData[j] = imageData[i];

  return luminanceData;
}
