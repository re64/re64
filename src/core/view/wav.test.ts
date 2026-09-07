import { describe, it, expect } from "vitest";
import { encodeWav } from "./wav.js";

/** The header is the whole contract, so it is read back field by field. */
describe("WAV", () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const wav = encodeWav(samples, 44100);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const text = (at: number, length: number) =>
    String.fromCharCode(...wav.subarray(at, at + length));

  it("is a RIFF/WAVE file whose sizes agree with its length", () => {
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(text(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
  });

  it("declares uncompressed sixteen-bit mono at the rate it was given", () => {
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // channels
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(28, true)).toBe(44100 * 2); // bytes a second
    expect(view.getUint16(34, true)).toBe(16);
  });

  it("scales the samples and clamps the extremes rather than wrapping", () => {
    // A sample past ±1 wrapping to the other extreme is a click, not clipping.
    expect(view.getInt16(44, true)).toBe(0);
    // 0.5 * 32767 is 16383.5, and rounding goes up in both cases — which is
    // why these are not symmetric and should not be forced to be.
    expect(view.getInt16(46, true)).toBe(16384);
    expect(view.getInt16(48, true)).toBe(-16383);
    expect(view.getInt16(50, true)).toBe(32767);
    expect(view.getInt16(52, true)).toBe(-32767);

    const loud = encodeWav(new Float32Array([4, -4]), 8000);
    const loudView = new DataView(loud.buffer, loud.byteOffset, loud.byteLength);
    expect(loudView.getInt16(44, true)).toBe(32767);
    expect(loudView.getInt16(46, true)).toBe(-32767);
  });
});
