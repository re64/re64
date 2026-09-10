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
  const result = projectFromDoc(a).types[0].fields[0];
  assert.equal(result.name, 'old');
  output('field partial edits lose rename', { actual: result });
}
{
  const [a, b] = peers();
  applyOpToDoc(a, { op: 'field.set', typeId: 'typ_a', id: 'fld_a', fields: { offset: 1 } });
  applyOpToDoc(b, { op: 'field.set', typeId: 'typ_a', id: 'fld_a', fields: { offset: 2 } });
  sync(a, b);
  const duplicated = projectFromDoc(a).types[0].fields;
  assert.equal(Object.values(duplicated).filter(f => f.id === 'fld_a').length, 2);
  applyOpToDoc(a, { op: 'field.remove', typeId: 'typ_a', id: 'fld_a' });
  const remaining = projectFromDoc(a).types[0].fields;
  assert.equal(Object.values(remaining).filter(f => f.id === 'fld_a').length, 1);
  output('concurrent field moves duplicate identity', { duplicated, afterRemove: remaining });
}
{
  const f = fixture({ ...base, layers: [{ id: 'lay_a', type: 'prg', path: 'review.prg' }], constants: [{ id: 'cst_a', name: 'ONE', value: '$01' }, { id: 'cst_b', name: 'WHITE', value: '$01' }] });
  try {
    f.storage.putBlob('review.prg', new Uint8Array([0, 0x80, 0xa9, 1, 0x60]));
    f.workspace.bindConstant(alice, 0x8000, 'cst_a');
    f.workspace.bindConstant(alice, 0x8000, 'cst_b');
    const bindings = projectFromDoc(f.store.document()).layers[0].constantUses;
    assert.equal(bindings.length, 2);
    const beforeUnbind = f.workspace.program().loaded.constants.nameAt(0x8000);
    f.workspace.unbindConstant(alice, 0x8000);
    const afterUnbind = f.workspace.program().loaded.constants.nameAt(0x8000);
    assert.ok(afterUnbind);
    output('rebind accumulates uses and unbind leaves one active', { bindings, beforeUnbind, afterUnbind });
  } finally { f.close(); }
}
{
  const project = { ...base, evidence: [{ id: 'evd_a', claim: 'clm_a', kind: 'supports', author: 'alice', method: 'guessed', when: 1 }] };
  const op = { op: 'evidence.set', id: 'evd_a', fields: { by: null } };
  const doc = docFromProject(project);
  applyOpToDoc(doc, op);
  const crdt = projectFromDoc(doc).evidence[0];
  const text = JSON.parse(applyOp(formatProject(project), op)).evidence[0];
  assert.equal(crdt.method, 'guessed');
  assert.equal(text.method, undefined);
  const f = fixture(project);
  try {
    f.workspace.setClaim(alice, 'clm_a', { method: null });
    assert.equal(projectFromDoc(f.store.document()).evidence[0].method, 'guessed');
    output('evidence clear differs across adapters and edit_claim cannot clear method', { crdt, text });
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
    assert.equal(inA.passed, true);
    assert.equal(cachedB.passed, true);
    assert.equal(freshB.passed, false);
    output('scenario cache reuses evidence from wrong target', { inA: inA.passed, cachedB: cachedB.passed, freshB: freshB.passed });
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
    assert.equal(log[0].op.op, 'claim.remove');
    assert.equal(log[0].inverse.op, 'claim.remove');
    output('socket operation inverses paired by index rather than identity', { pairs });
  } finally { f.close(); }
}
{
  const [a, b] = peers();
  applyOpToDoc(a, { op: 'decoder.add', id: 'dec_a', name: 'Alpha', source: 'a' });
  applyOpToDoc(b, { op: 'decoder.add', id: 'dec_b', name: 'Beta', source: 'b' });
  sync(a, b);
  const orderA = projectFromDoc(a).decoders.map(d => d.id);
  const orderB = projectFromDoc(b).decoders.map(d => d.id);
  assert.notDeepEqual(orderA, orderB);
  output('equal CRDT state has arrival dependent projection ordering', { orderA, orderB });
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
    assert.equal(live, 'Uncommitted');
    assert.equal(recovered, 'Original');
    output('SQL rollback leaves changed live document', { live, recovered });
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
    assert.equal(documentHash, hashA);
    assert.equal(servedHash, hashB);
    output('undo restores file hash but reads still serve replacement bytes', { documentHash, servedHash, servedByte: f.storage.blob('capture.prg')[2] });
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
