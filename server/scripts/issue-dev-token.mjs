import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 8) {
  console.error(
    'Defina JWT_SECRET (mín. 8 caracteres) no ficheiro .env ou no ambiente.',
  );
  process.exit(1);
}

const sub = process.argv[2] || 'dev-user';
const plan = process.argv[3] || 'cloud';
const days = process.argv[4] ? parseInt(process.argv[4], 10) : 30;

if (Number.isNaN(days) || days < 1) {
  console.error('Dias de expiração inválidos (use um inteiro >= 1).');
  process.exit(1);
}

const token = jwt.sign({ sub, plan }, secret, {
  algorithm: 'HS256',
  expiresIn: `${days}d`,
});

console.log(token);
