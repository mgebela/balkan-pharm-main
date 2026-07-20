/*
 * Generate NFT token PNGs from shared pixel art (seed → harvest).
 *
 * Usage: node generate-token-art.js
 * Writes 512×512 PNGs into token-metadata/images/
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Art = require('../shared/token-pixel-art.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '../token-metadata/images');
const SCALE = 16; // 32 → 512

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    }
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter none
    rgba.copy(raw, rowStart + 1, y * stride, y * stride + stride);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

console.log('Generating pixel token art…');
for (let i = 0; i < Art.STAGE_KEYS.length; i += 1) {
  const key = Art.STAGE_KEYS[i];
  const grid = Art.buildStage(i, { withBg: true });
  const { width, height, rgba } = Art.gridToRgba(grid, SCALE);
  const png = encodePng(width, height, rgba);
  const file = path.join(OUT_DIR, `plant-${key}.png`);
  fs.writeFileSync(file, png);
  console.log('✔', file, `(${width}×${height})`);
}

// Keep legacy filename as alias of seed stage for existing mint scripts.
const seedSrc = path.join(OUT_DIR, 'plant-seed.png');
const seedDst = path.join(OUT_DIR, 'seed-rwa.png');
fs.copyFileSync(seedSrc, seedDst);
console.log('✔', seedDst, '(alias of plant-seed.png)');
console.log('Done.');
