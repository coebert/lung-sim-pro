// PNG header checks for App Store icons (size, no alpha).
export function pngProblems(buf, label, expectedSize = '1024x1024') {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return [`${label} is not a PNG`];
  const out = [];
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), colorType = buf[25];
  if (`${w}x${h}` !== expectedSize) out.push(`${label} is ${w}x${h}, expected ${expectedSize}`);
  if (colorType === 4 || colorType === 6) out.push(`${label} has an alpha channel (App Store icons must be opaque)`);
  // tRNS chunk = transparency on palette/RGB images
  let o = 8;
  while (o + 8 <= buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8);
    if (type === 'tRNS') { out.push(`${label} has a transparency (tRNS) chunk`); break; }
    if (type === 'IDAT' || type === 'IEND') break;
    o += 12 + len;
  }
  return out;
}

