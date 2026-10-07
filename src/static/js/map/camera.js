import { project, screenToWorld, clamp, lerp } from './geometry.js';

/** Compute peer framing without changing selection, layout, or camera state.
 * @param {{lon: number; lat: number}} point
 * @param {import('../types').PeerCameraOptions} options
 * @returns {import('../types').Camera}
 */
export function peerCameraTarget({ lon, lat }, { width, height, panelCollapsed, maxZoom }) {
    const point = project(lon, lat);
    const targetScreenY = 40 + (height - (panelCollapsed ? 32 : 340) - 40) * 0.35;
    let zoom = 3;
    for (; zoom <= maxZoom; zoom += 0.2) {
        const offset = (height / 2 - targetScreenY) / zoom;
        const candidate = (point.y - 0.5) * height - offset;
        const minY = (project(0, 85).y - 0.5) * height + height / (2 * zoom);
        const maxY = (project(0, -85).y - 0.5) * height - height / (2 * zoom);
        if (minY < maxY && candidate >= minY && candidate <= maxY) break;
    }
    zoom = Math.min(zoom, maxZoom);
    return {
        x: (point.x - 0.5) * width - (width * 0.04) / zoom,
        y: (point.y - 0.5) * height - (height / 2 - targetScreenY) / zoom,
        zoom,
    };
}

/** Allowed vertical camera range; a single point locks an unzoomed view.
 * Horizontal movement remains unrestricted because the world repeats.
 * @param {number} height
 * @param {number} zoom
 * @param {boolean} [privateMode]
 */
export function verticalPanBounds(height, zoom, privateMode = false) {
    const yTop = project(0, 85).y;
    const yBottom = project(0, -85).y;
    const centerY = ((yTop + yBottom) / 2 - 0.5) * height;
    if (zoom <= 1.001) return { minimum: centerY, maximum: centerY };
    let minimum = (yTop - 0.5) * height + height / (2 * zoom);
    let maximum = (yBottom - 0.5) * height - height / (2 * zoom);
    if (privateMode) {
        maximum += height * 0.35;
        minimum = Math.max(minimum, (project(0, -50).y - 0.5) * height);
    }
    return minimum >= maximum ? { minimum: centerY, maximum: centerY } : { minimum, maximum };
}

/** @param {import('../types').Camera} view
 * @param {import('../types').Camera} target
 * @param {number} smoothing
 * @param {boolean} [immediate]
 * @returns {import('../types').Camera}
 */
export function interpolateCamera(view, target, smoothing, immediate = false) {
    return immediate ? { x: target.x, y: target.y, zoom: target.zoom } : {
        x: lerp(view.x, target.x, smoothing),
        y: lerp(view.y, target.y, smoothing),
        zoom: lerp(view.zoom, target.zoom, smoothing),
    };
}

/** @param {import('../types').Camera} view
 * @param {import('../types').Camera} target
 */
export function cameraSettled(view, target) {
    return Math.abs(view.x - target.x) < 0.25 &&
        Math.abs(view.y - target.y) < 0.25 &&
        Math.abs(view.zoom - target.zoom) < 0.001;
}

/** Drag from the captured starting camera at its captured zoom.
 * The omitted y value preserves the vertical lock at zoom 1.
 * @param {import('../types').Point} start
 * @param {import('../types').Point} delta
 * @param {number} zoom
 * @returns {{x: number; y?: number}}
 */
export function panCamera(start, delta, zoom) {
    const x = start.x - delta.x / zoom;
    return zoom > 1.001 ? { x, y: start.y - delta.y / zoom } : { x };
}

/** Keep the world point under the cursor anchored while changing target zoom.
 * The displayed view may still be easing toward the existing target.
 * @param {import('../types').Camera} view
 * @param {import('../types').Camera} target
 * @param {import('../types').Point} cursor
 * @param {{width: number; height: number; factor: number; minZoom: number; maxZoom: number}} options
 * @returns {import('../types').Camera}
 */
export function wheelCameraTarget(view, target, cursor, { width, height, factor, minZoom, maxZoom }) {
    const zoom = clamp(target.zoom * factor, minZoom, maxZoom);
    const worldBefore = screenToWorld(cursor.x, cursor.y, width, height, view);
    const point = project(worldBefore.lon, worldBefore.lat);
    const screenX = (point.x - 0.5) * width * zoom + width / 2 - target.x * zoom;
    const screenY = (point.y - 0.5) * height * zoom + height / 2 - target.y * zoom;
    return {
        x: target.x + (screenX - cursor.x) / zoom,
        y: target.y + (screenY - cursor.y) / zoom,
        zoom,
    };
}
