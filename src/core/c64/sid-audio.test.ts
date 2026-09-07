import { describe, it, expect } from "vitest";
import { renderSid, PAL_CLOCK } from "./sid-audio.js";
import { SidWrite } from "./devices/sid.js";

/**
 * The renderer, checked on the two things it claims to be exact about.
 *
 * Timbre is approximated and says so, so asserting the shape of a sawtooth
 * would be asserting our own arbitrary choice. What must be right is *pitch*,
 * which is the chip's own divider, and *timing*, which is transcription from
 * the log — and those are exactly what experiment 9's hand-written synthesiser
 * got wrong by a factor of seven.
 */

/** The frequency register value for a wanted pitch, as a program computes it. */
const registerFor = (hz: number) => Math.round((hz * 16777216) / PAL_CLOCK);

/** Play one note: set the pitch, choose sawtooth, gate on, then off. */
function note(hz: number, cycles: number): SidWrite[] {
  const value = registerFor(hz);
  return [
    { cycle: 0, register: 24, value: 0x0f }, // full volume
    { cycle: 0, register: 5, value: 0x00 }, // instant attack, no decay
    { cycle: 0, register: 6, value: 0xf0 }, // full sustain, fastest release
    { cycle: 0, register: 0, value: value & 0xff },
    { cycle: 0, register: 1, value: (value >> 8) & 0xff },
    { cycle: 0, register: 4, value: 0x21 }, // sawtooth, gate on
    { cycle: cycles, register: 4, value: 0x20 }, // gate off
  ];
}

/** Estimate the pitch of a rendered span by counting rising zero crossings. */
function measure(samples: Float32Array, rate: number, from: number, to: number): number {
  let crossings = 0;
  for (let i = from + 1; i < to; i++) {
    if (samples[i - 1] < 0 && samples[i] >= 0) crossings += 1;
  }
  return (crossings * rate) / (to - from);
}

describe("a SID log, as sound", () => {
  it("plays the pitch the frequency register asks for", () => {
    // 440Hz, which nothing about this code knows is special.
    const audio = renderSid(note(440, PAL_CLOCK), { sampleRate: 44100 });
    const measured = measure(audio.samples, 44100, 4410, 39690);
    expect(measured).toBeGreaterThan(435);
    expect(measured).toBeLessThan(445);
  });

  it("holds the note for as long as the gate is down, not a fixed length", () => {
    // The factor-of-seven bug in one assertion: duration comes from the log.
    const short = renderSid(note(440, PAL_CLOCK / 4), { sampleRate: 22050 });
    const long = renderSid(note(440, PAL_CLOCK * 2), { sampleRate: 22050 });

    const sounding = (audio: { samples: Float32Array }) =>
      [...audio.samples].filter((s) => Math.abs(s) > 0.01).length;

    // Eight times the gate, and the sustained part scales with it — not
    // exactly eight because both carry the same release tail.
    expect(sounding(long) / sounding(short)).toBeGreaterThan(5);
  });

  it("counts the notes that actually sounded", () => {
    const twice = [...note(440, 1000), ...note(880, 3000).map((w) => ({ ...w, cycle: w.cycle + 2000 }))];
    expect(renderSid(twice, { sampleRate: 8000 }).gated).toBe(2);
  });

  it("is silent when nothing was ever gated", () => {
    const audio = renderSid([{ cycle: 0, register: 24, value: 0x0f }], { sampleRate: 8000 });
    expect(audio.gated).toBe(0);
    expect([...audio.samples].every((s) => s === 0)).toBe(true);
  });

  it("says what it approximated, and names the filter when one was used", () => {
    const plain = renderSid(note(440, 1000), { sampleRate: 8000 });
    expect(plain.approximated.join(" ")).toContain("waveform shape");
    expect(plain.approximated.join(" ")).not.toContain("filter");

    const filtered = renderSid([...note(440, 1000), { cycle: 0, register: 23, value: 0x01 }], {
      sampleRate: 8000,
    });
    expect(filtered.approximated.join(" ")).toContain("filter");
  });

  it("stops where it is told, for a log longer than anybody wants to hear", () => {
    const audio = renderSid(note(440, PAL_CLOCK * 60), { sampleRate: 8000, seconds: 2 });
    expect(audio.duration).toBeCloseTo(2, 1);
  });
});
