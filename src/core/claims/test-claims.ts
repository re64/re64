import { Claim, Interpretation } from "./model.js";

/**
 * A span somebody claimed, for tests.
 *
 * `createUserRegion` used to build the parallel record a layer held; a layer
 * holds claims now, so this is what took its place. It exists only because
 * writing a claim by hand at every site would bury what each test is about
 * under six fields of boilerplate — there is deliberately no factory for a
 * user's claim in the model itself, since a user claim is whatever the person
 * wrote.
 */
export function spanClaim(region: {
  id: string;
  start: number;
  end: number;
  kind: "data" | "text" | "bitmap" | "jumptable" | "code" | "unknown";
  name?: string;
  encoding?: string;
  view?: string;
}): Claim {
  const { id, start, end, kind, name, encoding, view } = region;
  // `code` and `unknown` are not things a claim says: the first is a place to
  // decode from, the second is the absence of any statement.
  const says =
    kind === "code" || kind === "unknown"
      ? undefined
      : ({
          is: kind,
          ...(kind === "text" && encoding ? { encoding } : {}),
          ...((kind === "text" || kind === "bitmap") && view ? { view } : {}),
        } as Interpretation);

  return {
    id,
    at: start,
    extent: end - start,
    ...(name === undefined ? {} : { name }),
    ...(says ? { says, root: "data" as const } : {}),
    ...(kind === "code" ? { root: "location" as const } : {}),
    by: { author: "test", source: "user" },
  };
}
