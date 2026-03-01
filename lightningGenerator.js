onmessage = (event) => {
  const msg = event.data || {};
  const width = Math.max(96, Math.floor(msg.width || 1024));
  const height = Math.max(192, Math.floor(msg.height || 2048));
  const seed = (msg.seed ?? Date.now()) >>> 0;

  try {
    const imageData = generateLightningBolt(width, height, seed);
    const rgba = imageData.data;
    const luminanceData = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const i = idx * 4;
        const center = rgba[i];

        // Bridge tiny raster gaps so CG channels remain visually linked.
        const left = x > 0 ? rgba[i - 4] : 0;
        const right = x + 1 < width ? rgba[i + 4] : 0;
        const up = y > 0 ? rgba[i - width * 4] : 0;
        const down = y + 1 < height ? rgba[i + width * 4] : 0;
        const upLeft = (x > 0 && y > 0) ? rgba[i - width * 4 - 4] : 0;
        const upRight = (x + 1 < width && y > 0) ? rgba[i - width * 4 + 4] : 0;
        const downLeft = (x > 0 && y + 1 < height) ? rgba[i + width * 4 - 4] : 0;
        const downRight = (x + 1 < width && y + 1 < height) ? rgba[i + width * 4 + 4] : 0;
        const maxNeighbor = Math.max(left, right, up, down, upLeft, upRight, downLeft, downRight);

        luminanceData[idx] = Math.max(center, Math.floor(maxNeighbor * 0.76));
      }
    }

    // Keep only pixels connected to the top of frame so CG channels render as one continuous bolt.
    // This removes anti-aliased speckles and detached branch fragments that appear as scattered segments.
    const connectedMask = new Uint8Array(width * height);
    const visitQueue = new Int32Array(width * height);
    const minConnectedLum = 20;
    let queueHead = 0;
    let queueTail = 0;

    for (let x = 0; x < width; x++) {
      const idx = x;
      if (luminanceData[idx] >= minConnectedLum) {
        connectedMask[idx] = 1;
        visitQueue[queueTail++] = idx;
      }
    }

    while (queueHead < queueTail) {
      const idx = visitQueue[queueHead++];
      const x = idx % width;
      const y = (idx / width) | 0;

      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
          const nIdx = ny * width + nx;
          if (connectedMask[nIdx] || luminanceData[nIdx] < minConnectedLum)
            continue;

          connectedMask[nIdx] = 1;
          visitQueue[queueTail++] = nIdx;
        }
      }
    }

    for (let i = 0; i < luminanceData.length; i++) {
      if (!connectedMask[i])
        luminanceData[i] = 0;
    }

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
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

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

  function drawJunction(x, y, widthScale)
  {
    const radius = Math.max(0.75, widthScale * 0.55);
    const glow = Math.max(120, Math.floor(Math.min(255, widthScale * 54.0)));
    ctx.beginPath();
    ctx.arc(x, y, radius, 0.0, Math.PI * 2.0);
    ctx.fillStyle = `rgb(${glow}, ${glow}, ${glow})`;
    ctx.fill();
  }

  const trunkXs = [];
  const trunkYs = [];

  ctx.beginPath();

  let startX = width * (0.5 + (rand() - 0.5) * 0.08);
  let startY = 0;
  let angle = (rand() - 0.5) * 0.24;
  let lineWidth = Math.max(4.2, width / 250.0);
  const targetAngle = 0.0;

  ctx.moveTo(startX, startY);
  trunkXs.push(startX);
  trunkYs.push(startY);
  ctx.lineWidth = lineWidth;

  while (startY < height) {
    const nextX = startX + Math.sin(angle) * 1.02;
    const nextY = startY + Math.cos(angle) * 1.14;

    angle += (rand() - 0.5) * 0.74;
    angle -= (angle - targetAngle) * 0.08;

    ctx.lineTo(nextX, nextY);
    trunkXs.push(nextX);
    trunkYs.push(nextY);

    startX = nextX;
    startY = nextY;

    if (rand() < 0.0048 * (1. - nextY / height)) {
      ctx.strokeStyle = genLightningColor(lineWidth);
      ctx.stroke();
      drawJunction(nextX, nextY, lineWidth);
      drawBranch(nextX, nextY, targetAngle + (rand() - 0.5) * 0.82, lineWidth * (0.26 + 0.12 * rand()));
      ctx.beginPath();
      ctx.moveTo(nextX, nextY);
      ctx.lineWidth = lineWidth;
    }
  }
  ctx.strokeStyle = genLightningColor(lineWidth);
  ctx.stroke();

  // Re-stroke the exact trunk path as a thin plasma core so every CG segment stays linked.
  ctx.globalCompositeOperation = 'lighter';
  if (trunkXs.length > 1) {
    ctx.beginPath();
    ctx.moveTo(trunkXs[0], trunkYs[0]);
    for (let i = 1; i < trunkXs.length; i++)
      ctx.lineTo(trunkXs[i], trunkYs[i]);
    ctx.lineWidth = Math.max(1.25, lineWidth * 0.24);
    ctx.strokeStyle = 'rgb(228,228,228)';
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';

  return ctx.getImageData(0, 0, width, height);

  function drawBranch(startX, startY, targetAngle, line_width)
  {
    let angle = targetAngle;

    drawJunction(startX, startY, line_width);
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

        drawJunction(nextX, nextY, line_width);
        ctx.beginPath();
        ctx.moveTo(nextX, nextY);
        ctx.lineWidth = line_width;
      }
    }
    ctx.strokeStyle = genLightningColor(line_width);
    ctx.stroke();
  }
}
