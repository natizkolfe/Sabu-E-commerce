/**
 * Local-cutout supplier phone photos into the AI studio library.
 * Uses edge flood-fill to remove dirt/floors/people touching the frame,
 * then white 4:5 canvas. Replace with Photoroom in production.
 *
 * Usage: node scripts/seed_demo_enhanced_images.js
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

const ROOT = path.join(__dirname, "..");
const ASSETS = path.join(
  process.env.USERPROFILE || "",
  ".cursor",
  "projects",
  "c-Users-natna-Desktop-Sabu-E-commerce-Sabu-E-commerce",
  "assets",
);
const UPLOADS = path.join(ROOT, "apps", "api", "uploads");

const LABELS = [
  { match: "8.30.21_AM__1_", label: "37 Electronic Keyboard", slug: "keyboard" },
  { match: "8.04.48_AM-f6d037dc", label: "Pink Smart Board", slug: "smart-board" },
  { match: "8.30.22_AM-2ddc40c7", label: "Doraemon RC Stunt Car", slug: "rc-car" },
  { match: "8.04.49_AM__3_-83fc1980", label: "Pink Bear Onesie", slug: "pink-onesie" },
  { match: "8.30.21_AM-f5d3c408", label: "Rose Baby Stroller", slug: "stroller" },
  { match: "8.04.49_AM__4_-aeac6e67", label: "Blue Bear Onesie", slug: "blue-onesie" },
  { match: "8.30.21_AM__2_-58a24bd2", label: "Doll Stroller Set", slug: "doll-stroller" },
  { match: "8.11.29_AM__1_-7af8139f", label: "7-in-1 Feeding Set", slug: "feeding-set" },
  { match: "8.04.49_AM__2_-f6e6ea29", label: "Plush Cats Set", slug: "plush-cats" },
  { match: "8.04.49_AM__1_-5535e86b", label: "Foldable Bathtub Set", slug: "bathtub" },
  { match: "8.04.49_AM-bd8d208d", label: "Folding Drying Rack", slug: "drying-rack" },
  { match: "8.11.29_AM__2_-cc782447", label: "Music Bed Bell", slug: "bed-bell" },
  { match: "8.11.29_AM-82a5c5de", label: "Only Baby Bottles", slug: "baby-bottles" },
];

function loadEnv() {
  const rootEnv = path.join(ROOT, ".env");
  if (!fs.existsSync(rootEnv)) return;
  for (const line of fs.readFileSync(rootEnv, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

function labelFor(filename) {
  return (
    LABELS.find((l) => filename.includes(l.match)) ?? {
      label: filename.slice(0, 40),
      slug: "item",
    }
  );
}

function requireSharp() {
  try {
    return require("sharp");
  } catch {
    return require(path.join(ROOT, "node_modules", "sharp"));
  }
}

function colorDist(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

async function edgeFloodCutout(sharp, input, threshold = 38) {
  const maxDim = 1400;
  const borderGrayPx = 28;
  const { data, info } = await sharp(input, { failOn: "none" })
    .rotate()
    .resize(maxDim, maxDim, { fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const ch = info.channels;
  const n = w * h;
  const visited = new Uint8Array(n);
  const queue = [];
  const idx = (x, y) => y * w + x;
  const get = (i) => ({
    r: data[i * ch],
    g: data[i * ch + 1],
    b: data[i * ch + 2],
  });

  const refs = [];
  const pushRef = (x, y) => {
    const c = get(idx(x, y));
    const max = Math.max(c.r, c.g, c.b);
    const min = Math.min(c.r, c.g, c.b);
    if (max - min > 55 && max > 140) return; // skip product art colors
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
    refs.push(get(0), get(w - 1), get((h - 1) * w), get(n - 1));
  }

  const nearBorder = (x, y) =>
    x < borderGrayPx ||
    y < borderGrayPx ||
    x >= w - borderGrayPx ||
    y >= h - borderGrayPx;

  const isBg = (c, x, y) => {
    for (const ref of refs) {
      if (colorDist(c, ref) <= threshold) return true;
    }
    if (nearBorder(x, y)) {
      const max = Math.max(c.r, c.g, c.b);
      const min = Math.min(c.r, c.g, c.b);
      if (max - min < 28 && max < 170) return true;
    }
    return false;
  };

  const trySeed = (x, y) => {
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
    const i = queue.pop();
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

  for (let pass = 0; pass < 2; pass++) {
    const toWhiten = [];
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
    raw: { width: w, height: h, channels: ch },
  })
    .png()
    .toBuffer();
}

/** Tight crop for warehouse shots: drop feet (top-right) and dirty floor (bottom-right). */
async function preCropWarehouse(sharp, buf) {
  const meta = await sharp(buf, { failOn: "none" }).rotate().metadata();
  const w = meta.width || 1000;
  const h = meta.height || 1000;
  // Aggressive: keep package, drop right-side feet/dirt/doorway
  const left = Math.floor(w * 0.03);
  const top = Math.floor(h * 0.05);
  const width = Math.floor(w * 0.7);
  const height = Math.floor(h * 0.86);
  return sharp(buf, { failOn: "none" })
    .rotate()
    .extract({ left, top, width, height })
    .jpeg({ quality: 92 })
    .toBuffer();
}

async function standardizeToWhiteCanvas(sharp, inputBuffer) {
  const TARGET_W = 1200;
  const TARGET_H = 1500;

  const flattened = await sharp(inputBuffer, { failOn: "none" })
    .rotate()
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();

  let subject = flattened;
  try {
    subject = await sharp(flattened, { failOn: "none" })
      .trim({ background: { r: 255, g: 255, b: 255 }, threshold: 14 })
      .png()
      .toBuffer();
  } catch {
    subject = flattened;
  }

  const meta = await sharp(subject, { failOn: "none" }).metadata();
  const srcW = Math.max(1, meta.width ?? TARGET_W);
  const srcH = Math.max(1, meta.height ?? TARGET_H);
  const padRatio = 0.05;
  const maxW = Math.round(TARGET_W * (1 - padRatio * 2));
  const maxH = Math.round(TARGET_H * (1 - padRatio * 2));
  const scale = Math.min(maxW / srcW, maxH / srcH);
  const drawW = Math.max(1, Math.round(srcW * scale));
  const drawH = Math.max(1, Math.round(srcH * scale));
  const resized = await sharp(subject, { failOn: "none" })
    .resize(drawW, drawH, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer();
  const left = Math.floor((TARGET_W - drawW) / 2);
  const top = Math.floor((TARGET_H - drawH) / 2);

  return sharp({
    create: {
      width: TARGET_W,
      height: TARGET_H,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite([{ input: resized, left, top }])
    .jpeg({ quality: 88, mozjpeg: true })
    .sharpen({ sigma: 0.5 })
    .toBuffer();
}

function writeUpload(folder, buffer, ext) {
  const dir = path.join(UPLOADS, ...folder.split("/"));
  fs.mkdirSync(dir, { recursive: true });
  const hash = crypto.createHash("sha1").update(buffer).digest("hex").slice(0, 10);
  const id = crypto.randomUUID().slice(0, 8);
  const storageKey = `${folder}/${id}-${hash}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS, ...storageKey.split("/")), buffer);
  return storageKey;
}

async function main() {
  loadEnv();
  const sharp = requireSharp();
  if (!fs.existsSync(ASSETS)) {
    console.error("Assets folder not found:", ASSETS);
    process.exit(1);
  }

  const files = fs
    .readdirSync(ASSETS)
    .filter((f) => /^WhatsApp_Image_.*\.jpe?g$/i.test(f))
    .sort();

  const client = new Client({
    connectionString:
      process.env.DATABASE_URL ||
      `postgresql://${process.env.PGUSER || "sabu"}:${process.env.PGPASSWORD || "sabu"}@${process.env.PGHOST || "localhost"}:${process.env.PGPORT || "5432"}/${process.env.PGDATABASE || "sabu"}`,
  });
  await client.connect();

  await client.query(`
    DELETE FROM studio.generated_images gi
    USING studio.generation_jobs j
    WHERE gi.job_id = j.id AND j.provider = 'local_demo_seed'
  `);
  await client.query(`DELETE FROM studio.generation_jobs WHERE provider = 'local_demo_seed'`);

  console.log(`Cutout + enhance ${files.length} images → library…`);
  let ok = 0;

  for (const file of files) {
    const meta = labelFor(file);
    const sourceBuf = fs.readFileSync(path.join(ASSETS, file));
    const sourceKey = writeUpload(`studio/demo/${meta.slug}/source`, sourceBuf, "jpg");

    let enhancedBuf;
    try {
      // Default = white canvas only (keeps the photo). No edge-flood cutout —
      // that ate products like plush cats. Remove-bg stays an optional UI toggle.
      const warehouse = [
        "drying-rack",
        "bathtub",
        "bed-bell",
        "baby-bottles",
        "smart-board",
        "feeding-set",
      ].includes(meta.slug);

      let working = sourceBuf;
      if (warehouse) {
        working = await preCropWarehouse(sharp, sourceBuf);
      }
      enhancedBuf = await standardizeToWhiteCanvas(sharp, working);
    } catch (err) {
      console.warn(`  skip ${meta.label}: ${err.message}`);
      continue;
    }

    const enhancedKey = writeUpload(
      `studio/demo/${meta.slug}/enhanced`,
      enhancedBuf,
      "jpg",
    );

    const { rows: jobs } = await client.query(
      `INSERT INTO studio.generation_jobs (
         product_id, variant_id, model_id, source_image_key, provider, status,
         job_type, transform_preset, completed_at, provider_meta
       ) VALUES (
         NULL, NULL, NULL, $1, 'local_demo_seed', 'succeeded',
         'product_transform', 'white_background_ecommerce', now(),
         $2::jsonb
       ) RETURNING id`,
      [
        sourceKey,
        JSON.stringify({
          demoSeed: true,
          removeBackground: false,
          localCutout: false,
          label: meta.label,
          slug: meta.slug,
          note: "White canvas placeholder — optional remove-bg via UI toggle",
        }),
      ],
    );

    await client.query(
      `INSERT INTO studio.generated_images (
         job_id, product_id, variant_id, storage_key, is_ai_preview,
         review_status, published, reviewed_at
       ) VALUES ($1, NULL, NULL, $2, true, 'approved', false, now())`,
      [jobs[0].id, enhancedKey],
    );

    console.log(`  ✓ ${meta.label}`);
    ok += 1;
  }

  await client.end();
  console.log(`Done. ${ok} images in Enhance library.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
