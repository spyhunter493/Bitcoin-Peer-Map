import test from 'node:test';
import assert from 'node:assert/strict';
import { compareNames, copyPreferences, formatAmount, nextWallet, readyWallets } from '../../src/static/js/wallets/model.js';

test('wallet amounts preserve one satoshi, zero, eight decimals and safe large balances', () => {
    assert.equal(formatAmount(0, 'BTC'), '0.00000000 BTC');
    assert.equal(formatAmount(1, 'BTC'), '0.00000001 BTC');
    assert.equal(formatAmount(123456789, 'BTC'), '1.23456789 BTC');
    assert.equal(formatAmount(2100000000000000, 'BTC'), '21000000.00000000 BTC');
    assert.equal(formatAmount(123456789, 'sats'), '123456789 sats');
    for (const invalid of [null, NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) assert.equal(formatAmount(invalid, 'BTC'), '—');
});

test('only selected ready balances rotate, including empty-name and zero-balance wallets', () => {
    const preferences = { selected_wallets: ['z', '', 'A', 'scanning', 'bad', 'unloaded'], unit: 'BTC', rotation_seconds: 8, paused: false };
    const rows = [
        { name: 'z', state: 'ready', balance_sats: 10 },
        { name: '', state: 'ready', balance_sats: 0 },
        { name: 'A', state: 'ready', balance_sats: 1 },
        { name: 'not-selected', state: 'ready', balance_sats: 2 },
        { name: 'scanning', state: 'scanning', balance_sats: 5 },
        { name: 'bad', state: 'ready', balance_sats: null },
        { name: 'unloaded', state: 'unloaded', balance_sats: null },
    ];
    assert.deepEqual(readyWallets(rows, preferences).map(row => row.name), ['', 'A', 'z']);
    assert.deepEqual(readyWallets(rows, null), []);
    assert.deepEqual([...preferences.selected_wallets].sort(compareNames), ['', 'A', 'bad', 'scanning', 'unloaded', 'z']);
});

test('rotation keeps a current wallet through refresh, supports default names and wraps manually', () => {
    assert.equal(nextWallet([], null), null);
    assert.equal(nextWallet([''], null), '');
    assert.equal(nextWallet(['', 'A', 'z'], 'A'), 'A');
    assert.equal(nextWallet(['', 'A', 'z'], 'A', 1), 'z');
    assert.equal(nextWallet(['', 'A', 'z'], '', -1), 'z');
    assert.equal(nextWallet(['', 'A'], 'unloaded'), '');
});

test('optimistic preference edits cannot mutate the committed selected-wallet list', () => {
    const preferences = { selected_wallets: ['original'], unit: 'BTC', rotation_seconds: 8, paused: false };
    const copy = copyPreferences(preferences);
    copy.selected_wallets.push('new');
    assert.deepEqual(preferences.selected_wallets, ['original']);
});
