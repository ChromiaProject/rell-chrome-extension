import { cp } from "node:fs/promises";

const OUT = "extension-unpacked";

const result = await Bun.build({
  entrypoints: ["src/content.ts", "src/monaco.ts"],
  outdir: OUT,
  target: "browser",
  minify: true,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

await cp("static/manifest.json", `${OUT}/manifest.json`);
await cp("static/icons", `${OUT}/icons`, { recursive: true });
console.log(`Built ${OUT}/ — load it via chrome://extensions → Load unpacked.`);
