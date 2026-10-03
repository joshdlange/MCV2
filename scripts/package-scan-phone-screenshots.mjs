import { readFile, writeFile } from "node:fs/promises";
const dir = "screenshots/scan-phone";
const screens = [
  ["results-same-art", "Results — same artwork across sets"],
  ["year", "Browse — year"],
  ["set", "Browse — set"],
  ["subset", "Browse — subset"],
  ["card", "Browse — cards"],
  ["typed-darkhawk-11-1992", 'Typed search — “darkhawk 11 1992”'],
];
let content = "";
for (const [key,title] of screens) {
  content += `<section><h2>${title}</h2><div class="pair">`;
  for (const phase of ["before","after"]) {
    const bytes = await readFile(`${dir}/${phase}-${key}-390.png`);
    content += `<figure><figcaption>${phase.toUpperCase()} · 390px</figcaption><img alt="${phase} ${title}" src="data:image/png;base64,${bytes.toString("base64")}"></figure>`;
  }
  content += "</div></section>";
}
await writeFile(`${dir}/before-after.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MCV scan — before and after</title><style>body{margin:0;padding:24px;background:#f5f3f0;color:#25272c;font:16px system-ui}main{max-width:840px;margin:auto}h1{border-bottom:4px solid #ed1d24;padding-bottom:12px}p{line-height:1.6}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0}img{display:block;width:100%;height:auto;border:1px solid #ccc}figcaption{font-weight:bold;padding:10px}section{margin:40px 0}a{color:#b2141a}@media(max-width:600px){.pair{grid-template-columns:1fr}}</style><main><h1>Scan to add: before / after</h1><p>All captures are 390 × 844 pixels. These show the real workspace components using a read-only DEV catalog export and real reference-vector grouping. Authentication and mutations were simulated in an isolated browser harness; these are <strong>not signed-in physical-phone acceptance tests</strong>. The before captures use saved pre-change components. Missing catalog images are shown as missing, not fabricated.</p><p><strong>Taps:</strong> from results, one tap on Add or the correct set row. Selecting a parallel takes one additional tap. Starting on the scan screen, Camera → shutter → Add is three taps, plus any camera permission/confirmation prompts.</p>${content}</main></html>`);