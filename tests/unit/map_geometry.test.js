import assert from 'node:assert/strict';
import test from 'node:test';
import { worldWrapOffsets, worldToScreen, screenToWorld, project } from '../../src/static/js/map/geometry.js';
import { create as createConnections } from '../../src/static/js/map/connection-renderer.js';

test('world copies cover the viewport at distant cameras and have bounded counts', () => {
    for (const zoom of [1, 3, 18]) {
        for (const x of [-120000, -7200, -1200, 0, 1200, 7200, 120000]) {
            const width = 1200, camera = { x, y: 0, zoom };
            for (const margin of [0, 200]) {
                const offsets = worldWrapOffsets(width, camera, margin);
                assert.ok(offsets.length > 0 && offsets.length <= 3);
                const edges = offsets.map(offset => ({
                    left: worldToScreen(-180 + offset, 0, width, 900, camera).x,
                    right: worldToScreen(180 + offset, 0, width, 900, camera).x,
                }));
                assert.ok(edges[0].left <= -margin);
                assert.ok(edges.at(-1).right >= width + margin);
                for (let index = 1; index < edges.length; index++) assert.equal(edges[index].left, edges[index - 1].right);
                assert.ok(edges.every(edge => edge.right > -margin && edge.left < width + margin));
                const world = screenToWorld(400, 350, width, 900, camera);
                const screen = worldToScreen(world.lon, world.lat, width, 900, camera);
                assert.ok(Math.abs(screen.x - 400) < 1e-6 && Math.abs(screen.y - 350) < 1e-6);
            }
        }
    }
    assert.deepEqual(worldWrapOffsets(1200, { x: 0, y: 0, zoom: 1 }), [0]);
    assert.deepEqual(worldWrapOffsets(1200, { x: 1200, y: 0, zoom: 1 }), [360]);
    assert.deepEqual(worldWrapOffsets(0, { x: 0, y: 0, zoom: 1 }), []);
});

test('private network lettering repeats in distant copies with unchanged opacity', () => {
    const width = 1200, height = 900;
    const view = { x: 0, y: (project(0, -75).y - 0.5) * height, zoom: 2 };
    let text = [];
    const context = { save() {}, restore() {}, fillText(label, x, y) {
        text.push({ label, x: Math.round(x * 1e6), y: Math.round(y * 1e6), fill: this.fillStyle });
    } };
    const connections = createConnections({ mapView: { width, height }, view, ctx: context,
        privateState: { privateNetMode: true }, preferences: { advSettings: {} },
        showAntarcticaPeers: () => true,
        worldToScreen: (lon, lat) => worldToScreen(lon, lat, width, height, view),
    });
    connections.drawPrivateNetworksText(worldWrapOffsets(width, view, 200));
    const original = text;
    assert.ok(original.some(row => row.label === 'P R I V A T E'));
    for (const worlds of [-8, 8]) {
        view.x = width * worlds;
        text = [];
        connections.drawPrivateNetworksText(worldWrapOffsets(width, view, 200));
        assert.deepEqual(text, original);
    }
});
