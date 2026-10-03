import fs from "node:fs";
import path from "node:path";

/** The reviewed Markdown table is the source of truth; manual search/ownership
 * remain available. Changed references must have a fresh vector before release. */
export function readDevScanBadImages(): Map<number, string> {
  const text = fs.readFileSync(path.resolve("docs/scan-bad-images.md"), "utf8");
  const flags = new Map<number, string>();
  for (const line of text.split("\n")) {
    const columns = line.split("|").map(c => c.trim());
    if (!/^\d+$/.test(columns[2] ?? "")) continue;
    const url = columns[6]?.replace(/^`|`$/g, "");
    if (!url?.startsWith("https://")) throw new Error("Bad-image flag requires its reviewed image URL");
    flags.set(Number(columns[2]), url);
  }
  return flags;
}