import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const PACKAGE_ROOT = path.resolve(here, '..');

export function configDir(): string {
  return process.env.COMMUNITY_AGENT_CONFIG ?? path.join(PACKAGE_ROOT, 'config');
}

export function dataDir(): string {
  return process.env.COMMUNITY_AGENT_DATA ?? path.join(PACKAGE_ROOT, 'data');
}

export function dbPath(): string {
  return path.join(dataDir(), 'memory.json');
}

export function repoRoot(): string {
  return process.env.COMMUNITY_AGENT_REPO ?? path.resolve(PACKAGE_ROOT, '..');
}

export function queueDir(): string {
  return process.env.COMMUNITY_AGENT_QUEUE ?? path.join(repoRoot(), 'community', 'queue');
}

export function weeklyDir(): string {
  return process.env.COMMUNITY_AGENT_WEEKLY ?? path.join(repoRoot(), 'community', 'weekly');
}

export function logPath(): string {
  return process.env.COMMUNITY_AGENT_LOG ?? path.join(repoRoot(), 'community', 'log.md');
}
