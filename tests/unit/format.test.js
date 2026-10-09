import assert from 'node:assert/strict';
import test from 'node:test';
import { fmtBps, isMeasuredRate } from '../../src/static/js/core/format.js';
import { renderPeerDetails } from '../../src/static/js/peers/detail.js';

test('bandwidth rates distinguish unavailable, idle, fractional, and active connections', () => {
    for (const value of [null, undefined, NaN, Infinity, -Infinity, -1, '0']) {
        assert.equal(isMeasuredRate(value), false);
        assert.equal(fmtBps(value), '—');
    }
    for (const [value, expected] of [
        [0, '0 B/s'], [0.004, '<0.1 B/s'], [0.1, '0.1 B/s'], [0.4, '0.4 B/s'],
        [512, '512 B/s'], [1024, '1.0 KB/s'], [1536, '1.5 KB/s'],
        [1048576, '1.0 MB/s'], [1073741824, '1.0 GB/s'], [1099511627776, '1.0 TB/s'],
    ]) {
        assert.equal(isMeasuredRate(value), true);
        assert.equal(fmtBps(value), expected);
    }
});

test('public and private peer details show send and receive rates beside their totals', () => {
    for (const privateNetwork of [false, true]) {
        const peer = { id: 1, network: privateNetwork ? 'onion' : 'ipv4',
            bytessent: 2048, bytesrecv: 4096, tx_bps: 1024, rx_bps: 0 };
        const { html } = renderPeerDetails(peer, { privateNetwork });
        assert.match(html, /Bytes Sent<\/span>.*?>2\.0 KB<\/span>/);
        assert.match(html, /Send rate<\/span>.*?>1\.0 KB\/s<\/span>/);
        assert.match(html, /Bytes Recv<\/span>.*?>4\.0 KB<\/span>/);
        assert.match(html, /Recv rate<\/span>.*?>0 B\/s<\/span>/);
        assert.ok(html.indexOf('Bytes Sent') < html.indexOf('Send rate'));
        assert.ok(html.indexOf('Send rate') < html.indexOf('Bytes Recv'));
        assert.ok(html.indexOf('Bytes Recv') < html.indexOf('Recv rate'));
        const unknown = renderPeerDetails({ ...peer, tx_bps: null, rx_bps: null }, { privateNetwork }).html;
        assert.match(unknown, /Send rate<\/span>.*?>—<\/span>/);
        assert.match(unknown, /Recv rate<\/span>.*?>—<\/span>/);
    }
});
