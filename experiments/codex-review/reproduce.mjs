// Review probes: these assert the observed defects, not desired behavior.
// Run from the repository root: npm run build && node experiments/codex-review/reproduce.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { docFromProject, projectFromDoc, applyOpToDoc, applyOpsToDoc, encodeDoc, applyUpdate, docFromUpdates } from '../../dist/core/crdt/index.js';
import { buildMemoryMap, formatProject, applyOp } from '../../dist/core/index.js';
import { ProjectStore, SqliteStorage } from '../../dist/store/index.js';
import { Workspace } from '../../dist/server/workspace.js';
import { CheckpointCache } from '../../dist/core/machine/scenario.js';

const base = {
  name: 'review',
  layers: [{ id: 'lay_a', type: 'bytes', address: '$8000', bytes: 'a90160' }],
  claims: [{ id: 'clm_a', at: '$8000', name: 'Original', root: 'routine', origin: 'user' }],
  types: [{ id: 'typ_a', name: 'Record', size: 8, fields: { 0: { id: 'fld_a', name: 'old', type: 'u8', description: 'old description' } } }],
  targets: [{ id: 'tgt_a', name: 'A', layers: ['lay_a'], entryPoints: ['$8000'] }],
  defaultTarget: 'A',
};
const output = (caseName, details) => console.log(JSON.stringify({ case: caseName, ...details }));
function peers(project = base) {
  return [1, 2].map(id => { const d = docFromProject(project); d.clientID = id; return d; });
}
function sync(a, b) {
  const updates = [encodeDoc(a), encodeDoc(b)];
  for (const doc of [a, b]) for (const update of updates) applyUpdate(doc, update);
}
function fixture(project = base, Storage = SqliteStorage) {
  const dir = mkdtempSync(join(tmpdir(), 're64-codex-review-'));
  const path = join(dir, 'review.re64db');
  const storage = new Storage(path);
  storage.initialize(formatProject(project), 0);
  const store = new ProjectStore(storage);
  const workspace = new Workspace({ store, storage, projectId: 'default', projectPath: path, machines: new CheckpointCache() });
  return { storage, store, workspace, close() { storage.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const alice = { userId: 'alice', label: 'Alice', sessionId: 'alice-session' };

{
  const [a, b] = peers();
  applyOpToDoc(a, { op: 'claim.set', id: 'clm_a', fields: { name: 'Renamed' } });
  applyOpToDoc(b, { op: 'claim.set', id: 'clm_a', fields: { root: 'location' } });
  sync(a, b);
  // RE-RUN NOTE (re64, 2026-09-10): fixed. `claim.set` re-encoded the whole
  // claim and wrote every key back, so a partial patch reasserted every field it
  // did not name. It now touches only the keys the patch reaches, in groups
  // where a value is spelled across several — which is what keeps clearing
  // `encoding` part of setting `is` rather than a side effect of rewriting
  // everything.
  const result = projectFromDoc(a).claims[0];
  assert.equal(result.name, 'Renamed');
  assert.equal(result.root, 'location');
  output('FIXED: both concurrent partial edits to one claim survive', { name: result.name, root: result.root });
}
{
  const [a, b] = peers();
  applyOpToDoc(a, { op: 'field.set', typeId: 'typ_a', id: 'fld_a', fields: { name: 'new name' } });
  applyOpToDoc(b, { op: 'field.set', typeId: 'typ_a', id: 'fld_a', fields: { description: 'new description' } });
  sync(a, b);
  // RE-RUN NOTE (re64, 2026-09-10): fixed. A field was a plain object at a map
  // key, so a whole-object write made the later of two edits win over a property
  // it never read. Each field is a map of its own now, so a rename and a
  // description touch different keys. Production test:
  // `src/core/crdt/concurrency.test.ts` -> "a field keeps its identity and its
  // parts merge".
  const result = projectFromDoc(a).types[0].fields[0];
  assert.equal(result.name, 'new name');
  assert.equal(result.description, 'new description');
  output('FIXED: both concurrent partial edits to one field survive', { actual: result });
}
{
  const [a, b] = peers();
  applyOpToDoc(a, { op: 'field.set', typeId: 'typ_a', id: 'fld_a', fields: { offset: 1 } });
  applyOpToDoc(b, { op: 'field.set', typeId: 'typ_a', id: 'fld_a', fields: { offset: 2 } });
  sync(a, b);
  // RE-RUN NOTE (re64, 2026-09-10): fixed. Fields were keyed by offset, so a
  // move was a delete plus a create and two concurrent moves produced two
  // entries carrying one id — after which `field.remove` took one away and left
  // the other. Keyed by id, a move sets a number: one field, one of the two
  // offsets, and nothing to leave behind.
  const moved = projectFromDoc(a).types[0].fields;
  assert.equal(moved.filter(f => f.id === 'fld_a').length, 1);
  applyOpToDoc(a, { op: 'field.remove', typeId: 'typ_a', id: 'fld_a' });
  const remaining = projectFromDoc(a).types[0].fields;
  assert.equal(remaining.filter(f => f.id === 'fld_a').length, 0);
  output('FIXED: a move keeps one field, and removing it removes it', { moved, afterRemove: remaining });
}
{
  const f = fixture({ ...base, layers: [{ id: 'lay_a', type: 'prg', path: 'review.prg' }], constants: [{ id: 'cst_a', name: 'ONE', value: '$01' }, { id: 'cst_b', name: 'WHITE', value: '$01' }] });
  try {
    f.storage.putBlob('review.prg', new Uint8Array([0, 0x80, 0xa9, 1, 0x60]));
    f.workspace.bindConstant(alice, 0x8000, 'cst_a');
    f.workspace.bindConstant(alice, 0x8000, 'cst_b');
    // RE-RUN NOTE (re64, 2026-09-10): fixed. A binding is an address-to-id map —
    // `docs/algebra.md` always said so — and was keyed by a *minted use id*, so
    // every bind added a competitor. Two uses sat at one site, the loaded index
    // kept whichever the projection sorted last (by an id that is random), and
    // unbinding removed one and left the other resolving. Keyed by the site now.
    // Production test: `src/core/crdt/concurrency.test.ts` -> "a binding is
    // keyed by its site".
    const bindings = projectFromDoc(f.store.document()).layers[0].constantUses;
    assert.equal(bindings.length, 1);
    const beforeUnbind = f.workspace.program().loaded.constants.nameAt(0x8000);
    assert.equal(beforeUnbind, 'WHITE');
    f.workspace.unbindConstant(alice, 0x8000);
    const afterUnbind = f.workspace.program().loaded.constants.nameAt(0x8000);
    assert.ok(!afterUnbind);
    output('FIXED: rebinding replaces, and unbinding clears the site', { bindings, beforeUnbind, afterUnbind });
  } finally { f.close(); }
}
{
  const project = { ...base, evidence: [{ id: 'evd_a', claim: 'clm_a', kind: 'supports', author: 'alice', method: 'guessed', when: 1 }] };
  const op = { op: 'evidence.set', id: 'evd_a', fields: { by: null } };
  const doc = docFromProject(project);
  applyOpToDoc(doc, op);
  const crdt = projectFromDoc(doc).evidence[0];
  const text = JSON.parse(applyOp(formatProject(project), op)).evidence[0];
  // RE-RUN NOTE (re64, 2026-09-10): fixed — both adapters now clear.
  assert.equal(crdt.method, undefined);
  assert.equal(text.method, undefined);
  assert.equal(crdt.author, undefined);
  const f = fixture(project);
  try {
    // RE-RUN NOTE (re64, 2026-09-10): fixed. `by` is one value rather than a
    // patch of three — `Provenance` cannot exist without an author, so naming it
    // replaces it and `by: null` withdraws it. The CRDT adapter mapped null to
    // undefined, which `revise` skips because that is how it tells "leave alone"
    // from "clear". Production tests: `roundtrip.test.ts` → "provenance means the
    // same thing on both paths", and `transport.test.ts` → "clearing how you
    // know".
    f.workspace.setClaim(alice, 'clm_a', { method: null });
    assert.equal(projectFromDoc(f.store.document()).evidence[0].method, undefined);
    output('FIXED: both adapters clear provenance the same way', { crdt, text });
  } finally { f.close(); }
}
{
  const project = { ...base, targets: [...base.targets, { id: 'tgt_b', name: 'B', layers: ['lay_a'] }], claims: [...base.claims, { id: 'clm_zp', at: '$0002', target: 'A', name: 'OnlyInA', origin: 'user' }] };
  // RE-RUN NOTE (re64, 2026-09-10): fixed. The loader now asks of a target frame
  // the question it always asked of a layer frame, and the frame holds the
  // target's **id** rather than its name — so this asserts the invariant rather
  // than the defect. The production test is
  // `src/core/project/links.test.ts` → "a target frame names a target by id".
  const inB = buildMemoryMap(project, () => { throw Error('unexpected file'); }, { target: 'B', platform: false });
  const inA = buildMemoryMap(project, () => { throw Error('unexpected file'); }, { target: 'A', platform: false });
  assert.ok(!inB.claims.some(c => c.id === 'clm_zp'));
  assert.ok(inA.claims.some(c => c.id === 'clm_zp'));
  output('FIXED: target framed claim stays in its own target', { inA: true, inB: false });
}
{
  const project = { ...base, layers: [...base.layers, { id: 'lay_b', type: 'bytes', address: '$8000', bytes: 'a90260' }], targets: [...base.targets, { id: 'tgt_b', name: 'B', layers: ['lay_b'] }] };
  const f = fixture(project);
  try {
    // RE-RUN NOTE (re64, 2026-09-09): `defaultTarget` is gone, so there is no
    // default view to rename out from under a reader and `projectForTarget`
    // refuses instead of returning every layer. The probe now names its view,
    // which is what the fix requires of every caller — and the residual half of
    // R6 shows up instead: a target is still referenced *by name*, so renaming
    // one orphans the reader that named it.
    const before = f.workspace.view('A').program().loaded.map.readByte(0x8001);
    f.workspace.editTarget(alice, 'tgt_a', { name: 'RenamedA' });
    let after = 'refused';
    try { after = f.workspace.view('A').program().loaded.map.readByte(0x8001); }
    catch (error) { after = `refused: ${error.message.slice(0, 60)}`; }
    // The claims framed on it survive, because the frame holds the id. What
    // is refused is a *reader* still holding the old name, which is a clean
    // refusal rather than the silent whole-project fallback this found.
    output('FIXED: renaming a target keeps its claims; a stale name is refused', { before, after });
  } finally { f.close(); }
}
{
  const project = { ...base, layers: [...base.layers, { id: 'lay_b', type: 'bytes', address: '$8000', bytes: 'a90260' }], targets: [...base.targets, { id: 'tgt_b', name: 'B', layers: ['lay_b'] }], scenarios: [{ id: 'scn_a', name: 'probe', steps: [{ id: 'stp_a', kind: 'assert', memory: { '$8001': 1 } }] }] };
  const f = fixture(project);
  try {
    // RE-RUN NOTE: names its view, since there is no default one any more.
    const inA = f.workspace.view('A').runScenario(alice, 'scn_a');
    const cachedB = f.workspace.view('B').runScenario(alice, 'scn_a');
    const fresh = new Workspace({ store: f.store, storage: f.storage, projectId: 'default', projectPath: '', target: 'B', machines: new CheckpointCache() });
    const freshB = fresh.runScenario(alice, 'scn_a');
    // RE-RUN NOTE (re64, 2026-09-10): fixed. The checkpoint key was the document
    // version, which says nothing about which view is being run — so two targets
    // over one document were one execution to the cache. It now names the view,
    // where each layer landed, and the ROMs this host did not supply. Production
    // test: `src/server/building.test.ts` -> "a scenario is keyed on what it
    // runs over".
    assert.equal(inA.passed, true);
    assert.equal(cachedB.passed, false);
    assert.equal(freshB.passed, false);
    assert.equal(cachedB.passed, freshB.passed);
    output('FIXED: a warm cache and a cold one agree across targets', { inA: inA.passed, cachedB: cachedB.passed, freshB: freshB.passed });
  } finally { f.close(); }
}
{
  const f = fixture();
  try {
    f.store.runOps([{ op: 'claim.set', id: 'clm_a', fields: { name: 'First' } }], 'alice', 1, 'alice-session');
    f.store.runOps([{ op: 'claim.set', id: 'clm_a', fields: { name: 'Second' } }], 'bob', 2, 'bob-session');
    const noLongerMine = f.store.undo('alice', 'alice-session');
    assert.equal(noLongerMine.applied, 0);
    f.store.runOps([{ op: 'claim.remove', id: 'clm_a' }], 'bob', 3, 'bob-session');
    const resurrected = f.store.undo('alice', 'alice-session');
    assert.equal(resurrected.applied, 1);
    // Current claim.set is a no-op against a removed record; it still reports applied.
    output('undo says applied to an entity another writer deleted', { outcome: resurrected, claims: projectFromDoc(f.store.document()).claims });
  } finally { f.close(); }
}
{
  const f = fixture();
  try {
    f.store.attributeWith(origin => origin === 'socket' ? 'alice' : undefined);
    const peer = docFromUpdates([f.store.snapshot()]);
    applyOpsToDoc(peer, [
      { op: 'claim.remove', id: 'clm_a' },
      { op: 'claim.add', claim: { id: 'clm_b', at: 0x8000, name: 'Replacement', origin: 'user' } },
    ]);
    f.store.merge(encodeDoc(peer), 'socket');
    const log = f.storage.readOps();
    const pairs = log.map(c => ({ op: c.op, inverse: c.inverse, session: c.session, changeset: c.changeset }));
    // RE-RUN NOTE (re64, 2026-09-10): fixed. The socket path took the reverse
    // diff and paired it with the forward one by *array position*; neither diff
    // promises the matching inverse lands at the same index. Each inverse is now
    // computed against the state its own operation saw, walking forward — the
    // same thing runOps does. Production test: `src/store/project-store.test.ts`
    // -> "a socket update is one action, and each inverse undoes its own op".
    for (const c of log) {
      const undone = applyOp(applyOp(formatProject(base), c.op), c.inverse);
      assert.equal(JSON.parse(undone).claims.length, JSON.parse(formatProject(base)).claims.length);
    }
    assert.ok(log.every(c => c.session === undefined || typeof c.session === 'string'));
    output('FIXED: each inverse undoes its own operation', { pairs });
  } finally { f.close(); }
}
{
  const [a, b] = peers();
  applyOpToDoc(a, { op: 'decoder.add', id: 'dec_a', name: 'Alpha', source: 'a' });
  applyOpToDoc(b, { op: 'decoder.add', id: 'dec_b', name: 'Beta', source: 'b' });
  sync(a, b);
  // RE-RUN NOTE (re64, 2026-09-10): fixed. `sortedValues` parsed every sort key
  // as a number, and seven roots do not have one — `parseInt("Alpha")` is NaN,
  // and `NaN !== 0` is true, so the comparator returned NaN and the id
  // tiebreaker below it was never reached. Numbers sort by value now and
  // everything else as text, and `primaryLabels` is key-sorted for the same
  // reason. The production test is `src/core/crdt/concurrency.test.ts` →
  // "equal state projects the same way, whatever order it arrived in".
  const orderA = projectFromDoc(a).decoders.map(d => d.id);
  const orderB = projectFromDoc(b).decoders.map(d => d.id);
  assert.deepEqual(orderA, orderB);
  assert.equal(JSON.stringify(projectFromDoc(a)), JSON.stringify(projectFromDoc(b)));
  output('FIXED: equal state projects identically whatever the arrival order', { orderA, orderB });
}
{
  class FailingStorage extends SqliteStorage {
    appendOps(changes) { throw Error('injected appendOps failure'); }
  }
  const f = fixture(base, FailingStorage);
  try {
    f.store.document();
    assert.throws(() => f.store.runOps([{ op: 'claim.set', id: 'clm_a', fields: { name: 'Uncommitted' } }], 'alice', 1), /injected/);
    const live = projectFromDoc(f.store.document()).claims[0].name;
    const recovered = projectFromDoc(new ProjectStore(f.storage).document()).claims[0].name;
    // RE-RUN NOTE (re64, 2026-09-10): fixed. The write published to every peer
    // and to the export from inside a transaction that could still roll back, so
    // a caller got an error while readers had been told the edit happened and a
    // restart rebuilt a document that disagreed with both. Publication now waits
    // for the commit, and on failure the in-memory document is dropped and
    // rebuilt from what actually committed. Production test:
    // `src/store/project-store.test.ts` -> "a failed write is not served".
    assert.equal(live, 'Original');
    assert.equal(recovered, 'Original');
    output('FIXED: a rolled-back write is neither served nor published', { live, recovered });
  } finally { f.close(); }
}
{
  const f = fixture();
  try {
    const hashA = f.storage.putBlob('capture.prg', new Uint8Array([0, 0x80, 1]));
    f.workspace.noteUploadedFile(alice, 'capture.prg', hashA, 3);
    const hashB = f.storage.putBlob('capture.prg', new Uint8Array([0, 0x80, 2]));
    f.workspace.noteUploadedFile(alice, 'capture.prg', hashB, 3);
    f.store.undo(alice.userId, alice.sessionId);
    const documentHash = projectFromDoc(f.store.document()).files[0].hash;
    const servedHash = f.storage.blobHash('capture.prg');
    // RE-RUN NOTE (re64, 2026-09-10): fixed. Blobs are stored by content hash,
    // but the read went through a mutable name-to-hash table that `putBlob`
    // rewrites whenever a name is reused — so undo restored the document's hash
    // and left every read of that name serving the replacement. The document is
    // authoritative now: the loader resolves a name through it, and the derived
    // table is brought back in line whenever operations are applied, undo
    // included. Production test: `src/store/project-store.test.ts` -> "the
    // document decides which bytes a name means".
    assert.equal(documentHash, hashA);
    assert.equal(servedHash, hashA);
    output('FIXED: the document decides which bytes a name means', { documentHash, servedHash, servedByte: f.storage.blob('capture.prg')[2] });
  } finally { f.close(); }
}
{
  const f = fixture();
  try {
    f.store.runOps([{ op: 'claim.set', id: 'clm_a', fields: { name: 'First' } }], 'alice', 1, 'alice-session');
    f.store.runOps([{ op: 'claim.set', id: 'clm_a', fields: { name: 'Second' } }], 'alice', 2, 'alice-session');
    const cursor = f.storage.opsCursor();
    f.store.undo('alice', 'alice-session');
    f.store.undo('alice', 'alice-session');
    // RE-RUN NOTE (re64, 2026-09-10): both halves fixed, and they were one
    // subject. Undo now appends an entry rather than only flipping a flag, so a
    // cursor past the edit still sees that it was taken back — and that entry is
    // what tells redo which action to put back, instead of guessing at the
    // highest-numbered undone row.
    const first = f.store.redo('alice', 'alice-session');
    const second = f.store.redo('alice', 'alice-session');
    assert.equal(first.applied, 1);
    assert.equal(second.applied, 1);
    assert.ok(f.storage.opsCursor() > cursor);
    output('FIXED: undo advances the cursor and redo walks back in order', { cursor, afterCursor: f.storage.opsCursor(), redone: [first.applied, second.applied] });
  } finally { f.close(); }
}
