import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_ROOT } from './paths.ts';

export function loadEnv(): void {
  const file = path.join(PACKAGE_ROOT, '.env');
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cut = line.indexOf('=');
    if (cut < 1) continue;
    const key = line.slice(0, cut).trim();
    const value = line.slice(cut + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
