import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const sourceDirectories = ["uploads/badges", "badge_images"];
const sizes = [
  { directory: "thumbs", width: 192, quality: 78 },
  { directory: "large", width: 512, quality: 84 },
];

let generated = 0;
let originalBytes = 0;
let generatedBytes = 0;

for (const sourceDirectory of sourceDirectories) {
  const entries = await fs.readdir(sourceDirectory, { withFileTypes: true });
  const imageNames = entries
    .filter((entry) => entry.isFile() && /\.(png|jpe?g)$/i.test(entry.name))
    .map((entry) => entry.name);

  for (const imageName of imageNames) {
    const inputPath = path.join(sourceDirectory, imageName);
    originalBytes += (await fs.stat(inputPath)).size;

    for (const size of sizes) {
      const outputDirectory = path.join(sourceDirectory, size.directory);
      const outputPath = path.join(
        outputDirectory,
        `${path.parse(imageName).name}.webp`,
      );
      await fs.mkdir(outputDirectory, { recursive: true });
      await sharp(inputPath)
        .resize(size.width, size.width, {
          fit: "cover",
          position: "centre",
        })
        .webp({ quality: size.quality, effort: 6 })
        .toFile(outputPath);
      generatedBytes += (await fs.stat(outputPath)).size;
      generated += 1;
    }
  }
}

console.log(
  `Generated ${generated} badge images: ` +
  `${(originalBytes / 1024 / 1024).toFixed(1)} MB originals -> ` +
  `${(generatedBytes / 1024 / 1024).toFixed(1)} MB combined derivatives`,
);