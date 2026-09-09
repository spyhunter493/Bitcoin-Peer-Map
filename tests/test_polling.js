'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const timers = new Map();
let nextTimer = 0;
const sandbox = { console, window: {
    setInterval: (callback, interval) => { timers.set(++nextTimer, { callback, interval }); return nextTimer; },
    clearInterval: id => timers.delete(id),
} };
vm.runInNewContext(fs.readFileSync('src/static/js/core/polling.js', 'utf8'), sandbox);
(async () => {
    let requests = 0;
    let finish;
    const errors = [];
    const poller = sandbox.window.BPMPolling.create({ intervalMs: 10000,
        task: () => { requests++; return new Promise(resolve => { finish = resolve; }); },
        onError: error => errors.push(error),
    });
    poller.start();
    const first = poller.run();
    await Promise.resolve();
    timers.get(nextTimer).callback();
    assert.strictEqual(poller.run(), first);
    assert.strictEqual(requests, 1);
    poller.setIntervalMs(5000);
    assert.strictEqual(timers.size, 1);
    assert.strictEqual(timers.get(nextTimer).interval, 5000);
    timers.get(nextTimer).callback();
    assert.strictEqual(requests, 1);
    finish();
    await first;
    const second = poller.run();
    await Promise.resolve();
    assert.strictEqual(requests, 2);
    poller.stop();
    finish();
    await second;
    assert.strictEqual(timers.size, 0);
    assert.throws(() => poller.setIntervalMs(0), /Invalid/);
    const failing = sandbox.window.BPMPolling.create({ intervalMs: 5,
        task: async () => { throw new Error('render failed'); }, onError: error => errors.push(error),
    });
    failing.start();
    timers.get(nextTimer).callback();
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(errors.length, 1);
    assert.strictEqual(errors[0].message, 'render failed');
    failing.stop();
    console.log('Polling lifecycle tests passed');
})().catch(error => { console.error(error); process.exit(1); });
