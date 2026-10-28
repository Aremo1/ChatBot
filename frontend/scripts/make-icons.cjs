/**
 * Generates the PWA icons (public/icon-192.png, public/icon-512.png)
 * with no dependencies — a blue rounded square with a white chat-bubble
 * glyph, encoded straight into a valid PNG.
 *
 *   node scripts/make-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const BG = [59, 130, 246, 255]; // #3b82f6
const FG = [255, 255, 255, 255];

/** Simple rounded-rect background + centered speech bubble. */
function drawPixel(x, y, size) {
  const r = size * 0.18;
  const inRounded = (px, py) => {
    const cx = px < r ? r : px > size - r ? size - r : px;
    const cy = py < r ? r : py > size - r ? size - r : py;
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
  };
  if (!inRounded(x, y)) return null; // transparent corner

  // Speech bubble: ellipse in the upper-middle + a small tail.
  const bx = size / 2;
  const by = size * 0.46;
  const rx = size * 0.30;
  const ry = size * 0.24;
  const inBubble = ((x - bx) ** 2) / (rx * rx) + ((y - by) ** 2) / (ry * ry) <= 1;
  const inTail = x >= size * 0.36 && x <= size * 0.48 && y >= by && y <= by + size * 0.16;
  if (inBubble || inTail) return FG;

  // Three "typing dots" inside the bubble.
  for (let i = -1; i <= 1; i++) {
    const dx = x - (bx + i * size * 0.12);
    const dy = y - by;
    if (dx * dx + dy * dy <= (size * 0.035) ** 2) return BG;
  }
  return BG;
}

function makeIcon(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let off = 0;
  for (let y = 0; y < size; y++) {
    raw[off++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const px = drawPixel(x, y, size) || [0, 0, 0, 0];
      raw[off++] = px[0];
      raw[off++] = px[1];
      raw[off++] = px[2];
      raw[off++] = px[3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'public');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, makeIcon(size));
  console.log('wrote', file);
}
