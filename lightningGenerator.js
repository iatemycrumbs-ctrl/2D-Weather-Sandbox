onmessage = (event) => {
  const msg = event.data;
  const imgElement = generateLightningBolt(msg.width, msg.height);
  postMessage(imgElement);
};

function generateLightningBolt(width, height) {
  const lightningCanvas = new OffscreenCanvas(width, height);
  const ctx = lightningCanvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);

  // Force visible output by keeping a bright minimum intensity.
  function genLightningColor(lineWidth) {
    const base = 220;
    const boost = Math.min(35, Math.pow(lineWidth, 1.2) * 3);
    const value = Math.min(255, base + boost);
    return `rgb(${value}, ${value}, 255)`;
  }

  ctx.beginPath();

  let startX = width / 2.0;
  let startY = 0;
  let angle = Math.PI / 6;
  let lineWidth = 9.0;
  const targetAngle = 0.0;

  ctx.moveTo(startX, startY);

  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(200, 220, 255, 0.95)';
  ctx.shadowBlur = 6;

  while (startY < height) {
    const nextX = startX + Math.sin(angle);
    const nextY = startY + Math.cos(angle);

    angle += (Math.random() - 0.5) * 1.4;
    angle -= (angle - targetAngle) * 0.08;

    ctx.lineTo(nextX, nextY);

    startX = nextX;
    startY = nextY;

    if (Math.random() < 0.015 * (1 - nextY / height)) {
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

  function drawBranch(branchStartX, branchStartY, branchTargetAngle, line_width) {
    let branchAngle = branchTargetAngle;

    // Keep tiny branches visible.
    line_width = Math.max(0.8, line_width);

    ctx.beginPath();
    ctx.moveTo(branchStartX, branchStartY);
    ctx.lineWidth = line_width;

    while (branchStartY < height) {
      const nextX = branchStartX + Math.sin(branchAngle);
      const nextY = branchStartY + Math.cos(branchAngle);

      branchAngle += (Math.random() - 0.5) * 0.7;
      branchAngle -= (branchAngle - branchTargetAngle) * 0.08;

      ctx.lineTo(nextX, nextY);

      branchStartX = nextX;
      branchStartY = nextY;

      if (Math.random() < 0.018) {
        ctx.strokeStyle = genLightningColor(line_width);
        ctx.stroke();
        line_width -= 0.2;

        if (line_width < 0.8) {
          return;
        }

        if (Math.random() < 0.1) {
          drawBranch(nextX, nextY, branchTargetAngle + (Math.random() - 0.5) * 1.5, line_width);
        }

        ctx.beginPath();
        ctx.moveTo(nextX, nextY);
        ctx.lineWidth = line_width;
      }
    }

    ctx.strokeStyle = genLightningColor(line_width);
    ctx.stroke();
  }
}
