/**
 * A SID write log, as sound.
 *
 * **This reverses a decision, and the reason is worth keeping.** `sid.ts` argues
 * that a timestamped register-write trace is the honest answer and that
 * synthesising audio is a much larger thing — which is true, and is still the
 * reason the *capture* is a log. What changed is that a second question turned
 * up: experiment 9's deliverable was an article, and the question there is not
 * only "which routine makes that noise" but "what did it sound like".
 *
 * The measurement that settles it: the editor of that run had the capture from
 * the beginning and used it only to check pitches, then wrote its own
 * synthesiser from its reading of the game's *stream format* — and got every
 * note the same length, wrong by a factor of seven, because it missed a tempo
 * divider. The right answer was mechanical transcription from a file it had
 * already downloaded. It lost because the wrong path was the cheap one.
 *
 * ## What is exact, and what is not
 *
 * Almost nothing here is a model of the chip, and that is the point:
 *
 * | | |
 * |---|---|
 * | **when a note starts and stops** | exact — the gate bit, at its own cycle |
 * | **pitch** | exact — the frequency register is a divider, nothing more |
 * | **envelope times** | exact as programmed; the *curve* is approximated |
 * | **which waveform** | exact as selected; its *shape* is ours |
 * | **the filter** | **not modelled at all** |
 *
 * So a rendering is right about every note and every duration and approximate
 * about timbre. That is stated on the result rather than left to be discovered,
 * because a recording that sounds plausible is exactly the confident wrong
 * answer this project refuses everywhere else.
 *
 * Not reSID: it is GPL and C++, which is the same pair of reasons SLEIGH cannot
 * be used here — licence, and it cannot go where this analysis goes.
 */

import { SidWrite } from "./devices/sid.js";

/** PAL, which is the machine these captures come from. */
export const PAL_CLOCK = 985248;

export interface SidAudio {
  sampleRate: number;
  /** Mono, in [-1, 1]. */
  samples: Float32Array;
  /** Seconds. */
  duration: number;
  /** What was left out, so a listener knows what they are hearing. */
  approximated: string[];
  /** Notes actually sounded, which is the number an article wants to quote. */
  gated: number;
}

export interface SidOptions {
  sampleRate?: number;
  clock?: number;
  /** Stop here rather than at the last write, in seconds. */
  seconds?: number;
}

/** Attack times, milliseconds from silence to full, as the chip defines them. */
const ATTACK_MS = [2, 8, 16, 24, 38, 56, 68, 80, 100, 250, 500, 800, 1000, 3000, 5000, 8000];
/** Decay and release, milliseconds for a full fall. */
const FALL_MS = [6, 24, 48, 72, 114, 168, 204, 240, 300, 750, 1500, 2400, 3000, 9000, 15000, 24000];

interface Voice {
  frequency: number;
  control: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  pulseWidth: number;
  /** Envelope level, and which phase it is in. */
  level: number;
  /** Whether attack has finished, so decay does not restart it. */
  peaked: boolean;
  gated: boolean;
  phase: number;
  noise: number;
}

const voice = (): Voice => ({
  frequency: 0,
  control: 0,
  attack: 0,
  decay: 0,
  sustain: 0,
  release: 0,
  pulseWidth: 0x800,
  level: 0,
  peaked: false,
  gated: false,
  phase: 0,
  noise: 0x7ffff8,
});

/** Which register belongs to which voice, and what it means. */
const VOICE_OF = (register: number): { voice: number; field: number } | undefined => {
  if (register >= 21) return undefined;
  return { voice: Math.floor(register / 7), field: register % 7 };
};

/**
 * Replay the log, and produce samples.
 *
 * The log is the clock: every write carries the cycle it happened on, so the
 * rendering advances to that cycle and applies it. Nothing is quantised to a
 * frame, which is why a note lands where the program put it rather than where a
 * frame boundary would.
 */
export function renderSid(writes: readonly SidWrite[], options: SidOptions = {}): SidAudio {
  const sampleRate = options.sampleRate ?? 44100;
  const clock = options.clock ?? PAL_CLOCK;
  const voices = [voice(), voice(), voice()];
  let volume = 15;
  let filtered = false;

  const lastCycle = writes.length ? writes[writes.length - 1].cycle : 0;
  // A tail, so the last note's release is heard rather than cut off.
  const cycles = Math.min(
    lastCycle + clock,
    options.seconds === undefined ? Infinity : options.seconds * clock
  );
  const total = Math.max(1, Math.ceil((cycles / clock) * sampleRate));
  const samples = new Float32Array(total);

  let gated = 0;
  let write = 0;
  const cyclesPerSample = clock / sampleRate;

  for (let index = 0; index < total; index++) {
    const now = index * cyclesPerSample;

    // Apply everything that happened before this sample.
    while (write < writes.length && writes[write].cycle <= now) {
      const { register, value } = writes[write++];
      const which = VOICE_OF(register);
      if (which) {
        const v = voices[which.voice];
        switch (which.field) {
          case 0:
            v.frequency = (v.frequency & 0xff00) | value;
            break;
          case 1:
            v.frequency = (v.frequency & 0x00ff) | (value << 8);
            break;
          case 2:
            v.pulseWidth = (v.pulseWidth & 0x0f00) | value;
            break;
          case 3:
            v.pulseWidth = (v.pulseWidth & 0x00ff) | ((value & 0x0f) << 8);
            break;
          case 4: {
            const nowGated = (value & 1) === 1;
            if (nowGated && !v.gated) gated += 1;
            v.gated = nowGated;
            v.control = value;
            break;
          }
          case 5:
            v.attack = (value >> 4) & 0x0f;
            v.decay = value & 0x0f;
            break;
          case 6:
            v.sustain = ((value >> 4) & 0x0f) / 15;
            v.release = value & 0x0f;
            break;
        }
      } else if (register === 24) {
        volume = value & 0x0f;
      } else if (register === 23 && (value & 0x0f) !== 0) {
        filtered = true;
      }
    }

    let mixed = 0;
    for (const v of voices) {
      // Pitch: the register is a divider and nothing else, so this is not a
      // model of anything — it is the chip's own arithmetic.
      const hz = (v.frequency * clock) / 16777216;
      v.phase = (v.phase + hz / sampleRate) % 1;

      // Envelope. The times are the ones the program asked for; the shapes are
      // linear where the chip's are not, which is the approximation.
      const seconds = 1 / sampleRate;
      if (v.gated) {
        if (v.level < 1 && !v.peaked) {
          // Attack: silence to full in the time the program asked for.
          v.level = Math.min(1, v.level + (1000 / ATTACK_MS[v.attack]) * seconds);
          if (v.level >= 1) v.peaked = true;
        } else {
          // Decay, down to the sustain level and no further.
          v.peaked = true;
          v.level = Math.max(v.sustain, v.level - (1000 / FALL_MS[v.decay]) * seconds);
        }
      } else {
        v.peaked = false;
        const releasePerSecond = 1000 / FALL_MS[v.release];
        v.level = Math.max(0, v.level - releasePerSecond * seconds);
      }
      if (v.level <= 0 || hz <= 0) continue;

      mixed += wave(v) * v.level;
    }

    samples[index] = Math.max(-1, Math.min(1, (mixed / 3) * (volume / 15)));
  }

  const approximated = [
    "waveform shape and envelope curve are ours; the chip's are not these",
  ];
  if (filtered) {
    approximated.push(
      "this program uses the SID filter, which is not modelled at all — voices " +
        "routed through it are heard unfiltered"
    );
  }

  return {
    sampleRate,
    samples,
    duration: total / sampleRate,
    approximated,
    gated,
  };
}

/**
 * One voice's waveform at its current phase.
 *
 * Combined waveforms — two bits set at once — are not what the chip does, which
 * is a lookup through a partly undocumented AND of the two. Picking the lowest
 * set bit is a stand-in, and it is in the approximation list.
 */
function wave(v: Voice): number {
  const form = (v.control >> 4) & 0x0f;
  if (form & 0x08) {
    // Noise: the chip's own 23-bit shift register, which is exactly specified.
    v.noise = ((v.noise << 1) | (((v.noise >> 22) ^ (v.noise >> 17)) & 1)) & 0x7fffff;
    return ((v.noise >> 12) & 0xff) / 128 - 1;
  }
  if (form & 0x01) {
    // Triangle.
    return v.phase < 0.5 ? v.phase * 4 - 1 : 3 - v.phase * 4;
  }
  if (form & 0x02) {
    // Sawtooth.
    return v.phase * 2 - 1;
  }
  if (form & 0x04) {
    // Pulse, at the width the program set.
    return v.phase < v.pulseWidth / 4096 ? 1 : -1;
  }
  return 0;
}
