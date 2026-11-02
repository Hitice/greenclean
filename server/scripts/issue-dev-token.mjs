import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) {
  console.error('Set JWT_SECRET (at least 32 characters) in .env or in the environment.');
  process.exit(1);
}

const sub = process.argv[2] || 'dev-user';
const plan = process.argv[3] || 'cloud';
const days = process.argv[4] ? parseInt(process.argv[4], 10) : 30;

if (Number.isNaN(days) || days < 1) {
  console.error('Invalid expiry in days (use an integer >= 1).');
  process.exit(1);
}

const token = jwt.sign({ sub, plan }, secret, {
  algorithm: 'HS256',
  expiresIn: `${days}d`,
});

console.log(token);
