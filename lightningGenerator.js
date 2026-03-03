onmessage = (event) => {
  const msg = event.data || {};
  const width = Math.max(96, Math.floor(msg.width || 1024));
  const height = Math.max(192, Math.floor(msg.height || 2048));

  try {
    const imgData = generateLightningBolt(width, height);
    const luminanceData = imageDataToLuminance(imgData);
    postMessage({id : msg.id, width, height, luminanceData}, [ luminanceData.buffer ]);
  } catch (err) {
    const fallback = new Uint8Array(width * height);
    postMessage({id : msg.id, width, height, luminanceData : fallback, error : String(err)}, [ fallback.buffer ]);
  }
};

function generateLightningBolt(width, height)
{
  const lightningCanvas = new OffscreenCanvas(width, height);
  const ctx = lightningCanvas.getContext('2d', {alpha : true});
  ctx.clearRect(0, 0, width, height);

  function genLightningColor(lineWidth)
  {
    const colR = 12;
    const colG = 12;
    const colB = 12;
    const brightness = Math.pow(Math.max(lineWidth, 0.0), 2.0);
    return `rgb(${Math.min(255, colR * brightness)}, ${Math.min(255, colG * brightness)}, ${Math.min(255, colB * brightness)})`;
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();

  let startX = width / 2.0;
  let startY = 0;
  let angle = Math.PI / 6.0;
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

    if (Math.random() < 0.015 * (1.0 - nextY / height)) {
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

  function drawBranch(branchStartX, branchStartY, branchTargetAngle, branchLineWidth)
  {
    let branchAngle = branchTargetAngle;

    ctx.beginPath();
    ctx.moveTo(branchStartX, branchStartY);
    ctx.lineWidth = branchLineWidth;

    while (branchStartY < height) {
      const nextX = branchStartX + Math.sin(branchAngle);
      const nextY = branchStartY + Math.cos(branchAngle);

      branchAngle += (Math.random() - 0.5) * 0.7;
      branchAngle -= (branchAngle - branchTargetAngle) * 0.08;

      ctx.lineTo(nextX, nextY);

      branchStartX = nextX;
      branchStartY = nextY;

      if (Math.random() < 0.018) {
        ctx.strokeStyle = genLightningColor(branchLineWidth);
        ctx.stroke();
        branchLineWidth -= 0.2;

        if (branchLineWidth < 0.1)
          return;

        if (Math.random() < 0.1) {
          drawBranch(nextX, nextY, branchTargetAngle + (Math.random() - 0.5) * 1.5, branchLineWidth);
        }

        ctx.beginPath();
        ctx.moveTo(nextX, nextY);
        ctx.lineWidth = branchLineWidth;
      }
    }

    ctx.strokeStyle = genLightningColor(branchLineWidth);
    ctx.stroke();
  }
}

function imageDataToLuminance(imgData)
{
  const src = imgData.data;
  const luminance = new Uint8Array(imgData.width * imgData.height);
  for (let i = 0, j = 0; i < src.length; i += 4, j++) {
    luminance[j] = Math.max(src[i], src[i + 1], src[i + 2]);
  }
  return luminance;
}
