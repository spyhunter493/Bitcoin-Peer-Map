import BPMServiceFlags from '../peers/service-flags.js';
/** @type {Readonly<Record<string, string>>} */
const connectionTypes = Object.freeze({
    'outbound-full-relay': 'Outbound Full Relay',
    'block-relay-only': 'Block Relay Only',
    manual: 'Manual',
    'addr-fetch': 'Address Fetch',
    feeler: 'Feeler',
    inbound: 'Inbound',
});
/** @type {Readonly<Record<string, string>>} */
const connectionLabels = Object.freeze({
    'outbound-full-relay': 'OUT/OFR',
    'block-relay-only': 'OUT/BRO',
    manual: 'OUT/MAN',
    'addr-fetch': 'ADDR',
    feeler: 'FEEL',
    inbound: 'IN',
});
/**
 * @param {import('../types').ServiceFlag} flag
 */
function serviceFlagDescription(flag) {
    return flag.rpc ? flag.label + ' (' + flag.rpc + ')' : flag.label;
}
/**
 * @param {number | null | undefined} bytes
 */
function fmtBytes(bytes) {
    if (bytes == null || isNaN(bytes)) return '\u2014';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
}

/** @param {unknown} value @returns {value is number} */
function isMeasuredRate(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** @param {unknown} bytesPerSecond */
function fmtBps(bytesPerSecond) {
    if (!isMeasuredRate(bytesPerSecond)) return '\u2014';
    if (bytesPerSecond === 0) return '0 B/s';
    if (bytesPerSecond < 0.1) return '<0.1 B/s';
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s'];
    let unit = 0, value = bytesPerSecond;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    const text = unit === 0 ? String(Number(value.toFixed(1))) : value.toFixed(1);
    return text + ' ' + units[unit];
}

/**
 * @param {number | null | undefined} seconds
 */
function fmtDuration(seconds) {
    if (!seconds || seconds <= 0) return '\u2014';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return days + 'd ' + hours + 'h';
    if (hours > 0) return hours + 'h ' + minutes + 'm';
    return minutes + 'm';
}

/**
 * @param {number | null | undefined} bytes
 */
function fmtBytesShort(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0,
        value = bytes;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i++;
    }
    return value.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
}
/**
 * @param {string[] | undefined} services
 */
function serviceAbbrev(services) {
    if (!services?.length) return '\u2014';
    return services.map((name) => (Object.hasOwn(BPMServiceFlags, name) ? BPMServiceFlags[name].abbr : name.charAt(0))).join(' ');
}
/**
 * @param {string[] | undefined} services
 */
function serviceHover(services) {
    if (!services?.length) return 'No service flags';
    return services
        .map((name) => {
            const flag = Object.hasOwn(BPMServiceFlags, name) ? BPMServiceFlags[name] : null;
            return flag ? flag.abbr + ' = ' + serviceFlagDescription(flag) : name;
        })
        .join('\n');
}
export { fmtBytes };
export { fmtBps };
export { isMeasuredRate };
export { fmtBytesShort };
export { fmtDuration };
export { serviceAbbrev };
export { serviceHover };
export { connectionTypes };
export { connectionLabels };
export { serviceFlagDescription };
