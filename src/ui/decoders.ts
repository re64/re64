/**
 * Running a decoder here, rather than asking the server to.
 *
 * A decoder is analysis, and analysis belongs where the person is. This project
 * already disassembles in the browser so that renaming a label does not
 * round-trip; sliding a width in the explorer and watching a picture change has
 * exactly the same feel, and sending each attempt to a server would put a
 * network hop inside a loop somebody is doing by hand. The server keeps its own
 * runner for agents, who have no browser to run one in.
 *
 * The isolation is the same on both sides — SES for authority, a worker for
 * termination — and `validateDecoded` in core is literally the same function, so
 * a decoder that is rejected here is rejected there for the same reason.
 */

import { Decoded, validateDecoded } from "../core/index.js";

export interface DecoderOutcome {
  ok: boolean;
  decoded?: Decoded;
  why?: string;
  ms: number;
}

/** Matches the server's, so a decoder does not pass in one place and fail in the other. */
export const DECODER_TIMEOUT_MS = 2000;

export function runDecoder(
  source: string,
  bytes: readonly (number | undefined)[],
  params: Record<string, unknown> = {},
  timeoutMs = DECODER_TIMEOUT_MS
): Promise<DecoderOutcome> {
  const started = performance.now();
  // Missing bytes become zero: a decoder should not have to know the map has
  // edges, and `undefined` would arrive as `null`.
  const supplied = Array.from(bytes, (b) => b ?? 0);

  return new Promise<DecoderOutcome>((resolve) => {
    let settled = false;
    // A fresh worker per run, so one decoder cannot leave anything behind for
    // the next — the same guarantee the server gets from a fresh thread.
    const worker = new Worker("/decoder-worker.js");

    const finish = (outcome: Omit<DecoderOutcome, "ms">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve({ ...outcome, ms: Math.round(performance.now() - started) });
    };

    // The whole reason a worker is used at all: SES can take away a decoder's
    // authority, but looping forever is not a permission.
    const timer = setTimeout(
      () =>
        finish({
          ok: false,
          why:
            `The decoder was still running after ${timeoutMs}ms and was stopped. ` +
            `That is usually a loop that never reaches its end condition.`,
        }),
      timeoutMs
    );

    worker.onmessage = (event: MessageEvent<{ ok: boolean; value?: unknown; why?: string }>) => {
      if (!event.data.ok) return finish({ ok: false, why: event.data.why });
      const checked = validateDecoded(event.data.value);
      finish(checked.ok ? { ok: true, decoded: checked.decoded } : { ok: false, why: checked.why });
    };

    worker.onerror = (event) => finish({ ok: false, why: event.message || "the decoder failed to load" });

    // Handlers first, then the work: a worker that replied before `onmessage`
    // was attached would look exactly like one that never replied at all.
    worker.postMessage({ source, bytes: supplied, params });
  });
}
