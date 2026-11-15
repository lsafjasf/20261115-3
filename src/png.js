// Dependency-free PNG encoder (truecolor RGBA, 8-bit).
// Uses valid DEFLATE "stored" blocks so no zlib is required in the browser.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

// DEFLATE stream made of uncompressed stored blocks (BTYPE=00).
function deflateStored(data) {
  const blocks = [];
  let offset = 0;
  const totalBlocks = Math.ceil(data.length / 65535);
  let blockIndex = 0;
  do {
    const chunk = data.subarray(offset, offset + 65535);
    const isFinal = blockIndex === totalBlocks - 1;
    const header = new Uint8Array(5);
    // BFINAL in bit 0, BTYPE=00 (stored) in bits 1-2 -> byte is 0x01 or 0x00.
    header[0] = isFinal ? 1 : 0;
    const len = chunk.length;
    header[1] = len & 0xFF;
    header[2] = (len >> 8) & 0xFF;
    const nlen = 0xFFFF ^ len;
    header[3] = nlen & 0xFF;
    header[4] = (nlen >> 8) & 0xFF;
    blocks.push(header, chunk);
    offset += chunk.length;
    blockIndex += 1;
  } while (offset < data.length);
  const total = blocks.reduce((sum, block) => sum + block.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const block of blocks) {
    out.set(block, pos);
    pos += block.length;
  }
  return out;
}

function chunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const output = new Uint8Array(4 + body.length + 4);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.length);
  output.set(body, 4);
  view.setUint32(4 + body.length, crc32(body));
  return output;
}

// framebuffer: { width, height, data: Uint8Array (RGBA) }
export function encodePng(framebuffer) {
  const { width, height, data } = framebuffer;
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type 0 (none)
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const zlibHeader = Uint8Array.from([0x78, 0x01]);
  const deflated = deflateStored(raw);
  const checksum = new Uint8Array(4);
  new DataView(checksum.buffer).setUint32(0, adler32(raw));
  const zlib = new Uint8Array(zlibHeader.length + deflated.length + 4);
  zlib.set(zlibHeader, 0);
  zlib.set(deflated, zlibHeader.length);
  zlib.set(checksum, zlibHeader.length + deflated.length);

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib),
    chunk('IEND', new Uint8Array(0)),
  ];
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(length);
  let pos = 0;
  for (const part of parts) {
    png.set(part, pos);
    pos += part.length;
  }
  return png;
}
