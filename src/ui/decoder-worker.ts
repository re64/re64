/**
 * Where a decoder runs in the browser.
 *
 * The mirror of the worker in `src/sandbox/run.ts`, and it has to stay one:
 * the same source must mean the same thing whoever runs it, or a decoder that
 * works for a person fails for an agent looking at the same project. The two
 * are separate files only because one is a Node worker thread built from an
 * inline string and this is a bundled browser worker; the steps below are
 * deliberately identical and should be changed together.
 *
 * This runs client-side because a decoder is **analysis**, and analysis belongs
 * where the person is: the browser already disassembles locally so that a
 * rename does not round-trip, and sliding a width in the explorer has exactly
 * the same feel. The server keeps its own copy for agents, who have no browser.
 *
 * Bundled as its own entry, so the 84KB of SES is fetched the first time
 * somebody actually runs a decoder rather than by everyone at first paint.
 */

import "ses";

declare const lockdown: (options?: Record<string, unknown>) => void;
declare const Compartment: new (endowments?: Record<string, unknown>) => {
  evaluate(source: string): unknown;
};

// Hardens the intrinsics of *this worker's* realm only. Doing it on the page
// would freeze the realm CodeMirror, Shoelace and Yjs live in.
lockdown({ errorTaming: "unsafe" });

interface Request {
  source: string;
  bytes: number[];
  params: Record<string, unknown>;
}

self.onmessage = (event: MessageEvent<Request>) => {
  const { source, bytes, params } = event.data;
  try {
    const compartment = new Compartment();

    // Wrapped rather than imported: a compartment evaluates an expression, and
    // this hands the decoder its arguments by name without endowing the
    // compartment with anything that outlives the call.
    const decode = compartment.evaluate(`(function (bytes, params) {\n${source}\n})`) as (
      bytes: number[],
      params: Record<string, unknown>
    ) => unknown;

    // A copy. SES stops a decoder reaching the outside world; it does not stop
    // one scribbling on what it was handed, and those are the loaded program.
    const value = decode(bytes.slice(), params);

    // Plain data across the boundary. Anything that will not survive being
    // stringified was never a valid result.
    self.postMessage({ ok: true, value: JSON.parse(JSON.stringify(value ?? null)) });
  } catch (error) {
    self.postMessage({ ok: false, why: String(error) });
  }
};
