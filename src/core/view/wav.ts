/**
 * Samples to a WAV file.
 *
 * The audio twin of `png.ts`, and it exists for the same reason: the analysis
 * returns *data* — here a `Float32Array` and a rate — and one encoder at the
 * edge turns that into something a person can open. Sixteen-bit mono PCM,
 * because it is the format every player reads without negotiation and the
 * header is forty-four bytes.
 *
 * No compression, for the same reason as the PNG: a compressor is a dependency,
 * and `src/core/` does not take one for a convenience.
 */

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

const le16 = (value: number): number[] => [value & 0xff, (value >> 8) & 0xff];
const le32 = (value: number): number[] => [
  value & 0xff,
  (value >> 8) & 0xff,
  (value >> 16) & 0xff,
  (value >>> 24) & 0xff,
];

/** Mono sixteen-bit PCM, from samples in [-1, 1]. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const channels = 1;
  const bits = 16;
  const blockAlign = (channels * bits) / 8;
  const dataSize = samples.length * blockAlign;

  const header = [
    ...ascii("RIFF"),
    ...le32(36 + dataSize),
    ...ascii("WAVE"),
    ...ascii("fmt "),
    ...le32(16), // the size of this chunk
    ...le16(1), // PCM, uncompressed
    ...le16(channels),
    ...le32(sampleRate),
    ...le32(sampleRate * blockAlign), // bytes a second
    ...le16(blockAlign),
    ...le16(bits),
    ...ascii("data"),
    ...le32(dataSize),
  ];

  const out = new Uint8Array(header.length + dataSize);
  out.set(header, 0);

  const view = new DataView(out.buffer, header.length);
  for (let i = 0; i < samples.length; i++) {
    // Clamped before scaling: a sample past ±1 would wrap to the opposite
    // extreme as a signed integer, which is heard as a click rather than as
    // distortion.
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, Math.round(clamped * 32767), true);
  }
  return out;
}
