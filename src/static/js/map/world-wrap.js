/** Visible copies of the world, including a margin in screen pixels.
 * @param {number} width
 * @param {import('../types').Camera} view
 * @param {number} [margin]
 */
export function worldWrapOffsets(width, view, margin = 0) {
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(view.x) ||
        !Number.isFinite(view.zoom) || view.zoom <= 0 || !Number.isFinite(margin) || margin < 0) return [];
    const tileWidth = width * view.zoom;
    if (!Number.isFinite(tileWidth) || tileWidth <= 0) return [];
    const left = width / 2 - view.x * view.zoom - tileWidth / 2;
    const first = Math.floor((-margin - left) / tileWidth);
    const last = Math.ceil((width + margin - left) / tileWidth) - 1;
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) ||
        !Number.isSafeInteger(last - first + 1)) return [];
    const offsets = [];
    for (let copy = first; copy <= last; copy++) offsets.push(copy * 360 || 0);
    return offsets;
}

/** Shortest horizontal distance between normalized world positions.
 * @param {number} first
 * @param {number} second
 */
export function wrappedWorldDistance(first, second) {
    const distance = Math.abs(first - second) % 1;
    return Math.min(distance, 1 - distance);
}
