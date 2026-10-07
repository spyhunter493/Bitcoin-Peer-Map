import assert from 'node:assert/strict';
import test from 'node:test';
import { worldWrapOffsets, wrappedWorldDistance } from '../../src/static/js/map/world-wrap.js';
import { worldWrapOffsets as geometryWorldWrapOffsets } from '../../src/static/js/map/geometry.js';

test('world-wrap export compatibility and exact tile edges do not add invisible copies', () => {
    assert.equal(geometryWorldWrapOffsets, worldWrapOffsets);
    assert.deepEqual(worldWrapOffsets(1200, Object.freeze({ x: 0, y: 0, zoom: 1 })), [0]);
    assert.deepEqual(worldWrapOffsets(1200, { x: 1200, y: 0, zoom: 1 }), [360]);
    assert.deepEqual(worldWrapOffsets(1200, { x: -1200, y: 0, zoom: 1 }), [-360]);
    assert.deepEqual(worldWrapOffsets(1200, { x: 600, y: 0, zoom: 1 }), [0, 360]);
    assert.deepEqual(worldWrapOffsets(1200, { x: -600, y: 0, zoom: 1 }), [-360, 0]);
    assert.deepEqual(worldWrapOffsets(1200, { x: 0, y: 0, zoom: 1 }, 200), [-360, 0, 360]);
    assert.deepEqual(worldWrapOffsets(1200, { x: 0, y: 0, zoom: 0.25 }), [-720, -360, 0, 360, 720]);
    assert.equal(Object.is(worldWrapOffsets(1200, { x: -0, y: 0, zoom: 1 })[0], -0), false);
});

test('invalid viewport, horizontal camera, zoom, and margin inputs return no copies', () => {
    for (const width of [0, -1, NaN, Infinity]) assert.deepEqual(worldWrapOffsets(width, { x: 0, y: 0, zoom: 1 }), []);
    for (const x of [NaN, Infinity, -Infinity]) assert.deepEqual(worldWrapOffsets(1200, { x, y: 0, zoom: 1 }), []);
    for (const zoom of [0, -1, NaN, Infinity]) assert.deepEqual(worldWrapOffsets(1200, { x: 0, y: 0, zoom }), []);
    for (const margin of [-1, NaN, Infinity]) assert.deepEqual(worldWrapOffsets(1200, { x: 0, y: 0, zoom: 1 }, margin), []);
});

test('underflow, overflow, and unsafe derived copy indices return without iterating', () => {
    assert.deepEqual(worldWrapOffsets(Number.MIN_VALUE, { x: 0, y: 0, zoom: 0.5 }), []);
    assert.deepEqual(worldWrapOffsets(Number.MAX_VALUE, { x: 0, y: 0, zoom: 2 }), []);
    assert.deepEqual(worldWrapOffsets(1, { x: Number.MAX_VALUE, y: 0, zoom: 1 }), []);
    assert.deepEqual(worldWrapOffsets(1200, { x: Number.MAX_VALUE, y: 0, zoom: 18 }), []);
    assert.deepEqual(worldWrapOffsets(1, { x: 0, y: 0, zoom: Number.MIN_VALUE }), []);
    assert.deepEqual(worldWrapOffsets(1, { x: 0, y: 0, zoom: 2 ** -53 }), []);
    assert.deepEqual(worldWrapOffsets(1200, { x: 0, y: 0, zoom: 1 }, Number.MAX_VALUE), []);
});

test('normalized distance crosses the dateline and ignores complete repeated worlds', () => {
    assert.ok(Math.abs(wrappedWorldDistance(0.999, 0.001) - 0.002) < 1e-12);
    assert.equal(wrappedWorldDistance(0, 0.5), 0.5);
    assert.equal(wrappedWorldDistance(0.25, 8.25), 0);
    assert.equal(wrappedWorldDistance(-7.75, 0.25), 0);
    for (const [first, second] of [[0.1, 0.9], [-8.2, 7.9], [0.999, 0.001]]) {
        assert.equal(wrappedWorldDistance(first, second), wrappedWorldDistance(second, first));
        assert.ok(wrappedWorldDistance(first, second) >= 0 && wrappedWorldDistance(first, second) <= 0.5);
    }
});
