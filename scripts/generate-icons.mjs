import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const SUPERSAMPLE = 4;

// Geometria na siatce 64x64 zgodna z public/favicon.svg
const BG_RECT = { x: 2, y: 2, w: 60, h: 60, r: 14 };
const GANTT_BARS = [
  { x: 12, y: 16, w: 20, h: 7, r: 3.5 },
  { x: 19, y: 28.5, w: 28, h: 7, r: 3.5 },
  { x: 28, y: 41, w: 24, h: 7, r: 3.5 },
];

// Kolory zgodne ze stylem aplikacji (sky-700 #0369a1 + biały #ffffff)
const BG_COLOR = { r: 3, g: 105, b: 161 };
const BAR_COLOR = { r: 255, g: 255, b: 255 };

const TARGETS = [
  { filename: 'favicon-32.png', size: 32 },
  { filename: 'apple-touch-icon.png', size: 180 },
  { filename: 'icon-192.png', size: 192 },
  { filename: 'icon-512.png', size: 512 },
];

// Tablica CRC32 dla chunków PNG
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bitów na kanał
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // DEFLATE
  ihdr[11] = 0; // Standardowy filtr
  ihdr[12] = 0; // Bez przeplotu

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // Filter type 0 (None)
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function isInsideRoundedRect(px, py, rect) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const halfW = rect.w / 2 - rect.r;
  const halfH = rect.h / 2 - rect.r;
  const dx = Math.max(Math.abs(px - cx) - halfW, 0);
  const dy = Math.max(Math.abs(py - cy) - halfH, 0);
  return dx * dx + dy * dy <= rect.r * rect.r;
}

function renderIconRgba(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const samplesPerPixel = SUPERSAMPLE * SUPERSAMPLE;
  const scale = 64 / size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let accR = 0;
      let accG = 0;
      let accB = 0;
      let accA = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        const py = (y + (sy + 0.5) / SUPERSAMPLE) * scale;
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const px = (x + (sx + 0.5) / SUPERSAMPLE) * scale;
          if (!isInsideRoundedRect(px, py, BG_RECT)) {
            continue;
          }

          let isBar = false;
          for (let i = 0; i < GANTT_BARS.length; i++) {
            if (isInsideRoundedRect(px, py, GANTT_BARS[i])) {
              isBar = true;
              break;
            }
          }

          const color = isBar ? BAR_COLOR : BG_COLOR;
          accR += color.r;
          accG += color.g;
          accB += color.b;
          accA += 1;
        }
      }

      const offset = (y * size + x) * 4;
      if (accA === 0) {
        rgba[offset] = 0;
        rgba[offset + 1] = 0;
        rgba[offset + 2] = 0;
        rgba[offset + 3] = 0;
      } else {
        // Odmnożenie alfa (unpremultiply), aby wygładzone krawędzie nie miały ciemnej obwódki
        rgba[offset] = Math.round(accR / accA);
        rgba[offset + 1] = Math.round(accG / accA);
        rgba[offset + 2] = Math.round(accB / accA);
        rgba[offset + 3] = Math.round((accA / samplesPerPixel) * 255);
      }
    }
  }

  return rgba;
}

function main() {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
  for (const target of TARGETS) {
    const rgba = renderIconRgba(target.size);
    const png = encodePng(target.size, target.size, rgba);
    const outPath = path.join(PUBLIC_DIR, target.filename);
    fs.writeFileSync(outPath, png);
    process.stdout.write(`Wygenerowano ${path.relative(process.cwd(), outPath)} (${target.size}x${target.size}, ${png.length} B)\n`);
  }
}

main();
