import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraSettled, interpolateCamera, panCamera, peerCameraTarget, verticalPanBounds, wheelCameraTarget } from '../../src/static/js/map/camera.js';
import { peerCameraTarget as navigationPeerCameraTarget } from '../../src/static/js/map/navigation.js';
import { project, screenToWorld, worldToScreen } from '../../src/static/js/map/geometry.js';

const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`);

test('peer framing keeps its public export and places peers relative to the visible panel', () => {
    assert.equal(navigationPeerCameraTarget, peerCameraTarget);
    assert.deepEqual(peerCameraTarget({ lon: 0, lat: 0 }, {
        width: 1200, height: 900, panelCollapsed: false, maxZoom: 18,
    }), { x: -16, y: -76, zoom: 3 });
    for (const [width, height] of [[320, 480], [1200, 900], [1900, 1080]]) {
        for (const panelCollapsed of [false, true]) {
            for (const lat of [-80, -50, 0, 40, 80]) {
                const point = Object.freeze({ lon: 174.7633, lat });
                const options = Object.freeze({ width, height, panelCollapsed, maxZoom: 18 });
                const target = peerCameraTarget(point, options);
                const screen = worldToScreen(point.lon, point.lat, width, height, target);
                close(screen.x, width / 2 + width * 0.04);
                // Keep the existing framing formula's screen placement.
                close(screen.y, height - (40 + (height - (panelCollapsed ? 32 : 340) - 40) * 0.35));
                assert.ok(target.zoom >= 3 && target.zoom <= 18);
            }
        }
    }
});

test('peer framing respects zoom caps and preserves unwrapped longitudes', () => {
    const options = { width: 1200, height: 900, panelCollapsed: false, maxZoom: 2 };
    assert.equal(peerCameraTarget({ lon: 0, lat: 0 }, options).zoom, 2);
    for (const lat of [-85, 85]) {
        const target = peerCameraTarget({ lon: 179.9, lat }, { ...options, maxZoom: 18 });
        assert.equal(target.zoom, 18);
        assert.ok(Object.values(target).every(Number.isFinite));
    }
    const original = peerCameraTarget({ lon: 0, lat: 0 }, { ...options, maxZoom: 18 });
    const repeated = peerCameraTarget({ lon: 720, lat: 0 }, { ...options, maxZoom: 18 });
    assert.equal(repeated.x - original.x, 2400);
    assert.equal(repeated.y, original.y);
    assert.equal(repeated.zoom, original.zoom);
});

test('vertical bounds lock small zooms and keep public world edges outside the viewport', () => {
    for (const zoom of [0.5, 1, 1.001, 1.002]) {
        const bounds = verticalPanBounds(900, zoom);
        assert.equal(bounds.minimum, bounds.maximum);
        close(bounds.minimum, 0);
    }
    assert.deepEqual(verticalPanBounds(0, 3), { minimum: 0, maximum: 0 });
    for (const zoom of [1.01, 3, 18]) {
        const bounds = verticalPanBounds(900, zoom);
        assert.ok(bounds.minimum < bounds.maximum);
        close(worldToScreen(0, 85, 1200, 900, { x: 0, y: bounds.minimum, zoom }).y, 0);
        close(worldToScreen(0, -85, 1200, 900, { x: 0, y: bounds.maximum, zoom }).y, 900);
    }
});

test('private camera bounds retain the Antarctica relaxation and northern limit', () => {
    for (const height of [480, 900, 1080]) {
        const publicBounds = verticalPanBounds(height, 3);
        const privateBounds = verticalPanBounds(height, 3, true);
        close(privateBounds.maximum - publicBounds.maximum, height * 0.35);
        close(privateBounds.minimum, (project(0, -50).y - 0.5) * height);
        assert.ok(privateBounds.minimum > publicBounds.minimum);
    }
    assert.deepEqual(verticalPanBounds(900, 1, true), verticalPanBounds(900, 1));
});

test('camera easing and direct tracking return independent values and keep strict settling thresholds', () => {
    const view = Object.freeze({ x: -1200, y: 200, zoom: 1 });
    const target = Object.freeze({ x: 2400, y: 1000, zoom: 3 });
    assert.deepEqual(interpolateCamera(view, target, 0.12), { x: -768, y: 296, zoom: 1.24 });
    assert.deepEqual(interpolateCamera(view, target, 0), view);
    assert.deepEqual(interpolateCamera(view, target, 1), target);
    const direct = interpolateCamera(view, target, 0.12, true);
    assert.deepEqual(direct, target);
    assert.notEqual(direct, target);
    const origin = { x: 0, y: 0, zoom: 0 };
    assert.equal(cameraSettled(origin, { x: 0.249, y: -0.249, zoom: 0.000999 }), true);
    for (const edge of [{ x: 0.25, y: 0, zoom: 0 }, { x: 0, y: -0.25, zoom: 0 }, { x: 0, y: 0, zoom: 0.001 }]) {
        assert.equal(cameraSettled(origin, edge), false);
    }
});

test('drag speed uses captured zoom and leaves locked vertical state untouched', () => {
    const start = Object.freeze({ x: 1200, y: 300 });
    const delta = Object.freeze({ x: 150, y: -80 });
    assert.deepEqual(panCamera(start, delta, 3), { x: 1150, y: 300 + 80 / 3 });
    for (const zoom of [1, 1.001]) {
        const camera = { x: 1200, y: 40, zoom };
        Object.assign(camera, panCamera(start, delta, zoom));
        assert.equal(camera.y, 40);
        close(camera.x, 1200 - 150 / zoom);
    }
    assert.ok('y' in panCamera(start, delta, 1.002));
});

test('wheel zoom anchors the displayed world point even while target camera is easing or capped', () => {
    const width = 1200, height = 900;
    for (const view of [{ x: 0, y: 0, zoom: 1 }, { x: -9600, y: 175, zoom: 4 }]) {
        for (const target of [view, { x: view.x + 150, y: view.y - 75, zoom: view.zoom + 0.5 }]) {
            for (const cursor of [{ x: 0, y: 0 }, { x: 250, y: 250 }, { x: width, y: height }]) {
                for (const factor of [1.15, 1 / 1.15, 100, 0.001]) {
                    const world = screenToWorld(cursor.x, cursor.y, width, height, view);
                    const next = wheelCameraTarget(Object.freeze({ ...view }), Object.freeze({ ...target }), Object.freeze(cursor),
                        { width, height, factor, minZoom: 1, maxZoom: 18 });
                    const anchored = worldToScreen(world.lon, world.lat, width, height, next);
                    close(anchored.x, cursor.x);
                    close(anchored.y, cursor.y);
                    assert.ok(next.zoom >= 1 && next.zoom <= 18);
                }
            }
        }
    }
});
