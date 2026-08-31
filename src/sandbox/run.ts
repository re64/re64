/**
 * Running a decoder somebody wrote.
 *
 * The escape hatch that stops re64 growing a mechanism per oddity. A character
 * set is a permutation and a sprite is a bitmap, but a title screen packed with
 * run-length encoding and partial frame updates is *assembler logic*, and the
 * only honest way to express that is code. This is a way for a reverse engineer
 * to say it in a modern language.
 *
 * A decoder is a pure function from bytes to data — see `Decoded`. It never
 * touches a screen, which is why one decoder serves the browser, the CLI and an
 * agent alike, and why a hostile one can do nothing but waste its own time.
 *
 * **Not used for listing rows.** `analyze()` is synchronous and this is not, so
 * the built-in formats draw the listing and decoders drive the explorer and the
 * tools. Rendering a snippet inline would mean caching results out of band and
 * repainting when they arrive, which is a separate decision and a larger one.
 */

import { Worker } from "node:worker_threads";
import { Decoded, validateDecoded } from "../core/index.js";

export interface DecoderResult {
  ok: boolean;
  decoded?: Decoded;
  /** Why it produced nothing, in terms its author can act on. */
  why?: string;
  /** How long it ran, which is the number that matters when it is slow. */
  ms: number;
}

/**
 * Long enough for a screen's worth of run-length decoding, short enough that a
 * mistake is noticed rather than endured. A loop that never ends is the ordinary
 * failure here, not the exotic one.
 */
export const DECODER_TIMEOUT_MS = 2000;

/**
 * The worker, inline rather than a file beside this one.
 *
 * Two mechanisms run here, because neither is sufficient alone:
 *
 * - **SES** removes the *authority* to have side effects. A `Compartment` gets
 *   no ambient globals — no `fetch`, no `process`, no `require`, no DOM —
 *   `lockdown()` freezes the intrinsics so one decoder cannot poison another,
 *   and `Date.now()` and `Math.random()` throw, so the same bytes give the same
 *   answer every time. A function that can only compute cannot inject.
 * - **A worker thread** supplies the one thing SES cannot: an infinite loop is
 *   not a permissions problem and no compartment can interrupt one. A thread can
 *   be terminated. It also keeps `lockdown()` off the main realm, which matters,
 *   because hardening the intrinsics is process-wide and the server shares its
 *   realm with everything else.
 *
 * Inline because a path would have to resolve differently from source and from
 * `dist`, and the failure mode of getting that wrong is running a *stale*
 * sandbox — which is not a class of bug to accept in the one file whose job is
 * to contain somebody else's code.
 */
const WORKER_SOURCE = `
  const { parentPort, workerData } = require("node:worker_threads");
  require("ses");

  // errorTaming keeps stack traces readable. It leaks nothing a decoder could
  // not learn about its own code, and whoever wrote it needs to know which line
  // threw.
  lockdown({ errorTaming: "unsafe" });

  const { source, bytes, params } = workerData;

  try {
    const compartment = new Compartment();
    // Wrapped rather than imported: a compartment evaluates an expression, and
    // this hands the decoder its arguments by name without endowing the
    // compartment with anything that outlives the call.
    const decode = compartment.evaluate("(function (bytes, params) {\\n" + source + "\\n})");

    // A copy. SES stops a decoder reaching the outside world; it does not stop
    // one scribbling on what it was handed, and those are the loaded program.
    const result = decode(bytes.slice(), params);

    // Back across the boundary as plain data. Anything that will not survive
    // that was never a valid result.
    parentPort.postMessage({ ok: true, value: JSON.parse(JSON.stringify(result ?? null)) });
  } catch (error) {
    parentPort.postMessage({ ok: false, why: String(error) });
  }
`;

export async function runDecoder(
  source: string,
  bytes: readonly (number | undefined)[],
  params: Record<string, unknown> = {},
  timeoutMs = DECODER_TIMEOUT_MS
): Promise<DecoderResult> {
  const started = Date.now();
  // Missing bytes become zero rather than undefined: a decoder should not have
  // to know that the map has edges, and `undefined` would arrive as `null`.
  const supplied = bytes.map((b) => b ?? 0);

  return new Promise<DecoderResult>((resolve) => {
    let settled = false;
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { source, bytes: supplied, params },
    });

    const finish = (result: Omit<DecoderResult, "ms">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve({ ...result, ms: Date.now() - started });
    };

    // The reason a thread is used at all. SES can take away a decoder's
    // authority; it cannot take away its ability to loop forever.
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

    worker.on("message", (message: { ok: boolean; value?: unknown; why?: string }) => {
      if (!message.ok) return finish({ ok: false, why: message.why });
      const checked = validateDecoded(message.value);
      finish(checked.ok ? { ok: true, decoded: checked.decoded } : { ok: false, why: checked.why });
    });

    worker.on("error", (error) => finish({ ok: false, why: String(error) }));
    worker.on("exit", (code) => {
      if (code !== 0) finish({ ok: false, why: `The decoder stopped with exit code ${code}` });
    });
  });
}
