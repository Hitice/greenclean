import { copyFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

async function ensureFile(filePath) {
  try {
    await access(filePath, constants.F_OK);
  } catch {
    throw new Error(`Arquivo obrigatório não encontrado: ${filePath}`);
  }
}

async function main() {
  const manifestSrc = path.join(root, 'manifest.json');
  const manifestDest = path.join(root, 'dist', 'manifest.json');
  const contentSrc = path.join(root, 'src', 'content.js');
  const contentDest = path.join(root, 'dist', 'content.js');
  const licenseSrc = path.join(root, 'LICENSE');
  const licenseDest = path.join(root, 'dist', 'LICENSE');

  await ensureFile(manifestSrc);
  await ensureFile(contentSrc);

  await copyFile(manifestSrc, manifestDest);
  await copyFile(contentSrc, contentDest);
  try {
    await copyFile(licenseSrc, licenseDest);
  } catch {
    // LICENSE opcional no zip
  }

  console.log('Extensão preparada em dist/ (manifest.json, content.js, LICENSE).');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
