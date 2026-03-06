onmessage = (event) => {
  const msg = event.data;
  const imgElement = generateLightningBolt(msg.width, msg.height);
  postMessage(imgElement);
};

function generateLightningBolt(width, height) {
  const lightningCanvas = new OffscreenCanvas(width, height);
  const ctx = lightningCanvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const segmentCount = 44;
  const baseX = width * (0.40 + Math.random() * 0.20);
  const branchBudget = 34;

  const nodes = [];
  let x = baseX;
  let y = 0;
  nodes.push({x, y});

  for (let i = 1; i <= segmentCount; i++) {
    const t = i / segmentCount;
    const yNext = t * height;
    const jitter = (Math.random() - 0.5) * (width * (0.018 + (1 - t) * 0.028));
    const meander = Math.sin(t * 13.0 + Math.random() * 2.0) * width * 0.009;
    x += jitter + meander;
    x = Math.max(width * 0.06, Math.min(width * 0.94, x));
    y = yNext;
    nodes.push({x, y});
  }

  const branchSegments = [];
  for (let i = 4; i < nodes.length - 6; i++) {
    if (branchSegments.length >= branchBudget)
      break;
    const t = i / nodes.length;
    const spawnChance = 0.18 * (1.0 - t * 0.45);
    if (Math.random() > spawnChance)
      continue;

    const dir = Math.random() < 0.5 ? -1 : 1;
    const steps = 4 + Math.floor(Math.random() * 12);
    let bx = nodes[i].x;
    let by = nodes[i].y;
    let prev = {x: bx, y: by};
    let angle = (Math.PI / 2.0) + dir * (0.25 + Math.random() * 0.55);

    for (let s = 0; s < steps; s++) {
      const stepLen = (height / segmentCount) * (0.9 - s * 0.035);
      angle += (Math.random() - 0.5) * 0.35;
      bx += Math.cos(angle) * stepLen;
      by += Math.sin(angle) * stepLen;
      if (by > height || bx < 0 || bx > width)
        break;

      const next = {x: bx, y: by};
      branchSegments.push({
        a: prev,
        b: next,
        width: Math.max(0.6, 2.2 - s * 0.18),
        alpha: Math.max(0.20, 0.72 - s * 0.05)
      });
      prev = next;
    }
  }

  const drawStroke = (pts, widthPx, alpha, tint = [210, 230, 255]) => {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++)
      ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${alpha})`;
    ctx.lineWidth = widthPx;
    ctx.shadowColor = `rgba(${tint[0]}, ${tint[1]}, 255, ${Math.min(0.95, alpha + 0.2)})`;
    ctx.shadowBlur = widthPx * 1.6;
    ctx.stroke();
  };

  drawStroke(nodes, 9.5, 0.26, [120, 180, 255]);
  drawStroke(nodes, 5.6, 0.58, [170, 210, 255]);
  drawStroke(nodes, 2.9, 0.96, [235, 245, 255]);

  for (const seg of branchSegments) {
    drawStroke([seg.a, seg.b], seg.width + 1.2, seg.alpha * 0.35, [120, 170, 255]);
    drawStroke([seg.a, seg.b], seg.width, seg.alpha, [220, 235, 255]);
  }

  return ctx.getImageData(0, 0, width, height);
}
