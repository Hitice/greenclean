import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const input = path.join(rootDir, 'public', 'logo.svg');
const sizes = [16, 32, 48, 128];

await Promise.all(
  sizes.map((size) =>
    sharp(input)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png({ compressionLevel: 9 })
      .toFile(path.join(rootDir, 'public', `icon-${size}.png`)),
  ),
);

console.log('PNG icons generated:', sizes.join(', '));
