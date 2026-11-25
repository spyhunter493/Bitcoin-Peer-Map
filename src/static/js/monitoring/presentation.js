import { escapeHtml } from '../core/modal.js';
import { fmtBytes } from '../core/format.js';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium' });
/** @param {number | null | undefined} value */
export function date(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? dateFormat.format(new Date(value * 1000)) : 'Unavailable';
}
/** @param {import('../../../shared/api.generated').HistoryCoverage} value */
export function coverage(value) {
    return `<p class="monitoring-coverage">${value.recording ? 'Recording enabled' : 'Recording disabled'} · Collection began: ${escapeHtml(date(value.started_at))}. ` +
        `Oldest available: ${escapeHtml(date(value.oldest_at))}; newest: ${escapeHtml(date(value.newest_at))}. ` +
        `${escapeHtml(value.gaps)} monitoring gap(s); ${escapeHtml(value.dropped)} dropped record(s).` +
        `${value.incomplete ? ' Coverage is incomplete; totals describe only retained observations.' : ' Values describe the recorded interval, not necessarily the full selected period.'}</p>`;
}
/** @param {import('../../../shared/api.generated').HistoryEvent[]} events */
export function eventRows(events) {
    return events.length ? events.map(event => `<article class="monitoring-event"><div><time>${escapeHtml(date(event.time))}</time>` +
        `<span>${escapeHtml(event.source)} · ${escapeHtml(event.kind.replaceAll('_', ' '))}</span></div>` +
        `${event.address ? `<code>${escapeHtml(event.address)}</code>` : event.peer_id !== null ? `<code>Peer #${escapeHtml(event.peer_id)}</code>` : ''}<p>${escapeHtml(event.reason)}</p></article>`).join('')
        : '<p class="monitoring-empty">No recorded events match this period and these filters.</p>';
}
/** A bounded SVG keeps plots independent of external chart services.
 * Null samples and missing intervals break lines rather than inventing traffic.
 * @param {{time:number;first:number|null;second:number|null}[]} samples
 * @param {{title:string;first:string;second:string;traffic?:boolean}} options */
export function chart(samples, options) {
    if (!samples.length) return `<section class="monitoring-chart"><h3>${escapeHtml(options.title)}</h3><p>No recorded samples in this period.</p></section>`;
    const points = samples.slice(0, 1000);
    const finite = points.flatMap(point => [point.first, point.second]).filter(/** @returns {n is number} */ n => typeof n === 'number' && Number.isFinite(n) && n >= 0);
    if (!finite.length) return `<section class="monitoring-chart"><h3>${escapeHtml(options.title)}</h3><p>Samples are unavailable across this interval.</p></section>`;
    const top = Math.max(1, ...finite), start = points[0].time, end = points.at(-1)?.time ?? start;
    const intervals = points.slice(1).map((point, index) => point.time - points[index].time).filter(value => value > 0).sort((a, b) => a - b);
    const interval = intervals[Math.floor(intervals.length / 2)] || 60;
    /** @param {'first'|'second'} key */
    function line(key) {
        let connected = false, previousTime = 0;
        return points.map(point => {
            const value = point[key];
            if (value === null || !Number.isFinite(value) || value < 0) { connected = false; return ''; }
            const x = 45 + (point.time - start) / Math.max(1, end - start) * 650;
            const y = 155 - value / top * 135;
            const command = connected && point.time - previousTime <= interval * 1.5 ? 'L' : 'M';
            connected = true; previousTime = point.time;
            return `${command}${x.toFixed(2)},${y.toFixed(2)}`;
        }).join(' ');
    }
    const maximum = options.traffic ? `${fmtBytes(top)}/s` : String(Math.ceil(top));
    return `<section class="monitoring-chart"><h3>${escapeHtml(options.title)}</h3>` +
        `<div class="monitoring-chart-legend"><span>${escapeHtml(options.first)}</span><span>${escapeHtml(options.second)}</span></div>` +
        `<svg viewBox="0 0 720 180" role="img" aria-label="${escapeHtml(options.title)}; ${escapeHtml(options.first)} and ${escapeHtml(options.second)}. Maximum ${escapeHtml(maximum)}.">` +
        '<path d="M45 20V155H695" class="monitoring-axis"/><text x="2" y="25">' + escapeHtml(maximum) + '</text><text x="26" y="155">0</text>' +
        `<path d="${line('first')}" class="monitoring-line-first"/><path d="${line('second')}" class="monitoring-line-second"/></svg>` +
        `<p class="monitoring-chart-range">${escapeHtml(date(start))} — ${escapeHtml(date(end))}</p></section>`;
}

/** @param {unknown} value */
export function valueText(value) {
    if (value === null || value === undefined) return 'Unavailable';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') return Number.isFinite(value) ? String(Math.round(value * 10) / 10) : 'Unavailable';
    return String(value);
}

/** @param {Record<string, unknown>} data @returns {string} */
export function diagnosticRows(data) {
    return Object.entries(data).map(([key, value]) => {
        const label = key.replaceAll('_', ' ');
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return `<section class="monitoring-diagnostic"><h3>${escapeHtml(label)}</h3>${diagnosticRows(/** @type {Record<string,unknown>} */ (value))}</section>`;
        }
        if (Array.isArray(value) && value.some(item => item && typeof item === 'object')) {
            return `<section class="monitoring-diagnostic"><h3>${escapeHtml(label)}</h3>${value.map(item => item && typeof item === 'object'
                ? diagnosticRows(/** @type {Record<string,unknown>} */ (item)) : escapeHtml(valueText(item))).join('')}</section>`;
        }
        const text = key.endsWith('_at') && typeof value === 'number' ? date(value) : Array.isArray(value) ? value.map(valueText).join(', ') : valueText(value);
        return `<div class="monitoring-diagnostic-row"><span>${escapeHtml(label)}</span><span>${escapeHtml(text)}</span></div>`;
    }).join('');
}
