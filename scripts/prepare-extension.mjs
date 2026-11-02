import { copyFile, access, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

async function ensureFile(filePath) {
  try {
    await access(filePath, constants.F_OK);
  } catch {
    throw new Error(`Required file not found: ${filePath}`);
  }
}

async function main() {
  const copies = [
    ['manifest.json', 'manifest.json'],
    ['src/content.js', 'content.js'],
    ['LICENSE', 'LICENSE'],
    // The Outfit font is bundled by Vite; the SIL Open Font License must ship with it.
    ['node_modules/@fontsource-variable/outfit/LICENSE', 'licenses/Outfit-OFL.txt'],
  ];

  for (const [from] of copies) await ensureFile(path.join(root, from));
  // Vite copies public/, which holds the locales the manifest's __MSG_*__ fields need.
  await ensureFile(path.join(dist, '_locales', 'en', 'messages.json'));

  await mkdir(path.join(dist, 'licenses'), { recursive: true });
  for (const [from, to] of copies) {
    await copyFile(path.join(root, from), path.join(dist, to));
  }

  console.log(`Extension prepared in dist/ (${copies.map(([, to]) => to).join(', ')}).`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
