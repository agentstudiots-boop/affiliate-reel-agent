// Audio preparation for operator voice messages: identify the real format from the bytes, and turn WhatsApp's Ogg/Opus
// voice notes into plain 16 kHz mono PCM WAV (a format every transcription model accepts). Nothing is stored.

export type AudioInfo = {
  container: "ogg" | "wav" | "mp3" | "flac" | "unknown";
  codec: "opus" | "vorbis" | "speex" | "flac" | "pcm" | "mp3" | "unknown";
  channels: number | null;
  sampleRate: number | null;
  seconds: number | null;
  bytes: number;
};
export type PreparedAudio = { bytes: Uint8Array; mime: string; info: AudioInfo };
export type AudioFailure = "unsupported_format" | "too_long" | "undecodable" | "silent";
export class AudioError extends Error {
  constructor(readonly code: AudioFailure, readonly detail: string | null = null) { super(code); this.name = "AudioError"; }
}

export const MAX_AUDIO_SECONDS = 120;
const TARGET_RATE = 16_000;
const ascii = (b: Uint8Array, at: number, text: string) => text.length + at <= b.length && [...text].every((c, i) => b[at + i] === c.charCodeAt(0));

// Walks the Ogg pages (RFC 3533): codec of the first stream from its first packet, duration from the last granule position.
function inspectOgg(b: Uint8Array): AudioInfo {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const info: AudioInfo = { container: "ogg", codec: "unknown", channels: null, sampleRate: null, seconds: null, bytes: b.length };
  let at = 0, preSkip = 0, granule = -1, first = true;
  while (at + 27 <= b.length && ascii(b, at, "OggS")) {
    const segments = b[at + 26];
    if (at + 27 + segments > b.length) break;
    let payload = 0;
    for (let i = 0; i < segments; i++) payload += b[at + 27 + i];
    const body = at + 27 + segments;
    if (first) {
      first = false;
      if (ascii(b, body, "OpusHead") && body + 19 <= b.length) {
        info.codec = "opus"; info.channels = b[body + 9]; preSkip = view.getUint16(body + 10, true); info.sampleRate = view.getUint32(body + 12, true);
      } else if (b[body] === 1 && ascii(b, body + 1, "vorbis") && body + 16 <= b.length) {
        info.codec = "vorbis"; info.channels = b[body + 11]; info.sampleRate = view.getUint32(body + 12, true);
      } else if (ascii(b, body, "Speex   ")) info.codec = "speex";
      else if (b[body] === 0x7f && ascii(b, body + 1, "FLAC")) info.codec = "flac";
    }
    const low = view.getUint32(at + 6, true), high = view.getUint32(at + 10, true);
    if (!(low === 0xffffffff && high === 0xffffffff)) granule = high * 2 ** 32 + low;
    at = body + payload;
  }
  if (granule > 0) info.seconds = Math.max(0, granule - preSkip) / (info.codec === "opus" ? 48_000 : info.sampleRate || 48_000);
  return info;
}

export function inspectAudio(b: Uint8Array): AudioInfo {
  const unknown: AudioInfo = { container: "unknown", codec: "unknown", channels: null, sampleRate: null, seconds: null, bytes: b.length };
  if (ascii(b, 0, "OggS")) return inspectOgg(b);
  if (ascii(b, 0, "RIFF") && ascii(b, 8, "WAVE")) {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const pcm = b.length >= 36 && ascii(b, 12, "fmt ") && view.getUint16(20, true) === 1;
    return { ...unknown, container: "wav", codec: pcm ? "pcm" : "unknown", channels: pcm ? view.getUint16(22, true) : null, sampleRate: pcm ? view.getUint32(24, true) : null };
  }
  if (ascii(b, 0, "fLaC")) return { ...unknown, container: "flac", codec: "flac" };
  if (ascii(b, 0, "ID3") || (b.length > 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0)) return { ...unknown, container: "mp3", codec: "mp3" };
  return unknown;
}

function wav(samples: Float32Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2), view = new DataView(out.buffer);
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) out[at + i] = value.charCodeAt(i); };
  text(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVEfmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  return out;
}

async function opusToWav(b: Uint8Array, info: AudioInfo): Promise<Uint8Array> {
  if (info.seconds !== null && info.seconds > MAX_AUDIO_SECONDS) throw new AudioError("too_long", `${Math.round(info.seconds)}s`);
  const { OggOpusDecoder } = await import("ogg-opus-decoder");
  const decoder = new OggOpusDecoder({ sampleRate: TARGET_RATE } as ConstructorParameters<typeof OggOpusDecoder>[0]);
  try {
    await decoder.ready;
    const decoded = await decoder.decodeFile(b);
    // The package accepts `sampleRate` although its typings omit it; trust only what it reports back.
    const rate = decoded.sampleRate as number;
    const length = decoded.samplesDecoded;
    if (!length || !decoded.channelData.length) throw new AudioError("undecodable", "no samples");
    // Decoder errors are tolerated only if most of the audio survived.
    if (decoded.errors.length > 0 && length < rate * 0.3) throw new AudioError("undecodable", decoded.errors[0]?.message?.slice(0, 80) ?? "decode errors");
    const mono = new Float32Array(length);
    for (const channel of decoded.channelData) for (let i = 0; i < length; i++) mono[i] += channel[i] / decoded.channelData.length;
    if (length / rate > MAX_AUDIO_SECONDS) throw new AudioError("too_long", `${Math.round(length / rate)}s`);
    let energy = 0, peak = 0;
    for (let i = 0; i < length; i++) { energy += mono[i] * mono[i]; peak = Math.max(peak, Math.abs(mono[i])); }
    if (length < rate * 0.3 || peak < 0.002 || Math.sqrt(energy / length) < 0.0005) throw new AudioError("silent");
    return wav(mono, rate);
  } catch (error) {
    if (error instanceof AudioError) throw error;
    throw new AudioError("undecodable", error instanceof Error ? error.name : "unknown");
  } finally { decoder.free(); }
}

export async function prepareAudio(bytes: Uint8Array): Promise<PreparedAudio> {
  const info = inspectAudio(bytes);
  if (info.container === "ogg" && info.codec === "opus") return { bytes: await opusToWav(bytes, info), mime: "audio/wav", info };
  // Already a plain format with a trustworthy signature: pass through with its real MIME type.
  if (info.container === "wav" && info.codec === "pcm") return { bytes, mime: "audio/wav", info };
  if (info.container === "mp3") return { bytes, mime: "audio/mpeg", info };
  if (info.container === "flac") return { bytes, mime: "audio/flac", info };
  throw new AudioError("unsupported_format", `${info.container}/${info.codec}`);
}
