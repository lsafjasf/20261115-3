import { deflateSync, inflateSync } from "node:zlib";

const signature = Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10,
]);

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

export function encodePng(raster) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(raster.width, 0);
  header.writeUInt32BE(raster.height, 4);
  header[8] = 8;
  header[9] = 6;
  const rowSize = raster.width * 4;
  const raw = Buffer.alloc((rowSize + 1) * raster.height);
  for (let y = 0; y < raster.height; y += 1) {
    const target = y * (rowSize + 1);
    raw[target] = 0;
    Buffer.from(raster.data.buffer, raster.data.byteOffset, raster.data.length)
      .copy(raw, target + 1, y * rowSize, (y + 1) * rowSize);
  }
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const distanceLeft = Math.abs(estimate - left);
  const distanceUp = Math.abs(estimate - up);
  const distanceUpperLeft = Math.abs(estimate - upperLeft);
  if (distanceLeft <= distanceUp && distanceLeft <= distanceUpperLeft) {
    return left;
  }
  return distanceUp <= distanceUpperLeft ? up : upperLeft;
}

export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(signature)) {
    throw new Error("不是有效 PNG");
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) {
        throw new Error("测试解码器仅支持 8-bit RGBA 非隔行 PNG");
      }
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rowSize = width * 4;
  const data = new Uint8ClampedArray(width * height * 4);
  let previous = Buffer.alloc(rowSize);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (rowSize + 1)];
    const source = raw.subarray(
      y * (rowSize + 1) + 1,
      (y + 1) * (rowSize + 1),
    );
    const row = Buffer.alloc(rowSize);
    for (let index = 0; index < rowSize; index += 1) {
      const left = index >= 4 ? row[index - 4] : 0;
      const up = previous[index];
      const upperLeft = index >= 4 ? previous[index - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) predictor = paeth(left, up, upperLeft);
      row[index] = (source[index] + predictor) & 0xff;
    }
    data.set(row, y * rowSize);
    previous = row;
  }
  return { width, height, data };
}

export function pngDataUrl(raster) {
  return `data:image/png;base64,${encodePng(raster).toString("base64")}`;
}

export function rasterFromDataUrl(dataUrl) {
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return decodePng(Buffer.from(encoded, "base64"));
}
