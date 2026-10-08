/** @param {unknown} value */
function csvCell(value) {
    if (value == null) return '';
    let text = String(value);
    // Spreadsheet programs may ignore whitespace and controls before a formula.
    // Actual numbers (including negative values) remain numeric CSV cells.
    if (typeof value !== 'number' && typeof value !== 'boolean' && /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@]/.test(text)) {
        text = "'" + text;
    }
    return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

/**
 * Export the complete filtered result using selected columns and display values.
 *
 * @param {readonly import('../types').Peer[]} peers
 * @param {readonly (import('../types').PeerColumn & {label: string})[]} columns
 * @returns {string}
 */
function toCsv(peers, columns) {
    const rows = [columns.map((column) => csvCell(column.label)).join(',')];
    for (const peer of peers) {
        rows.push(columns.map((column) => csvCell(column.get(peer))).join(','));
    }
    return rows.join('\r\n') + '\r\n';
}

/**
 * Keep raw peer fields and scope metadata for later investigation.
 *
 * @param {readonly import('../types').Peer[]} peers
 * @param {{exported_at: string, [key: string]: unknown}} metadata
 * @returns {string}
 */
function toJson(peers, metadata) {
    const { exported_at, ...scope } = metadata;
    return JSON.stringify({ exported_at, ...scope, count: peers.length, peers }, null, 2);
}

export { toCsv, toJson };
