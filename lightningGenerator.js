onmessage = (event) => {
  const msg = event.data || {};
  const width = Math.max(96, Math.floor(msg.width || 1024));
  const height = Math.max(192, Math.floor(msg.height || 2048));

  try {
    const imageData = generateLightningBolt(width, height);
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

function generateLightningBolt(width, height)
{
  const lightningCanvas = new OffscreenCanvas(width, height);
  const ctx = lightningCanvas.getContext('2d', {alpha : true, desynchronized : true});

  ctx.clearRect(0, 0, width, height);

  function genLightningColor(lineWidth)
  {
    const colR = 12;
    const colG = 12;
    const colB = 12;
    const brightness = Math.pow(lineWidth, 2.0);
    return `rgb(${colR * brightness}, ${colG * brightness}, ${colB * brightness})`;
  }

  ctx.beginPath();

  let startX = width / 2.0;
  let startY = 0;
  let angle = Math.PI / 6.;
  let lineWidth = 9.0;
  const targetAngle = 0.0;

  ctx.moveTo(startX, startY);
  ctx.lineWidth = lineWidth;

  while (startY < height) {
    const nextX = startX + Math.sin(angle);
    const nextY = startY + Math.cos(angle);

    angle += (Math.random() - 0.5) * 1.4;
    angle -= (angle - targetAngle) * 0.08;

    ctx.lineTo(nextX, nextY);

    startX = nextX;
    startY = nextY;

    if (Math.random() < 0.015 * (1. - nextY / height)) {
      ctx.strokeStyle = genLightningColor(lineWidth);
      ctx.stroke();
      drawBranch(nextX, nextY, targetAngle + (Math.random() - 0.5) * 2.5, lineWidth * 0.5 * Math.random());
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

      angle += (Math.random() - 0.5) * 0.7;
      angle -= (angle - targetAngle) * 0.08;

      ctx.lineTo(nextX, nextY);

      startX = nextX;
      startY = nextY;

      if (Math.random() < 0.018) {
        ctx.strokeStyle = genLightningColor(line_width);
        ctx.stroke();
        line_width -= 0.2;

        if (line_width < 0.1)
          return;

        if (Math.random() < 0.1)
          drawBranch(nextX, nextY, targetAngle + (Math.random() - 0.5) * 1.5, line_width);

        ctx.beginPath();
        ctx.moveTo(nextX, nextY);
        ctx.lineWidth = line_width;
      }
    }
    ctx.strokeStyle = genLightningColor(line_width);
    ctx.stroke();
  }
}
