onmessage = (event) => {
  const msg = event.data || {};
  const width = Math.max(96, Math.floor(msg.width || 1024));
  const height = Math.max(192, Math.floor(msg.height || 2048));
  const seed = (msg.seed ?? Date.now()) >>> 0;

  try {
    const imageData = generateLightningBolt(width, height, seed);
    const rgba = imageData.data;
    const luminanceData = new Uint8Array(width * height);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j++)
      luminanceData[j] = rgba[i];

    postMessage({id : msg.id, width, height, luminanceData}, [ luminanceData.buffer ]);
  } catch (err) {
    const fallback = new Uint8Array(width * height);
    postMessage({id : msg.id, width, height, luminanceData : fallback, error : String(err)}, [ fallback.buffer ]);
  }
};

function generateLightningBolt(width, height, seed)
{
  const lightningCanvas = new OffscreenCanvas(width, height);
  const ctx = lightningCanvas.getContext('2d', {alpha : true, desynchronized : true});

  ctx.clearRect(0, 0, width, height);

  let rngState = seed || 1;
  function rand()
  {
    rngState = (1664525 * rngState + 1013904223) >>> 0;
    return rngState / 4294967296;
  }

  function genLightningColor(lineWidth)
  {
    const brightness = Math.min(Math.pow(Math.max(lineWidth, 0.1), 1.7) * 26.0, 255.0);
    const c = Math.floor(brightness);
    return `rgb(${c}, ${c}, ${c})`;
  }

  ctx.beginPath();

  let startX = width * (0.5 + (rand() - 0.5) * 0.08);
  let startY = 0;
  let angle = (rand() - 0.5) * 0.24;
  let lineWidth = Math.max(4.2, width / 250.0);
  const targetAngle = 0.0;

  ctx.moveTo(startX, startY);
  ctx.lineWidth = lineWidth;

  while (startY < height) {
    const nextX = startX + Math.sin(angle) * 1.18;
    const nextY = startY + Math.cos(angle) * 1.30;

    angle += (rand() - 0.5) * 0.74;
    angle -= (angle - targetAngle) * 0.08;

    ctx.lineTo(nextX, nextY);

    startX = nextX;
    startY = nextY;

    if (rand() < 0.0048 * (1. - nextY / height)) {
      ctx.strokeStyle = genLightningColor(lineWidth);
      ctx.stroke();
      drawBranch(nextX, nextY, targetAngle + (rand() - 0.5) * 0.82, lineWidth * (0.26 + 0.12 * rand()));
      ctx.beginPath();
      ctx.moveTo(nextX, nextY);
      ctx.lineWidth = lineWidth;
    }
  }
  ctx.strokeStyle = genLightningColor(lineWidth);
  ctx.stroke();

  return ctx.getImageData(0, 0, width, height);

  function drawBranch(startX, startY, targetAngle, line_width)
  {
    let angle = targetAngle;

    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineWidth = line_width;

    while (startY < height) {
      const nextX = startX + Math.sin(angle);
      const nextY = startY + Math.cos(angle);

      angle += (rand() - 0.5) * 0.42;
      angle -= (angle - targetAngle) * 0.08;

      ctx.lineTo(nextX, nextY);

      startX = nextX;
      startY = nextY;

      if (rand() < 0.014) {
        ctx.strokeStyle = genLightningColor(line_width);
        ctx.stroke();
        line_width -= 0.2;

        if (line_width < 0.1)
          return;

        if (rand() < 0.025)
          drawBranch(nextX, nextY, targetAngle + (rand() - 0.5) * 0.62, line_width * 0.82);

        ctx.beginPath();
        ctx.moveTo(nextX, nextY);
        ctx.lineWidth = line_width;
      }
    }
    ctx.strokeStyle = genLightningColor(line_width);
    ctx.stroke();
  }
}
