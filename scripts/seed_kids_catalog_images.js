/**
 * Materialize missing demo/kids/*.jpg primary catalog images under API uploads.
 * Usage: node scripts/seed_kids_catalog_images.js
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const ROOT = path.join(__dirname, "..");
const UPLOADS = path.join(ROOT, "apps", "api", "uploads");

const THEMES = [
  { bg: "#f3f6f4", accent: "#1a4d3a", soft: "#d7e6dd" },
  { bg: "#f7f2ef", accent: "#6b3f3a", soft: "#ead9d3" },
  { bg: "#f1f4f8", accent: "#2f4a6b", soft: "#d5deea" },
  { bg: "#f6f4ef", accent: "#5a4a2f", soft: "#e6dfcf" },
  { bg: "#f3f7f8", accent: "#2f5b5a", soft: "#d4e4e3" },
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

function requireSharp() {
  try {
    return require("sharp");
  } catch {
    return require(path.join(ROOT, "node_modules", "sharp"));
  }
}

function themeFor(slug) {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return THEMES[h % THEMES.length];
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapTitle(name, maxLen = 18) {
  const words = name.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxLen && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

async function makeImage(sharp, { slug, name, brand }) {
  const theme = themeFor(slug);
  const lines = wrapTitle(name);
  const lineSvg = lines
    .map(
      (line, i) =>
        `<text x="80" y="${980 + i * 44}" font-family="Georgia, serif" font-size="36" fill="${theme.accent}">${escapeXml(line)}</text>`,
    )
    .join("");
  const brandSvg = brand
    ? `<text x="80" y="940" font-family="Arial, sans-serif" font-size="22" letter-spacing="3" fill="${theme.accent}" opacity="0.7">${escapeXml(String(brand).toUpperCase())}</text>`
    : "";

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="900" height="1200" viewBox="0 0 900 1200" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${theme.bg}"/>
      <stop offset="100%" stop-color="${theme.soft}"/>
    </linearGradient>
  </defs>
  <rect width="900" height="1200" fill="url(#g)"/>
  <circle cx="690" cy="280" r="210" fill="${theme.accent}" opacity="0.08"/>
  <circle cx="220" cy="760" r="160" fill="${theme.accent}" opacity="0.06"/>
  <rect x="180" y="220" width="540" height="640" rx="28" fill="#ffffff" opacity="0.88"/>
  <rect x="230" y="290" width="440" height="480" rx="18" fill="${theme.soft}"/>
  <path d="M320 470h260v40H320z M360 540h180v28H360z" fill="${theme.accent}" opacity="0.35"/>
  <circle cx="450" cy="390" r="54" fill="${theme.accent}" opacity="0.22"/>
  ${brandSvg}
  ${lineSvg}
  <text x="80" y="1140" font-family="Arial, sans-serif" font-size="18" fill="${theme.accent}" opacity="0.45">Sabu catalog demo</text>
</svg>`;

  return sharp(Buffer.from(svg)).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
}

async function main() {
  loadEnv();
  const sharp = requireSharp();
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const { rows } = await client.query(`
    SELECT DISTINCT ON (p.id)
      p.id, p.slug, p.name, b.name AS brand, pi.storage_key
    FROM catalog.products p
    JOIN catalog.product_images pi ON pi.product_id = p.id AND pi.is_primary
    LEFT JOIN catalog.brands b ON b.id = p.brand_id
    WHERE pi.storage_key LIKE 'demo/kids/%'
    ORDER BY p.id, pi.sort_order
  `);

  let written = 0;
  for (const row of rows) {
    const abs = path.join(UPLOADS, ...row.storage_key.split("/"));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const buf = await makeImage(sharp, row);
    fs.writeFileSync(abs, buf);
    written += 1;
    console.log("wrote", row.storage_key, `(${buf.length} bytes)`);
  }

  // Keep demo/kids keys as primary — studio attaches can be mismatched.
  await client.query(`
    UPDATE catalog.product_images pi
    SET is_primary = false
    WHERE pi.storage_key LIKE 'products/%'
      AND EXISTS (
        SELECT 1 FROM catalog.product_images d
        WHERE d.product_id = pi.product_id
          AND d.storage_key LIKE 'demo/kids/%'
      )
  `);
  await client.query(`
    UPDATE catalog.product_images d
    SET is_primary = true
    WHERE d.storage_key LIKE 'demo/kids/%'
      AND NOT EXISTS (
        SELECT 1 FROM catalog.product_images x
        WHERE x.product_id = d.product_id AND x.is_primary
      )
  `);

  console.log(JSON.stringify({ written }, null, 2));
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
