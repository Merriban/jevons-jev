// Minimal PNG tEXt chunk helpers (no dependencies). Used to stamp the share
// images with the hash of the inputs they were rendered from, so a test can
// tell when they are stale.
import { crc32 } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunks(png) {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");
  const out = [];
  for (let i = 8; i < png.length; ) {
    const len = png.readUInt32BE(i);
    const type = png.toString("latin1", i + 4, i + 8);
    out.push({ type, start: i, data: png.subarray(i + 8, i + 8 + len) });
    i += 12 + len;
  }
  return out;
}

export function pngSize(png) {
  const ihdr = chunks(png).find((c) => c.type === "IHDR");
  return { width: ihdr.data.readUInt32BE(0), height: ihdr.data.readUInt32BE(4) };
}

export function readTextChunks(png) {
  const text = {};
  for (const c of chunks(png).filter((c) => c.type === "tEXt")) {
    const sep = c.data.indexOf(0);
    text[c.data.toString("latin1", 0, sep)] = c.data.toString("latin1", sep + 1);
  }
  return text;
}

export function addTextChunks(png, entries) {
  const iend = chunks(png).find((c) => c.type === "IEND").start;
  const extra = Object.entries(entries).map(([k, v]) => {
    const data = Buffer.from(`${k}\0${v}`, "latin1");
    const type = Buffer.from("tEXt", "latin1");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([type, data])) >>> 0);
    return Buffer.concat([len, type, data, crc]);
  });
  return Buffer.concat([png.subarray(0, iend), ...extra, png.subarray(iend)]);
}
