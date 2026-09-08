#!/usr/bin/env node
//
// Build the Camels gold standard, through the API that agents use.
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
// Measured before any of it was merged: **490 distinct addresses are named
// across the three runs, and only 25 are named by more than one.** Of those 25,
// four agree on the name outright and 21 are the same finding worded
// differently — `TickObjectLifetime` and `AgeCreature` at `$9A39`, `zoneDataTable`
// and `zoneTable` at `$6700`. That is what the provenance restructure was for:
// one claim, several supporting records, each keeping its author and method,
// instead of two claims nobody can merge.

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
  const value = content ? JSON.parse(content) : parsed.result;
  if (parsed.result?.isError) throw new Error(`${tool}: ${content}`);
  return value;
}

const hex = (n) => `$${n.toString(16).toUpperCase().padStart(4, "0")}`;
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
