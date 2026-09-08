'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

let source = fs.readFileSync('src/static/js/as-distribution.js', 'utf8');
const marker = '    return {';
const markerPosition = source.lastIndexOf(marker);
assert.notStrictEqual(markerPosition, -1, 'module return marker not found');
source = source.slice(0, markerPosition)
    + '    window.__test = { escHtml: escHtml, peerDetailRow: peerDetailRow, renderServiceFlagList: renderServiceFlagList };\n'
    + source.slice(markerPosition);

const sandbox = { window: {} };
vm.runInNewContext(source, sandbox);
const { escHtml, peerDetailRow, renderServiceFlagList } = sandbox.window.__test;
const hostile = `<img src=x onerror="alert(1)"> & '`;
const escaped = '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;';

assert.strictEqual(escHtml(hostile), escaped);
assert.strictEqual(escHtml(0), '0');
assert.strictEqual(escHtml(null), '');

const ordinaryRow = peerDetailRow('<label>', hostile);
assert.ok(ordinaryRow.includes('&lt;label&gt;'));
assert.ok(ordinaryRow.includes(escaped));
assert.ok(!ordinaryRow.includes('<img'));

const trustedRow = peerDetailRow('Session ID', `<span>${escHtml(hostile)}</span>`, true);
assert.ok(trustedRow.includes('<span>'));
assert.ok(!trustedRow.includes('<img'));

const serviceList = renderServiceFlagList('N W NL');
assert.ok(serviceList.includes('class="service-flag-list"'));
assert.ok(serviceList.includes('NODE_NETWORK'));
assert.ok(serviceList.includes('Segregated Witness'));
assert.ok(!serviceList.includes('<br>'));

console.log('JavaScript escaping tests passed');
