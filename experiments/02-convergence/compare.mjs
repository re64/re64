/**
 * Do independent readers agree?
 *
 * The measurement experiment 2 exists for. It compares what each reader named
 * against the others, and — separately, and only here, never in a reader's own
 * context — against the human reference.
 *
 * Two numbers matter and they are not the same:
 *
 *   AGREEMENT is over addresses more than one reader named. Two readers who
 *   both call $8040 an explosion updater agree, whatever the third did. This
 *   is the real convergence question.
 *
 *   OVERLAP is how many addresses they picked in common at all. Low overlap
 *   with high agreement means they read different parts of the program and
 *   were consistent where they met, which is a good outcome and looks like a
 *   bad one if only one number is reported.
 *
 * Names are compared loosely — case and separators removed — because
 * `UpdateExplosionX` and `update_explosion_x` are the same answer, and scoring
 * them as a disagreement would measure spelling.
 *
 * It still under-reports, and deliberately, because the alternative is worse.
 * `shotTick` and `laserTick` at the same address are the *same finding* in
 * different words, and no string comparison can say so without a synonym list
 * that would end up encoding the answer. So the printed percentage is a floor:
 * read the disagreement list, which is where the real convergence shows — two
 * readers naming $000F a per-frame timer for the player's projectile have
 * agreed about the program, whatever they called it.
 *
 *   node experiments/02-convergence/compare.mjs [run-directory]
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const run = process.argv[2] ?? join(here, "run");

const { Workspace } = await import(join(repo, "dist/server/workspace.js"));
const { ProjectStore, SqliteStorage } = await import(join(repo, "dist/store/index.js"));
const { analyzeProgram } = await import(join(repo, "dist/core/analysis/program.js"));
const { loadProjectFile } = await import(join(repo, "dist/node-files.js"));

const db = join(run, "convergence.re64db");
if (!existsSync(db)) {
  console.error(`No database at ${db}. Run setup.sh first.`);
  process.exit(1);
}

const hex = (a) => "$" + a.toString(16).toUpperCase().padStart(4, "0");
/** Same answer, differently spelled, is the same answer. */
const loose = (name) => name.toLowerCase().replace(/[_\-\s]/g, "");

/** Every address a person (or agent) deliberately named, by address. */
function namedByHand(workspace) {
  const found = new Map();
  for (const label of workspace.labels({ source: "user" }, 5000).labels) {
    found.set(Number(label.address.replace("$", "0x")), label.name);
  }
  return found;
}

const readers = [];
for (const name of ["reader-1", "reader-2", "reader-3"]) {
  const storage = new SqliteStorage(db, name);
  const workspace = new Workspace({
    store: new ProjectStore(storage),
    storage,
    projectId: name,
    projectPath: db,
  });
  readers.push({ name, labels: namedByHand(workspace), workspace, storage });
}

console.log("What each reader recorded\n");
for (const reader of readers) {
  const described = reader.workspace.describe();
  console.log(
    `  ${reader.name.padEnd(9)} ${String(described.counts.namedByHand).padStart(4)} names   ` +
      `${String(described.counts.instructions).padStart(5)} instructions   ` +
      `${String(described.regions.length).padStart(3)} regions`
  );
}

// --- where they met ---------------------------------------------------
const everyAddress = new Set(readers.flatMap((r) => [...r.labels.keys()]));
const shared = [...everyAddress]
  .map((address) => ({ address, by: readers.filter((r) => r.labels.has(address)) }))
  .filter((entry) => entry.by.length > 1)
  .sort((a, b) => b.by.length - a.by.length || a.address - b.address);

const agreed = shared.filter((entry) => {
  const names = entry.by.map((r) => loose(r.labels.get(entry.address)));
  return names.every((n) => n === names[0]);
});

console.log(
  `\nAddresses named by more than one reader: ${shared.length} of ${everyAddress.size} distinct`
);
console.log(
  `  identical names: ${agreed.length}` +
    (shared.length ? ` (${Math.round((100 * agreed.length) / shared.length)}%)` : "")
);

console.log("\nWhere they disagree\n");
const disagreed = shared.filter((e) => !agreed.includes(e));
for (const entry of disagreed.slice(0, 40)) {
  console.log(`  ${hex(entry.address)}`);
  for (const reader of entry.by) {
    console.log(`    ${reader.name.padEnd(9)} ${reader.labels.get(entry.address)}`);
  }
}
if (disagreed.length > 40) console.log(`  … and ${disagreed.length - 40} more`);

// --- against the human, which only this script may look at ------------
const referencePath = join(repo, "assets/gridrunner.re64");
if (existsSync(referencePath)) {
  const reference = analyzeProgram(loadProjectFile(referencePath));
  const human = new Map();
  for (const label of reference.labels.filter({ source: "user" })) {
    human.set(label.address, label.name);
  }

  console.log(`\nAgainst the human reading (${human.size} names)\n`);
  for (const reader of readers) {
    const met = [...reader.labels.keys()].filter((a) => human.has(a));
    const same = met.filter((a) => loose(reader.labels.get(a)) === loose(human.get(a)));
    console.log(
      `  ${reader.name.padEnd(9)} named ${String(reader.labels.size).padStart(4)}   ` +
        `${String(met.length).padStart(4)} at addresses the human also named   ` +
        `${String(same.length).padStart(3)} with the same name`
    );
  }
  console.log(
    "\n  Coverage against the human measures method, not skill: the reference is a\n" +
      "  linear sweep and this is a reachability walk. Read the names, not the counts."
  );
}

for (const reader of readers) reader.storage.close();
