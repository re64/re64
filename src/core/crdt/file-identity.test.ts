import { describe, it, expect } from 'vitest';
import { docFromProject, projectFromDoc, migrateDoc } from './doc.js';
import { applyOpToDoc } from './ops.js';
import { parseProject } from '../project/project.js';
import { filesWithIds, resolveFile, fileId } from '../project/files.js';
import * as Y from 'yjs';
describe('file identities and their references', () => {
  it('preserves two same-name uploads, including captures and layer references across rename', () => {
    const doc = docFromProject({ layers: [{ id: 'lay_a', type: 'prg', file: 'fil_a' }], captures: [{ id: 'cap_a', scenario: 'scn_a', step: 'stp_a', kind: 'screen', file: 'fil_a' }] });
    for (const id of ['fil_a', 'fil_b'])
      applyOpToDoc(doc, { op: 'file.add', id, name: 'capture.prg', hash: id, size: 3 });
    let p = projectFromDoc(doc);
    expect(p.files).toHaveLength(2);
    expect(() => resolveFile(p.files!, 'capture.prg')).toThrow(/fil_a.*fil_b/);
    expect(resolveFile(p.files!, 'fil_a').hash).toBe('fil_a');
    applyOpToDoc(doc, { op: 'file.set', id: 'fil_a', fields: { name: 'earlier.prg' } });
    p = projectFromDoc(doc);
    expect(p.layers[0].file).toBe('fil_a');
    expect(p.captures![0].file).toBe('fil_a');
    expect(resolveFile(p.files!, 'earlier.prg').hash).toBe('fil_a');
  });
  it('migrates disk selectors and capture names once without guessing missing content', () => {
    const p = parseProject(JSON.stringify({ layers: [{ type: 'prg', path: 'disk.d64:GAME' }], captures: [{ id: 'cap_a', scenario: 'scn_a', step: 'stp_a', kind: 'screen', file: 'title.png' }], files: [{ name: 'disk.d64', hash: 'diskhash', size: 174848 }] }));
    expect(p.layers[0]).toMatchObject({ file: fileId('disk.d64'), member: 'GAME' });
    expect(p.layers[0].path).toBeUndefined();
    expect(p.captures![0].file).toBe(fileId('title.png'));
    expect(p.files!.find(f => f.name === 'title.png')!.hash).toBeUndefined();
    expect(filesWithIds(p)).toBe(p);
  });
  it('migrates name-keyed stored snapshots and preserves unrelated CRDT items', () => {
    const doc = new Y.Doc();
    const files = doc.getMap<Y.Map<unknown>>('files');
    const f = new Y.Map<unknown>();
    files.set('disk.d64', f);
    f.set('name', 'disk.d64');
    f.set('hash', 'h');
    f.set('size', 10);
    const layer = new Y.Map<unknown>();
    doc.getArray<Y.Map<unknown>>('layers').push([layer]);
    layer.set('id', 'lay_a');
    layer.set('type', 'prg');
    layer.set('path', 'disk.d64:GAME');
    expect(migrateDoc(doc)).toBe(true);
    expect(files.get(fileId('disk.d64'))!.toJSON()).toEqual({ id: fileId('disk.d64'), name: 'disk.d64', hash: 'h', size: 10 });
    expect(doc.getArray('layers').get(0)).toBe(layer);
    expect(layer.get('file')).toBe(fileId('disk.d64'));
    expect(layer.get('member')).toBe('GAME');
    expect(migrateDoc(doc)).toBe(false);
  });
});
