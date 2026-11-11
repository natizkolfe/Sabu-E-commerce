const path = require("path");
const fs = require("fs");
const sharp = require("sharp");
const { removeBackground } = require("@imgly/background-removal-node");

const ROOT = path.join(__dirname, "..");
const dist = path.join(
  ROOT,
  "node_modules",
  "@imgly",
  "background-removal-node",
  "dist",
);
const publicPath = `file://${dist.replace(/\\/g, "/")}/`;

const assets = path.join(
  process.env.USERPROFILE || "",
  ".cursor",
  "projects",
  "c-Users-natna-Desktop-Sabu-E-commerce-Sabu-E-commerce",
  "assets",
);

async function main() {
  console.log("publicPath", publicPath);
  console.log("resources", fs.existsSync(path.join(dist, "resources.json")));
  const f = fs.readdirSync(assets).find((x) => x.includes("bd8d208d"));
  const buf = fs.readFileSync(path.join(assets, f));
  const prep = await sharp(buf)
    .rotate()
    .resize(900, 900, { fit: "inside" })
    .png()
    .toBuffer();
  console.log("running cutout...");
  const out = await removeBackground(new Blob([prep], { type: "image/png" }), {
    publicPath,
  });
  const ab = Buffer.from(await out.arrayBuffer());
  const flat = await sharp(ab)
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .jpeg({ quality: 90 })
    .toBuffer();
  const outDir = path.join(ROOT, "apps", "api", "uploads", "studio", "demo", "_test");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "drying-rack-cutout.jpg");
  fs.writeFileSync(outPath, flat);
  console.log("ok", flat.length, outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
