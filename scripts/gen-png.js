// 生成 256x256 蓝紫渐变圆角图标 (build/icon.png)
// 纯 Node.js，无第三方依赖，electron-builder 会自动从 PNG 生成 .ico
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const RADIUS = 56; // 圆角半径，与 icon.svg 的 rx 一致

// 渐变两端颜色 (取自 icon.svg)
const C1 = [0x6c, 0x8c, 0xff]; // #6c8cff
const C2 = [0xa7, 0x8b, 0xfa]; // #a78bfa

// 判断点是否在圆角矩形内
function inRoundedRect(x, y) {
  const minX = 0, minY = 0, maxX = SIZE - 1, maxY = SIZE - 1;
  const cx = Math.max(minX + RADIUS, Math.min(x, maxX - RADIUS));
  const cy = Math.max(minY + RADIUS, Math.min(y, maxY - RADIUS));
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= RADIUS * RADIUS;
}

// 原始像素数据（每行前置 filter byte 0）
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (SIZE * 4 + 1);
  raw[rowStart] = 0; // filter: None
  for (let x = 0; x < SIZE; x++) {
    const t = (x + y) / (2 * (SIZE - 1)); // 对角渐变 0~1
    const r = Math.round(C1[0] + (C2[0] - C1[0]) * t);
    const g = Math.round(C1[1] + (C2[1] - C1[1]) * t);
    const b = Math.round(C1[2] + (C2[2] - C1[2]) * t);
    const inside = inRoundedRect(x, y);
    const o = rowStart + 1 + x * 4;
    raw[o] = r;
    raw[o + 1] = g;
    raw[o + 2] = b;
    raw[o + 3] = inside ? 255 : 0;
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);  // width
ihdr.writeUInt32BE(SIZE, 4);  // height
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // color type: RGBA
ihdr[10] = 0;  // compression
ihdr[11] = 0;  // filter
ihdr[12] = 0;  // interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.writeFileSync(out, png);
console.log('✓ 已生成', out, png.length, 'bytes');

// 同时生成 icon.ico（NSIS 安装器需要 .ico 格式）
// ICO 支持 PNG 压缩图像数据（Windows Vista+）
function buildIco(pngData) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);  // reserved
  header.writeUInt16LE(1, 2);  // type: icon
  header.writeUInt16LE(1, 4);  // count: 1

  const entry = Buffer.alloc(16);
  entry[0] = 0;                 // width 256 -> 0
  entry[1] = 0;                 // height 256 -> 0
  entry[2] = 0;                 // color count
  entry[3] = 0;                 // reserved
  entry.writeUInt16LE(1, 4);    // planes
  entry.writeUInt16LE(32, 6);   // bit count
  entry.writeUInt32LE(pngData.length, 8);  // size of image data
  entry.writeUInt32LE(22, 12);  // image offset (6 + 16)

  return Buffer.concat([header, entry, pngData]);
}

const icoOut = path.join(__dirname, '..', 'build', 'icon.ico');
fs.writeFileSync(icoOut, buildIco(png));
console.log('✓ 已生成', icoOut);
