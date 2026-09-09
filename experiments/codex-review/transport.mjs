// Uses only an isolated temporary project and an OS-assigned loopback port.
// Run after npm run build: node experiments/codex-review/transport.mjs
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStorage } from '../../dist/store/index.js';
import { startServer } from '../../dist/server/index.js';

const dir = mkdtempSync(join(tmpdir(), 're64-codex-transport-'));
const path = join(dir, 'review.re64db');
const storage = new SqliteStorage(path);
storage.initialize(JSON.stringify({ name: 'review', layers: [{ id: 'lay_a', type: 'bytes', address: '$8000', bytes: 'a90160' }], claims: [] }), 0);
const server = startServer({ projectPath: path, host: '127.0.0.1', port: 0, quiet: true, mcpLog: false });
await server.ready;
const endpoint = `http://127.0.0.1:${server.port}/mcp`;
const headers = user => ({ 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-re64-user': user, 'x-re64-session': `${user}-session` });
const body = (name, args = {}) => JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
function unwrap(text) {
  const line = text.split('\n').find(l => l.startsWith('data: '));
  const reply = JSON.parse(line ? line.slice(6) : text);
  if (reply.error) throw Error(JSON.stringify(reply.error));
  return { isError: reply.result.isError ?? false, text: reply.result.content[0].text };
}
async function call(user, name, args = {}) {
  const res = await fetch(endpoint, { method: 'POST', headers: headers(user), body: body(name, args) });
  return unwrap(await res.text());
}
try {
  await call('warmup', 'whoami');
  const aliceBody = body('add_claim', { address: '$8000', name: 'FromAlice' });
  let delayed;
  const result = new Promise((resolve, reject) => {
    delayed = request(endpoint, { method: 'POST', headers: headers('alice') }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => { try { resolve(unwrap(text)); } catch (e) { reject(e); } });
    });
    delayed.on('error', reject);
    delayed.write(aliceBody.slice(0, 20));
  });
  // Hold Alice's body open while Bob completes a valid request.
  await new Promise(resolve => setTimeout(resolve, 100));
  const bob = await call('bob', 'whoami');
  assert.equal(JSON.parse(bob.text).userId, 'bob');
  delayed.end(aliceBody.slice(20));
  assert.equal((await result).isError, false);
  const written = storage.readOps().filter(c => c.op.op === 'claim.add');
  assert.equal(written[0].author, 'bob');
  console.log(JSON.stringify({ case: 'overlapping MCP calls use another caller identity', port: server.port, requestUser: 'alice', recordedAuthor: written[0].author, recordedSession: written[0].session }));

  const malformed = await call('alice', 'add_claim', { address: '$8000+1', name: 'MalformedAddress' });
  assert.equal(malformed.isError, false);
  const last = storage.readOps().filter(c => c.op.op === 'claim.add').at(-1);
  assert.equal(last.op.claim.at, 0);
  console.log(JSON.stringify({ case: 'malformed address accepted after parsing only its prefix', requested: '$8000+1', storedOffset: last.op.claim.at, actualAddress: '$8000' }));

  const before = storage.readOps().length;
  const projectResponse = await fetch(`http://127.0.0.1:${server.port}/api/project`);
  const snapshot = await projectResponse.json();
  const edited = JSON.parse(snapshot.raw);
  edited.description = 'HTTP edit should be in changes_since';
  const saved = await fetch(`http://127.0.0.1:${server.port}/api/project`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ raw: JSON.stringify(edited), baseVersion: snapshot.version }) });
  assert.equal(saved.status, 200);
  assert.equal(JSON.parse(storage.readText()).description, edited.description);
  assert.equal(storage.readOps().length, before);
  console.log(JSON.stringify({ case: 'HTTP project write missing from operation log', committed: true, addedOperations: storage.readOps().length - before }));
} finally {
  await server.close();
  storage.close();
  rmSync(dir, { recursive: true, force: true });
}
