import test from 'node:test';
import assert from 'node:assert/strict';
import { create } from '../../src/static/js/peers/actions.js';

function environment() {
    const children = [], timers = new Map();
    let nextTimer = 0;
    const document = {
        defaultView: null,
        getElementById: id => children.find(child => child.id === id) || null,
        createElement: () => ({ style: {}, setAttribute() {}, remove() {
            const index = children.indexOf(this);
            if (index >= 0) children.splice(index, 1);
        } }),
        body: { appendChild: child => children.push(child) },
    };
    const clock = { setTimeout: task => { timers.set(++nextTimer, task); return nextTimer; }, clearTimeout: id => timers.delete(id) };
    const button = new EventTarget();
    button.dataset = {};
    button.classList = { remove() {} };
    const instance = create({ document, clock, refreshPeers: () => assert.fail('Unexpected peer refresh') });
    return { instance, document, children, timers, button };
}

test('peer action disposal removes notifications and timers and prevents detached controls or late results from reopening UI', () => {
    const f = environment();
    f.instance.init(f.button);
    f.instance.showResult('PRIVATE-ADDRESS', true);
    assert.equal(f.children[0].textContent, 'PRIVATE-ADDRESS');
    assert.equal(f.timers.size, 1);
    f.instance.dispose();
    f.instance.dispose();
    assert.deepEqual(f.children, []);
    assert.equal(f.timers.size, 0);
    assert.equal(f.button.dataset.bpmPeerActionsBound, undefined);
    f.button.dispatchEvent(new Event('click'));
    f.instance.showResult('LATE-PRIVATE-ADDRESS', false);
    f.instance.openBanModal();
    f.instance.showDisconnectDialog(1, 'ipv4');
    f.instance.init(f.button);
    assert.deepEqual(f.children, []);
    assert.equal(f.timers.size, 0);
    assert.equal(f.button.dataset.bpmPeerActionsBound, undefined);
});

test('a replacement notification cancels its predecessor timer, and a fresh action controller can bind the released button', () => {
    const f = environment();
    f.instance.init(f.button);
    f.instance.showResult('first', true);
    f.instance.showResult('second', true);
    assert.equal(f.children.length, 1);
    assert.equal(f.children[0].textContent, 'second');
    assert.equal(f.timers.size, 1);
    f.instance.dispose();
    const next = create({ document: f.document, clock: { setTimeout() {}, clearTimeout() {} }, refreshPeers() {} });
    next.init(f.button);
    assert.equal(f.button.dataset.bpmPeerActionsBound, 'true');
    next.dispose();
});
