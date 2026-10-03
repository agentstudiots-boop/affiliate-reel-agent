// Builds a realistic WhatsApp voice note: Ogg container, Opus codec (libopus via opusscript), mono, 16 kHz input rate,
// 20 ms frames, OpusHead + OpusTags + audio pages with correct granule positions and CRCs.
const OpusScript = require('opusscript');

const crcTable = Array.from({ length: 256 }, (_, i) => { let r = i << 24; for (let j = 0; j < 8; j++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) : (r << 1); return r >>> 0; });
function crc(bytes) { let c = 0; for (const byte of bytes) c = ((c << 8) ^ crcTable[((c >>> 24) ^ byte) & 255]) >>> 0; return c >>> 0; }

function page(packets, { serial = 0x1234, seq, granule, flags }) {
  const lacing = [];
  for (const packet of packets) { let left = packet.length; while (left >= 255) { lacing.push(255); left -= 255; } lacing.push(left); }
  const header = Buffer.alloc(27 + lacing.length);
  header.write('OggS', 0, 'latin1'); header[4] = 0; header[5] = flags;
  header.writeBigUInt64LE(BigInt(granule), 6); header.writeUInt32LE(serial, 14); header.writeUInt32LE(seq, 18);
  header[26] = lacing.length; lacing.forEach((v, i) => { header[27 + i] = v; });
  const out = Buffer.concat([header, ...packets]);
  out.writeUInt32LE(crc(out), 22);
  return out;
}

// `signal(t)` returns a sample in [-1,1] for time t seconds.
function whatsappVoiceNote(seconds, signal) {
  const rate = 16000, frame = 320, channels = 1;
  const encoder = new OpusScript(rate, channels, OpusScript.Application.VOIP);
  const head = Buffer.alloc(19); head.write('OpusHead', 0, 'latin1'); head[8] = 1; head[9] = channels; head.writeUInt16LE(312, 10); head.writeUInt32LE(rate, 12);
  const vendor = Buffer.from('libopus test'); const tags = Buffer.concat([Buffer.from('OpusTags'), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(vendor.length); return b; })(), vendor, Buffer.alloc(4)]);
  const pages = [page([head], { seq: 0, granule: 0, flags: 2 }), page([tags], { seq: 1, granule: 0, flags: 0 })];
  const total = Math.floor(seconds * rate / frame);
  let seq = 2, batch = [], count = 0;
  for (let n = 0; n < total; n++) {
    const pcm = Buffer.alloc(frame * 2);
    for (let i = 0; i < frame; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, signal((n * frame + i) / rate))) * 20000), i * 2);
    batch.push(Buffer.from(encoder.encode(pcm, frame))); count++;
    const last = n === total - 1;
    if (batch.length === 25 || last) {
      pages.push(page(batch, { seq: seq++, granule: 312 + count * frame * 3, flags: last ? 4 : 0 }));
      batch = [];
    }
  }
  encoder.delete();
  return Buffer.concat(pages);
}

// Speech-like test signal: syllable-rate amplitude modulation over a voiced harmonic stack (~150 Hz).
const speechLike = t => {
  const syllable = Math.max(0, Math.sin(2 * Math.PI * 3.5 * t));
  return 0.5 * syllable * [1, 2, 3, 5, 8].reduce((sum, k) => sum + Math.sin(2 * Math.PI * 150 * k * t) / k, 0) / 2;
};

module.exports = { whatsappVoiceNote, speechLike, page };
