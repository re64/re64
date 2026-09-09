#!/usr/bin/env node
//
// Build the Camels **silver** image, through the API that agents use.
//
// Silver, not gold: this is everything three runs established, imported
// faithfully and reviewed by nobody. It becomes a gold standard when agents and
// a person have been over it — enriching what is thin and *correcting* what is
// wrong — and not before. What it is today is a baseline good enough to measure
// the next run as a delta against, which is the job it has to do first.
//
//   node assets/mutant-camels/build.mjs [--port 5164] [--out camels.re64]
//
// **Every write goes over MCP.** Not because it is convenient — it is not; a
// hand-written `.re64` would be a tenth of this — but because the artefact is
// meant to be two things at once: a curated project, and a worked example of
// how a project of that depth is made. A build that reached into the model
// directly would demonstrate nothing and would measure no friction.
//
// The script is therefore part of the output. It is the answer to "how was this
// made", it re-runs when the model changes, and it is where the reasoning for
// each decision lives — including the ones that were somebody's judgement
// rather than a reading of the bytes.
//
// Sources, and what each is worth:
//
//   experiment 7   400 labels, 114 regions, 18 constants, 210 comments, on the
//                  pre-claims model. Four fifths of everything anybody has ever
//                  established about this program.
//   experiment 9   the document is gone; 111 successful writes survive in its
//                  transcript, which replay. The only run that used evidence.
//   experiment 10  80 claims, 4 record types, 93 comments, 14 scenarios, made
//                  by two readers forbidden to read either of the above.
//   this repository  the 2021 patch, the keyboard matrix, the OATS reading, and
//                  the errata — findings verified in tests rather than in prose.
//
// Measured across the three: **431 distinct addresses are named, 73 of them by
// more than one run** — 49 shared by runs 7 and 10, 13 by runs 7 and 9, and 11
// by all three. Exactly one of the 73 agrees on the name outright. The other 72
// are the same finding worded differently: `TickObjectLifetime` and
// `AgeCreature` at `$9A39`, `zoneDataTable` and `zoneTable` at `$6700`,
// `NextRandom` and `RandomByteFromBASICROM` at `$8D1D`.
//
// (A first count said 25, and was wrong. Run 10's claims are **layer-framed** —
// `at: "$0000"` with a `layer`, meaning an offset into the runtime layer at
// `$0801` — and comparing those offsets against run 7's absolute addresses hid
// three quarters of the overlap. Worth stating rather than quietly fixing: the
// frame is the thing about this model most likely to be read wrong from
// outside it, and the number it produced was used to argue a plan.)
//
// **The 72 are imported as they stand, not merged.** Two names for one routine
// is a state this model tolerates by design — the name still reaches exactly
// one address — and choosing between them is a judgement nobody has made. That
// is the next run's job, and leaving them is what makes it legible.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : fallback;
};
const PORT = Number(flag("port", 5164));
const PROJECT = flag("project", "camels");
const OUT = flag("out", join(HERE, "camels.re64"));

/**
 * One MCP call, as an agent makes it.
 *
 * Deliberately the same shape `experiments/mcp-call.sh` sends, including the
 * user header — so what this script does is what a reader could have done, and
 * the transcript it leaves is comparable with an experiment's.
 */
async function call(tool, argsObject = {}, who = "curator") {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: tool, arguments: { project: PROJECT, ...argsObject } },
  };
  const reply = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-re64-user": who,
      "x-re64-session": "build",
    },
    body: JSON.stringify(body),
  });
  const text = await reply.text();
  const line = text
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => l.slice(6))
    .join("");
  const parsed = JSON.parse(line || text);
  if (parsed.error) throw new Error(`${tool}: ${parsed.error.message}`);
  const content = parsed.result?.content?.[0]?.text;
  // A refusal is prose, not JSON — and this parsed it anyway, so every real
  // message came back as "Unexpected token" and the friction this script exists
  // to measure was unreadable. Check the flag before trusting the body.
  if (parsed.result?.isError) throw new Error(content ?? "refused, with no message");
  try {
    return content ? JSON.parse(content) : parsed.result;
  } catch {
    return content;
  }
}

const hex = (n) => `$${n.toString(16).toUpperCase().padStart(4, "0")}`;
const addressOf = (a) =>
  typeof a === "number" ? a : a.startsWith("$") ? parseInt(a.slice(1), 16) : parseInt(a, 10);
const say = (...parts) => console.log(...parts);

/** Where the two builds live, and what they are. */
const DISK = "revenge-of-the-mutant-camels.d64";
const STANDALONE = "revenge-of-the-mutant-camels.prg";
/** The file inside the disk image; "fixed" is the cracker's word, not ours. */
const PACKED = `revenge.d64:revenge fixed`;

async function upload(name, bytes) {
  const prepared = await call("prepare_upload", { name });
  const put = await fetch(prepared.url, { method: "PUT", body: bytes });
  if (!put.ok) throw new Error(`upload ${name}: ${put.status}`);
  return prepared;
}

async function main() {
  say(`building ${PROJECT} on port ${PORT}`);

  // ---------------------------------------------------------------- the bytes
  //
  // Two builds, and the project holds both. The disk carries the **2021**
  // build — Jeff Minter's own collision fix, crunched — and the loose `.prg` is
  // the **1984** release. They differ by thirty-six bytes above $87D0 in eleven
  // runs, plus 287 bytes of new code at $C000, and `camels-patch.test.ts`
  // asserts that overlaying those bytes on the 1984 build reproduces the disk
  // build exactly.
  await upload("revenge.d64", readFileSync(join(HERE, DISK)));
  await upload("standalone.prg", readFileSync(join(HERE, STANDALONE)));
  say("  uploaded both builds");

  await call("add_byte_layer", { type: "prg", path: PACKED, name: "packed" });

  // Past the decruncher. Static analysis of the disk stops at 141 instructions;
  // 1,768,854 later the loader hands control on, and what it expanded is the
  // program everything below is about.
  const decrunch = await call("add_scenario", {
    name: "decrunch",
    description:
      "Run the loader until it hands control on, and keep what it expanded. " +
      "The only way to see this build at all: the disk holds a crunched file, " +
      "and reading it statically stops after a few dozen instructions.",
    steps: [
      { kind: "start", at: "$080D" },
      { kind: "run", leaves: true, maxInstructions: 20000000 },
      { kind: "capture", what: "ram", from: "$0801", to: "$C11F", name: "runtime.prg" },
    ],
  });
  const ran = await call("run_scenario", { id: decrunch.scenario });
  say(`  decrunched: ${ran.steps?.length ?? "?"} steps, ${ran.ok === false ? "FAILED" : "ok"}`);

  await call("add_byte_layer", { type: "prg", path: "runtime.prg", name: "runtime" });
  await call("add_byte_layer", { type: "prg", path: "standalone.prg", name: "original" });

  // The 2021 patch, as eleven named layers over the 1984 build. Each is three
  // bytes or fewer except the launch, and each says what it does — which is the
  // documentation value of expressing a patch as an overlay rather than as
  // prose about two fixtures.
  for (const site of PATCH) {
    await call("add_byte_layer", {
      type: "bytes",
      address: hex(site.at),
      bytes: site.now,
      name: `patch ${hex(site.at)}: ${site.what}`,
    });
  }

  // ROMs. The bytes are not in this repository and never will be, so the
  // project carries the *request*: a project that asks for a ROM it cannot get
  // still opens, and describe_project says which are missing.
  for (const rom of ["basic", "kernal", "characters"]) {
    await call("add_rom_layer", { rom });
  }
  const withRoms = Object.fromEntries(
    (await call("list_targets", {})).layers.map((l) => [l.name, l.id])
  );

  // ------------------------------------------------------------- the targets
  //
  // **A target list is a history**, and this program has five phases worth
  // looking at. `machine` is the one that has to ship: both previous editors
  // had to invent it, and one of them concluded the host had no ROMs while
  // sitting on all three.
  const patchLinks = PATCH.map((s) => ({ layer: withRoms[`patch ${hex(s.at)}: ${s.what}`] }));

  await call("add_target", {
    name: "loader",
    order: 1,
    description: "The file as the disk loads it, still crunched.",
    entryPoints: ["$080D"],
    layers: [{ layer: withRoms.packed }],
  });
  await call("add_target", {
    name: "runtime",
    order: 2,
    description:
      "The image the loader expands into: the 2021 build as it runs. " +
      "This is what every experiment read, and the default view.",
    entryPoints: ["$C065", "$8A3C"],
    layers: [{ layer: withRoms.runtime }],
  });
  await call("add_target", {
    name: "machine",
    order: 3,
    description:
      "The runtime image plus the ROMs, as a 6510 sees memory at power-on. " +
      "Scenarios run here, because a view with no ROMs vectors into zeros.",
    entryPoints: ["$C065"],
    layers: [
      { layer: withRoms["basic rom"] },
      { layer: withRoms["characters rom"] },
      { layer: withRoms["kernal rom"] },
      { layer: withRoms.runtime },
    ],
  });
  await call("add_target", {
    name: "standalone",
    order: 4,
    description:
      "The 1984 release, which stops at $A002 and has the collision gate the " +
      "2021 build bypasses. Byte-identical to the binary the mwenge listing " +
      "ships beside — though not to that listing, which documents the patch.",
    entryPoints: ["$87F0"],
    layers: [{ layer: withRoms.original }],
  });
  await call("add_target", {
    name: "patched",
    order: 5,
    description:
      "The 1984 build with the May 2021 collision fix laid over it as eleven " +
      "named layers. Reproduces `runtime` over the whole of the code, which is " +
      "what makes the patch a fact rather than a story.",
    entryPoints: ["$C065"],
    layers: [{ layer: withRoms.original }, ...patchLinks],
  });
  say("  five targets: loader, runtime, machine, standalone, patched");

  // ------------------------------------------------------------- the import
  //
  // **Replayed under the original authors, not attributed to this script.**
  // Run 7's document is the pre-claims format and carries no provenance at all
  // — the loader synthesises `author: "project"` for such a file — but its
  // *operations log* has one row per write with the reader who made it, and all
  // 742 objects are traceable: 400 labels, 114 regions, 210 comments and 18
  // constants, made by reader-1, reader-2 and reader-3.
  //
  // So each write here is sent with that reader's own user header, and
  // `add_claim` mints the supporting record naming them. Nothing is
  // manufactured and nothing is laundered into one curator's name — which is
  // the whole point of the shape: when the next run adds its own account of one
  // of these, the claim carries both, and the difference between them is the
  // measurement.
  //
  // `method` is left unstated, honestly: run 7 predates the axis, and absent
  // means nobody said, which is true of every one of these.
  const seven = JSON.parse(readFileSync(join(HERE, "sources", "run07.re64"), "utf-8"));
  const authors = JSON.parse(readFileSync(join(HERE, "sources", "run07-authors.json"), "utf-8"));
  // **Namespaced by run.** All three runs called their agents `one`, `two` and
  // `ed`, or `reader-1..3`, and two different agents sharing a name would read
  // as one agent corroborating itself — which is exactly the correlated-account
  // error `method` exists to catch. An author is who vouched, so it has to
  // identify them across the whole document.
  const who = (id) => (authors[id] ? `exp7-${authors[id]}` : "exp7");

  let imported = 0;
  const failed = [];
  const attempt = async (tool, argsObject, by) => {
    try {
      await call(tool, argsObject, by);
      imported += 1;
    } catch (error) {
      failed.push(`${tool} ${JSON.stringify(argsObject).slice(0, 90)}: ${error.message}`);
    }
  };

  // Constants first: a binding needs the name it means to exist already.
  const constantIds = {};
  for (const c of seven.constants ?? []) {
    try {
      const made = await call("add_constant", { name: c.name, value: c.value }, who(c.id));
      constantIds[c.id] = made.constant;
      imported += 1;
    } catch (error) {
      failed.push(`add_constant ${c.name}: ${error.message}`);
    }
  }

  // A region is a claim with an extent, and the legacy kinds map straight over
  // except `code`, which was never about the bytes: it seeded the decode, so it
  // becomes a root and says nothing about what the span is.
  const IS_FOR = { data: "data", text: "text", jumptable: "jumptable", bitmap: "bitmap" };
  for (const layer of seven.layers ?? []) {
    for (const r of layer.regions ?? []) {
      const extent = addressOf(r.end) - addressOf(r.start);
      const is = IS_FOR[r.kind];
      await attempt(
        "add_claim",
        {
          target: "runtime",
          at: r.start,
          ...(extent > 0 ? { extent } : {}),
          ...(r.name ? { name: r.name } : {}),
          ...(is ? { is, root: "data" } : r.kind === "code" ? { root: "routine" } : {}),
          // How to read or draw the bytes, which the legacy model made optional
          // and the claims model requires for a bitmap. Run 7 recorded it on
          // every one — `sprite` for the six banks, `char:8` for the character
          // set — so this is carried across rather than guessed.
          ...(r.view ? { view: r.view } : {}),
          ...(r.encoding ? { encoding: r.encoding } : {}),
          ...(r.comment ? { comment: r.comment } : {}),
        },
        who(r.id)
      );
    }
    for (const l of layer.labels ?? []) {
      await attempt("add_claim", { target: "runtime", at: l.address, name: l.name }, who(l.id));
    }
    for (const c of layer.comments ?? []) {
      // `address`, not `at` — and `add_claim` next door takes `at`. That
      // inconsistency cost experiment 10's editor three round trips in a row
      // and cost this script 238 refusals on its first run, which is a fair
      // measure of how much a reader pays for it.
      await attempt(
        "add_comment",
        {
          target: "runtime",
          address: c.address,
          text: c.text,
          ...(c.placement ? { placement: c.placement } : {}),
        },
        who(c.id)
      );
    }
    for (const u of layer.constantUses ?? []) {
      const constant = constantIds[u.constant];
      if (!constant) continue;
      await attempt(
        "bind_constants",
        { target: "runtime", bindings: [{ address: u.address, constant }] },
        who(u.id)
      );
    }
  }
  say(`  experiment 7: ${imported} objects, under the three readers who made them`);

  // ------------------------------------- what runs 9 and 10 add, and correct
  //
  // 93 addresses run 7 never named, and 21 it named differently. Those 21 are
  // imported as **second claims at the same address**, not merged: two names
  // for one routine is a state this model tolerates by design — the name still
  // reaches exactly one address — and choosing between `TickObjectLifetime` and
  // `AgeCreature` is a judgement nobody has made yet. Leaving them is what makes
  // the next run's job legible.
  const ten = JSON.parse(readFileSync(join(HERE, "sources", "run10.re64"), "utf-8"));
  const tenAuthors = JSON.parse(readFileSync(join(HERE, "sources", "run10-authors.json"), "utf-8"));
  const whoTen = (id) => (tenAuthors[id] ? `exp10-${tenAuthors[id]}` : "exp10");

  // Types first: a record claim needs the layout it is an array of, and the ids
  // are minted fresh here so the old ones have to be mapped.
  const typeFor = {};
  for (const t of ten.types ?? []) {
    try {
      const made = await call(
        "add_type",
        {
          name: t.name,
          size: typeof t.size === "string" ? addressOf(t.size) : t.size,
          fields: Object.fromEntries(
            Object.entries(t.fields).map(([offset, f]) => [
              offset,
              { name: f.name, type: f.type, ...(f.description ? { description: f.description } : {}) },
            ])
          ),
        },
        whoTen(t.id)
      );
      typeFor[t.id] = made.type;
      imported += 1;
    } catch (error) {
      failed.push(`add_type ${t.name}: ${error.message}`);
    }
  }

  for (const c of ten.claims ?? []) {
    await attempt(
      "add_claim",
      {
        target: "runtime",
        at: c.at,
        ...(c.extent !== undefined ? { extent: c.extent } : {}),
        ...(c.name ? { name: c.name } : {}),
        ...(c.is ? { is: c.is } : {}),
        ...(c.typeId && typeFor[c.typeId] ? { typeId: typeFor[c.typeId] } : {}),
        ...(c.encoding ? { encoding: c.encoding } : {}),
        ...(c.view ? { view: c.view } : {}),
        ...(c.root ? { root: c.root } : {}),
        ...(c.method ? { method: c.method } : {}),
      },
      whoTen(c.id)
    );
  }
  for (const layer of ten.layers ?? []) {
    for (const c of layer.comments ?? []) {
      await attempt(
        "add_comment",
        { target: "runtime", address: c.address, text: c.text, ...(c.placement ? { placement: c.placement } : {}) },
        whoTen(c.id)
      );
    }
  }

  // Run 9's document is gone; 111 successful writes survive in its transcript
  // and replay. Its scenarios do not — they are a create followed by 33 edits
  // by id, and the ids are the old document's — so what comes across is the
  // durable analysis: the claims, the comments and the record layouts.
  const nine = JSON.parse(readFileSync(join(HERE, "sources", "run09-writes.json"), "utf-8"));
  const nineTypes = [];
  for (const w of nine) {
    const a = w.args;
    if (w.tool !== "add_type") continue;
    try {
      const made = await call("add_type", { name: a.name, size: a.size, fields: a.fields }, `exp9-${w.by}`);
      nineTypes.push({ name: a.name, size: a.size, id: made.type });
      imported += 1;
    } catch (error) {
      failed.push(`add_type ${a.name}: ${error.message}`);
    }
  }

  /**
   * Which of run 9's types a claim meant, worked out rather than looked up.
   *
   * Its document is gone and its transcript records only what was *sent*, so the
   * ids `add_type` returned — and which its record claims then named — are not
   * anywhere. They are still recoverable, because a record claim's extent is a
   * whole number of records: `zoneTable` is 8,400 bytes and `ZoneRecord` is 200,
   * which is 42 of them, and the music claims are 404, 218, 218 and 800 against
   * a `MusicEvent` of 2. Each old id is matched to the one declared type whose
   * size divides every extent claiming it, and an ambiguous one is refused
   * rather than guessed.
   */
  const typeForNine = {};
  {
    const extents = {};
    for (const w of nine) {
      const a = w.args;
      for (const c of w.tool === "add_claim" ? [a] : (a.claims ?? [])) {
        if (c.is === "record" && c.typeId) (extents[c.typeId] ??= []).push(c.extent ?? 0);
      }
    }
    // Solved by elimination rather than per id, because divisibility alone is
    // not decisive: 8,400 is a whole number of 200-byte records *and* of 2-byte
    // ones. The music claims settle it — 404 bytes is not a multiple of 200, so
    // that id can only be `MusicEvent` — and the zone table takes the layout
    // left over. Anything still ambiguous when no more can be pinned is refused,
    // which is the same rule as everywhere else here: a guess is worse than a gap.
    const pool = [...nineTypes];
    let pending = Object.entries(extents);
    for (let settled = true; settled && pending.length > 0; ) {
      settled = false;
      const still = [];
      for (const [old, sizes] of pending) {
        const fits = pool.filter((t) => sizes.every((e) => e > 0 && e % t.size === 0));
        if (fits.length === 1) {
          typeForNine[old] = fits[0].id;
          pool.splice(pool.indexOf(fits[0]), 1);
          settled = true;
        } else {
          still.push([old, sizes]);
        }
      }
      pending = still;
    }
    for (const [old, sizes] of pending) {
      failed.push(
        `type ${old}: extents ${sizes.join(", ")} fit more than one of run 9's layouts ` +
          `and nothing else pins it, so which one is a guess`
      );
    }
  }
  for (const w of nine) {
    const a = w.args;
    const by = `exp9-${w.by}`;
    const one = async (c) =>
      attempt(
        "add_claim",
        {
          target: "runtime",
          at: c.at,
          ...(c.extent !== undefined ? { extent: c.extent } : {}),
          ...(c.name ? { name: c.name } : {}),
          ...(c.is ? { is: c.is } : {}),
          ...(c.typeId && typeForNine[c.typeId] ? { typeId: typeForNine[c.typeId] } : {}),
          ...(c.encoding ? { encoding: c.encoding } : {}),
          ...(c.view ? { view: c.view } : {}),
          ...(c.root ? { root: c.root } : {}),
          ...(c.method ? { method: c.method } : {}),
          ...(c.comment ? { comment: c.comment } : {}),
        },
        by
      );
    if (w.tool === "add_claim") await one(a);
    if (w.tool === "add_claims") for (const c of a.claims ?? []) await one(c);
    if (w.tool === "add_comment" && a.address)
      await attempt("add_comment", { target: "runtime", address: a.address, text: a.text }, by);
  }
  say(`  imported ${imported} objects in total, from three runs under nine authors`);
  if (failed.length) {
    say(`  ${failed.length} refused:`);
    for (const f of failed.slice(0, 8)) say(`    ${f}`);
    if (failed.length > 8) say(`    ... ${failed.length - 8} more`);
  }

  // ------------------------------------------------------- the build checks
  //
  // **A build that does not check itself is a build that quietly stops being
  // true.** These two are the ones worth the seconds they cost: they are the
  // claims the targets make, and both have been got wrong before.

  // The patch reproduces the shipped build. Not "these fixtures differ in
  // thirty-six places" — anybody can count that — but that the *named* eleven,
  // and nothing else, are the whole of the difference over the code.
  const CODE = { from: "$87D0", length: 0xa003 - 0x87d0 };
  const [asPatched, asShipped, asOriginal] = await Promise.all([
    call("read_bytes", { target: "patched", start: CODE.from, length: CODE.length }),
    call("read_bytes", { target: "runtime", start: CODE.from, length: CODE.length }),
    call("read_bytes", { target: "standalone", start: CODE.from, length: CODE.length }),
  ]);
  if (asPatched.hex !== asShipped.hex) {
    throw new Error("the patch overlay no longer reproduces the disk build over $87D0-$A002");
  }
  if (asOriginal.hex === asShipped.hex) {
    throw new Error("the two builds are identical over the code, which they are not");
  }
  const differing = asOriginal.hex
    .split(" ")
    .filter((b, i) => b !== asShipped.hex.split(" ")[i]).length;
  say(`  patch: ${differing} bytes over the code, and the overlay reproduces all of them`);

  // The machine target boots. Both previous editors had to invent this view,
  // and one concluded the host had no ROMs while sitting on all three — so the
  // check is not that the layers exist, it is that a 6510 gets somewhere.
  const boots = await call("add_scenario", {
    target: "machine",
    name: "boots",
    description:
      "Run the game from its entry point on a machine with ROMs. Proves the " +
      "machine target is a machine: with no ROM linked, $FFFE reads as zero " +
      "and the first interrupt after CLI takes the program to $0000.",
    steps: [
      { kind: "start", at: "$C065" },
      { kind: "run", frames: 40 },
    ],
  });
  const booted = await call("run_scenario", { target: "machine", id: boots.scenario });
  if (booted.stopped?.reason !== "frames") {
    throw new Error(`machine target did not boot: ${booted.stopped?.reason} at ${booted.stopped?.at}`);
  }
  say(
    `  machine: boots — ${booted.stopped.instructions.toLocaleString()} instructions ` +
      `over ${booted.stopped.frames} frames, resting at ${booted.stopped.at}`
  );

  const described = await call("describe_project", { target: "runtime" });
  say(
    `  runtime: ${described.counts?.instructions ?? "?"} instructions, ` +
      `${described.layers?.length ?? "?"} layers`
  );

  const exported = await call("export_project", {});
  writeFileSync(OUT, exported.text);
  say(`\nwrote ${OUT} (${exported.text.length} bytes)`);
}

/**
 * The 2021 patch, site by site — every reading taken from the bytes.
 *
 * Kept here as well as in `camels-patch.test.ts` because the test proves it and
 * this ships it: the layers a reader opens are built from this table, and the
 * test asserts the same table against both binaries on every commit.
 */
const PATCH = [
  {
    at: 0x87f0,
    now: "EAEAEAEAEAEAEAEAEAEAEAEAEAEA",
    what: "the 1984 SYS 34800 launch, NOP'd — the disk build enters elsewhere",
  },
  { at: 0x8a8f, now: "2019C0", what: "STA $1F99 becomes JSR $C019" },
  { at: 0x8be6, now: "F8", what: "the raster compare, low byte" },
  { at: 0x8bed, now: "297F", what: "ORA #$80 becomes AND #$7F: raster bit 8, cleared" },
  { at: 0x9499, now: "4C00C0", what: "JMP $94AF becomes JMP $C000" },
  { at: 0x9772, now: "2061C0", what: "JSR $9DBB becomes JSR $C061" },
  { at: 0x9ab3, now: "A9FF", what: "the bullet's collision gate: LDA $44 becomes LDA #$FF" },
  { at: 0x9abc, now: "A9FF", what: "the same gate, second half" },
  { at: 0x9d99, now: "2023C0", what: "JSR $9E0A becomes JSR $C023" },
  { at: 0x9fe6, now: "4C82C0", what: "JMP $8A3C becomes JMP $C082" },
  { at: 0x9fff, now: "16CD0000", what: "the last four bytes; purpose not established" },
];

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
