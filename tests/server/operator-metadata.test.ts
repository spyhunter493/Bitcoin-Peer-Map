import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OperatorMetadataService } from '../../src/server/operator-metadata.ts';

const state = { query: 'outbound tor', networks: ['onion'], filter: { kind: 'direction', key: 'OUT' }, private_mode: false,
    columns: ['id', 'addr'], sort: { key: 'id', direction: 'ascending' } };
test('operator metadata persists independently with revisions, scope, and owner-only permissions', t => {
    const dir = mkdtempSync(join(tmpdir(), 'bpm-metadata-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
    const metadata = new OperatorMetadataService(dir, 'node-a');
    assert.deepEqual(metadata.annotations(), { revision: 0, annotations: [] });
    const policy = '{"sentinel":"policy authority remains untouched"}\n';
    writeFileSync(join(dir, 'peer-policy.json'), policy);
    metadata.setAnnotations({ expected_revision: 0, address: '198.51.100.8', label: 'Remote wallet', note: 'Operator exception' });
    assert.equal(readFileSync(join(dir, 'peer-policy.json'), 'utf8'), policy);
    assert.equal(statSync(join(dir, 'keep-annotations.json')).mode & 0o777, 0o600);
    const restored = new OperatorMetadataService(dir, 'node-a');
    assert.equal(restored.annotations().annotations[0].label, 'Remote wallet');
    assert.deepEqual(new OperatorMetadataService(dir, 'node-b').annotations(), { revision: 0, annotations: [] });
    assert.throws(() => restored.setAnnotations({ expected_revision: 0, address: '198.51.100.8', label: 'Stale', note: '' }), { status: 409 });
    assert.equal(restored.annotations().annotations[0].label, 'Remote wallet');
    restored.setAnnotations({ expected_revision: 1, address: '198.51.100.8', label: '', note: '' });
    assert.deepEqual(restored.annotations(), { revision: 2, annotations: [] });
});
test('shared saved views preserve semantic filters and reject action data and conflicts', t => {
    const dir = mkdtempSync(join(tmpdir(), 'bpm-views-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
    const metadata = new OperatorMetadataService(dir, 'node-a');
    const created = metadata.setSavedViews({ expected_revision: 0, operation: 'create', name: 'Outbound Tor', kind: 'peers', state });
    const view = created.views[0]; assert.ok(view.id); assert.deepEqual(view.state, state);
    assert.equal(metadata.annotations().revision, 0);
    assert.throws(() => metadata.setSavedViews({ expected_revision: 0, operation: 'rename', id: view.id, name: 'Stale' }), { status: 409 });
    assert.throws(() => metadata.setSavedViews({ expected_revision: 1, operation: 'create', name: 'outbound tor', kind: 'peers', state }), { status: 422 });
    assert.throws(() => metadata.setSavedViews({ expected_revision: 1, operation: 'create', name: 'Unsafe', kind: 'peers', state: { ...state, peer_ids: [1] } }), { status: 422 });
    assert.throws(() => metadata.setSavedViews({ expected_revision: 1, operation: 'create', name: 'Unsafe', kind: 'policy', state: { query: '', status: '', network: '', page_size: 10, mode: 'automatic' } }), { status: 422 });
    const updated = metadata.setSavedViews({ expected_revision: 1, operation: 'update', id: view.id, state: { ...state, query: 'updated' } });
    assert.equal(updated.revision, 2);
    assert.equal(new OperatorMetadataService(dir, 'node-a').savedViews().views[0].state.query, 'updated');
    metadata.setSavedViews({ expected_revision: 2, operation: 'delete', id: view.id });
    assert.deepEqual(metadata.savedViews(), { revision: 3, views: [] });
});
test('corrupt metadata disables only the affected store and reads preserve the original file', t => {
    const dir = mkdtempSync(join(tmpdir(), 'bpm-corrupt-metadata-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'saved-views.json'); writeFileSync(path, 'broken', { mode: 0o600 });
    const metadata = new OperatorMetadataService(dir, 'node-a');
    assert.throws(() => metadata.savedViews(), { status: 503 });
    assert.deepEqual(metadata.annotations(), { revision: 0, annotations: [] });
    assert.equal(readFileSync(path, 'utf8'), 'broken');
});
test('annotation updates reject removed Keeps and prune orphaned metadata without touching policy', t => {
    const dir = mkdtempSync(join(tmpdir(), 'bpm-keep-metadata-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
    const metadata = new OperatorMetadataService(dir, 'node-a');
    metadata.setAnnotations({ expected_revision: 0, address: '198.51.100.1', label: 'Old', note: '' }, ['198.51.100.1']);
    assert.throws(() => metadata.setAnnotations({ expected_revision: 1, address: '198.51.100.1', label: 'Removed', note: '' }, ['198.51.100.2']), { status: 409 });
    metadata.setAnnotations({ expected_revision: 1, address: '198.51.100.2', label: 'Current', note: '' }, ['198.51.100.2']);
    assert.deepEqual(metadata.annotations().annotations.map(v => v.label), ['Current']);
});
