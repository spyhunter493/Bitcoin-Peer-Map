import test from 'node:test';
import assert from 'node:assert/strict';
import { create } from '../../src/static/js/core/lifecycle.js';

function clockFixture() {
    let nextId = 0;
    const timers = new Map(), frames = new Map();
    return {
        timers, frames,
        setTimeout: task => { timers.set(++nextId, task); return nextId; },
        clearTimeout: id => timers.delete(id),
        requestAnimationFrame: task => { frames.set(++nextId, task); return nextId; },
        cancelAnimationFrame: id => frames.delete(id),
    };
}
test('disposing a component releases listeners and cancels timers and frames', () => {
    const clock = clockFixture(), component = create(clock), button = new EventTarget();
    let calls = 0;
    component.listen(button, 'click', () => calls++);
    component.timeout(() => calls++, 200);
    component.frame(() => calls++);
    button.dispatchEvent(new Event('click'));
    assert.equal(calls, 1);
    component.dispose();
    component.dispose();
    button.dispatchEvent(new Event('click'));
    assert.equal(calls, 1);
    assert.equal(clock.timers.size, 0);
    assert.equal(clock.frames.size, 0);
    component.listen(button, 'click', () => calls++);
    component.timeout(() => calls++, 200);
    assert.equal(clock.timers.size, 0);
});
test('replacing a render scope releases old controls and preserves other roots', () => {
    const clock = clockFixture(), component = create(clock);
    const oldButton = new EventTarget(), newButton = new EventTarget(), popup = new EventTarget();
    let calls = 0, popupCalls = 0;
    component.replace('panel').listen(oldButton, 'click', () => calls++);
    component.replace('popup').listen(popup, 'click', () => popupCalls++);
    component.replace('panel').listen(newButton, 'click', () => calls++);
    oldButton.dispatchEvent(new Event('click'));
    newButton.dispatchEvent(new Event('click'));
    popup.dispatchEvent(new Event('click'));
    assert.equal(calls, 1);
    assert.equal(popupCalls, 1);
    component.dispose();
    newButton.dispatchEvent(new Event('click'));
    popup.dispatchEvent(new Event('click'));
    assert.equal(calls, 1);
    assert.equal(popupCalls, 1);
});
