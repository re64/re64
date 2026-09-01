/**
 * Running a decoder **synchronously**, in this realm.
 *
 * The worker in `run.ts` is the safe way and stays the default for anything a
 * caller asks for explicitly. This exists for the one thing a worker cannot do:
 * a listing is built in a single synchronous pass, and a row cannot await. A
 * program with its own character set is the ordinary case on this machine, and
 * without this a text region can only be rendered by one of three built-in
 * encodings — none of which can read it, so declaring the span `text` produces
 * confident nonsense.
 *
 * **What is given up, stated plainly.** A worker supplies termination; this does
 * not. A decoder that loops forever hangs whatever called it — a browser tab, a
 * `re64 disasm`, or the server's event loop and with it every connected client.
 * Nothing here can interrupt it, because interrupting synchronous JavaScript is
 * not possible from inside the same realm.
 *
 * **What is kept.** SES still removes the authority to have side effects: no
 * network, no filesystem, no clock, no randomness. A decoder can waste time; it
 * cannot reach anything. That is the half of the guarantee that matters for code
 * arriving in a project file, and it is not weakened here.
 *
 * `lockdown()` hardens this realm's intrinsics process-wide, which was the other
 * reason to prefer a worker. Measured before relying on it: the analysis, the
 * Yjs document and the SQLite store all work unchanged under it.
 *
 * If the loop risk ever bites, the escape is not to re-isolate this call — it is
 * to move the *whole* analysis into a worker and make it asynchronous, which
 * removes the constraint that created this file.
 */

import "ses";

declare const lockdown: (options?: Record<string, unknown>) => void;
declare const Compartment: new (endowments?: Record<string, unknown>) => {
  evaluate(source: string): unknown;
};

let hardened = false;

/** Once per realm, and only when a decoder is actually run. */
function harden(): void {
  if (hardened) return;
  lockdown({ errorTaming: "unsafe" });
  hardened = true;
}

/**
 * Compiled decoders, by source.
 *
 * A listing calls this once per row of a text region, so compiling each time
 * would evaluate the same source hundreds of times for one screen of output.
 */
const compiled = new Map<string, ((bytes: number[], params: unknown) => unknown) | null>();

function compile(source: string): ((bytes: number[], params: unknown) => unknown) | null {
  const already = compiled.get(source);
  if (already !== undefined) return already;

  harden();
  let fn: ((bytes: number[], params: unknown) => unknown) | null = null;
  try {
    fn = new Compartment().evaluate(`(function (bytes, params) {\n${source}\n})`) as typeof fn;
  } catch {
    // A decoder that will not compile renders nothing; the caller falls back to
    // the declared encoding, so a broken one makes a listing plainer rather
    // than breaking it.
    fn = null;
  }
  compiled.set(source, fn);
  return fn;
}

/**
 * Run a decoder over some bytes and take the lines it produced.
 *
 * Returns undefined for anything that is not a clean `{kind:"text"}` result,
 * which is the same refusal the worker makes — a listing is not the place to
 * report that somebody's decoder returned a bitmap.
 */
export function renderTextWith(
  source: string,
  bytes: readonly number[]
): string[] | undefined {
  const fn = compile(source);
  if (!fn) return undefined;

  try {
    // A copy, for the same reason the worker passes one: SES stops a decoder
    // reaching the outside world, not scribbling on what it was handed.
    const result = fn([...bytes], {}) as { kind?: string; lines?: unknown };
    if (result?.kind !== "text" || !Array.isArray(result.lines)) return undefined;
    return result.lines.every((l) => typeof l === "string")
      ? (result.lines as string[])
      : undefined;
  } catch {
    return undefined;
  }
}

/** Forget compiled decoders, so an edited one takes effect. */
export const forgetDecoders = (): void => void compiled.clear();
