/** @param {unknown} value @returns {value is number} */
export function isMeasuredPing(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** @param {unknown} value */
export function fmtPing(value) {
    if (!isMeasuredPing(value)) return '\u2014';
    if (value > 0 && value < 0.1) return '<0.1ms';
    return `${Number(value.toFixed(1))}ms`;
}

/** @param {readonly (number | null | undefined)[]} values @returns {number | null} */
export function averagePing(values) {
    let total = 0, count = 0;
    for (const value of values) {
        if (isMeasuredPing(value)) { total += value; count++; }
    }
    return count ? total / count : null;
}

/** Unknown measurements stay last in either direction.
 * @param {unknown} left @param {unknown} right @param {boolean} [ascending] */
export function comparePing(left, right, ascending = true) {
    if (!isMeasuredPing(left)) return isMeasuredPing(right) ? 1 : 0;
    if (!isMeasuredPing(right)) return -1;
    return ascending ? left - right : right - left;
}
