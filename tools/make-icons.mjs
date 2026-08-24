/**
 * Generates the toolbar icons as PNGs with no image dependency —
 * raw RGBA scanlines, deflated with node:zlib, wrapped in PNG chunks.
 *
 * The mark: three stacked rows behind a signal column, echoing the panel's
 * list-and-meter idea. Drawn at 4x and box-filtered down so the rounded
 * corners land smooth at 16px.
 *
 *   node tools/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const SS = 4; // supersample factor

const INK = [0x12, 0x14, 0x1a];
const PAPER = [0xf4, 0xf2, 0xed];
const SIGNAL = [0x3d, 0x9e, 0x74];

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter: none
    rgba.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** Signed distance to a rounded rect, used as a coverage test. */
function insideRoundRect(x, y, w, h, r) {
  const dx = Math.max(r - x, 0, x - (w - r));
  const dy = Math.max(r - y, 0, y - (h - r));
  return Math.hypot(dx, dy) <= r;
}

function drawIcon(size) {
  const S = size * SS;
  const hi = Buffer.alloc(S * S * 4);

  const radius = S * 0.22;
  // Three rows: a short signal block, then a longer paper bar.
  const rows = [
    { y: 0.28, blockW: 0.16, barW: 0.44 },
    { y: 0.47, blockW: 0.16, barW: 0.56 },
    { y: 0.66, blockW: 0.16, barW: 0.32 }
  ];
  const barH = S * 0.1;
  const left = S * 0.18;
  const gap = S * 0.08;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      if (!insideRoundRect(x + 0.5, y + 0.5, S, S, radius)) continue;

      let colour = INK;
      for (const row of rows) {
        const top = S * row.y - barH / 2;
        if (y < top || y > top + barH) continue;
        const blockEnd = left + S * row.blockW;
        if (x >= left && x <= blockEnd) { colour = SIGNAL; break; }
        const barStart = blockEnd + gap;
        if (x >= barStart && x <= barStart + S * row.barW) { colour = PAPER; break; }
      }
      hi[i] = colour[0]; hi[i + 1] = colour[1]; hi[i + 2] = colour[2]; hi[i + 3] = 255;
    }
  }

  // Box-filter down to the target size for anti-aliased edges.
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const j = (((y * SS + sy) * S) + (x * SS + sx)) * 4;
          const alpha = hi[j + 3] / 255;
          r += hi[j] * alpha; g += hi[j + 1] * alpha; b += hi[j + 2] * alpha; a += alpha;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      out[i] = a ? Math.round(r / a) : 0;
      out[i + 1] = a ? Math.round(g / a) : 0;
      out[i + 2] = a ? Math.round(b / a) : 0;
      out[i + 3] = Math.round((a / n) * 255);
    }
  }
  return encodePng(size, out);
}

mkdirSync(OUT, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = join(OUT, `icon${size}.png`);
  writeFileSync(file, drawIcon(size));
  console.log(`wrote icons/icon${size}.png`);
}
