import sharp from 'sharp';

type Rgb = { r: number; g: number; b: number };

function colorDist(a: Rgb, b: Rgb) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Remove clutter that touches the frame edges (dirt, floors, people's feet)
 * by flood-filling from the border using only colors sampled on the edge.
 * Avoids eating chrome/metal product parts (no global gray heuristic).
 */
export async function edgeFloodCutout(
  input: Buffer,
  opts?: { threshold?: number; maxDim?: number; borderGrayPx?: number },
): Promise<Buffer> {
  const threshold = opts?.threshold ?? 38;
  const maxDim = opts?.maxDim ?? 1400;
  const borderGrayPx = opts?.borderGrayPx ?? 28;

  const base = await sharp(input, { failOn: 'none' })
    .rotate()
    .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { data, info } = base;
  const w = info.width;
  const h = info.height;
  const ch = info.channels;
  const n = w * h;
  const visited = new Uint8Array(n);
  const queue: number[] = [];

  const idx = (x: number, y: number) => y * w + x;
  const get = (i: number): Rgb => ({
    r: data[i * ch],
    g: data[i * ch + 1],
    b: data[i * ch + 2],
  });

  // Dense edge color samples (background refs only)
  const refs: Rgb[] = [];
  const pushRef = (x: number, y: number) => {
    const c = get(idx(x, y));
    // Skip saturated product colors for refs (red/yellow packaging art)
    const max = Math.max(c.r, c.g, c.b);
    const min = Math.min(c.r, c.g, c.b);
    if (max - min > 55 && max > 140) return;
    refs.push(c);
  };
  for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 40))) {
    pushRef(x, 0);
    pushRef(x, 1);
    pushRef(x, h - 1);
    pushRef(x, h - 2);
  }
  for (let y = 0; y < h; y += Math.max(1, Math.floor(h / 40))) {
    pushRef(0, y);
    pushRef(1, y);
    pushRef(w - 1, y);
    pushRef(w - 2, y);
  }
  if (!refs.length) {
    refs.push(get(0), get(w - 1), get((h - 1) * w), get(h * w - 1));
  }

  const nearBorder = (x: number, y: number) =>
    x < borderGrayPx ||
    y < borderGrayPx ||
    x >= w - borderGrayPx ||
    y >= h - borderGrayPx;

  const isBg = (c: Rgb, x: number, y: number) => {
    for (const ref of refs) {
      if (colorDist(c, ref) <= threshold) return true;
    }
    // Gray floor / dirt ONLY near the outer border — never deep into product
    if (nearBorder(x, y)) {
      const max = Math.max(c.r, c.g, c.b);
      const min = Math.min(c.r, c.g, c.b);
      if (max - min < 28 && max < 170) return true;
    }
    return false;
  };

  const trySeed = (x: number, y: number) => {
    const i = idx(x, y);
    if (visited[i] || !isBg(get(i), x, y)) return;
    visited[i] = 1;
    queue.push(i);
  };
  for (let x = 0; x < w; x++) {
    trySeed(x, 0);
    trySeed(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    trySeed(0, y);
    trySeed(w - 1, y);
  }

  const neighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  while (queue.length) {
    const i = queue.pop()!;
    const x = i % w;
    const y = Math.floor(i / w);
    data[i * ch] = 255;
    data[i * ch + 1] = 255;
    data[i * ch + 2] = 255;
    if (ch === 4) data[i * ch + 3] = 255;

    for (const [dx, dy] of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = idx(nx, ny);
      if (visited[ni] || !isBg(get(ni), nx, ny)) continue;
      visited[ni] = 1;
      queue.push(ni);
    }
  }

  // Light expand only near border for leftover speckles
  for (let pass = 0; pass < 2; pass++) {
    const toWhiten: number[] = [];
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      const x = i % w;
      const y = Math.floor(i / w);
      if (!nearBorder(x, y)) continue;
      let near = false;
      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (visited[idx(nx, ny)]) {
          near = true;
          break;
        }
      }
      if (near && isBg(get(i), x, y)) toWhiten.push(i);
    }
    for (const i of toWhiten) {
      visited[i] = 1;
      data[i * ch] = 255;
      data[i * ch + 1] = 255;
      data[i * ch + 2] = 255;
      if (ch === 4) data[i * ch + 3] = 255;
    }
  }

  return sharp(data, {
    raw: { width: w, height: h, channels: ch as 3 | 4 },
  })
    .png()
    .toBuffer();
}
