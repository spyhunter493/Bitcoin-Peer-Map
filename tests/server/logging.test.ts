import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOG_LEVELS, configureLogging, createFailureReporter, createLogger } from '../../src/server/logging.ts';
import { temporaryDirectory } from './helpers.ts';

function capture(t: TestContext) {
    const lines: { level: string; message: string }[] = [];
    for (const level of LOG_LEVELS) t.mock.method(console, level, (message: string) => { lines.push({ level, message }); });
    t.after(() => configureLogging({ level: 'info' }));
    return lines;
}

test('UTC timestamps, visible levels, components, and filtering apply to existing loggers', t => {
    const lines = capture(t), logger = createLogger('startup');
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-05T20:48:20.123Z') });
    logger.debug('Hidden by default');
    logger.info('Ready');
    logger.warn('Retrying');
    logger.error('Failed');
    assert.deepEqual(lines, [
        { level: 'info', message: '2026-10-05T20:48:20.123Z INFO [startup] Ready' },
        { level: 'warn', message: '2026-10-05T20:48:20.123Z WARN [startup] Retrying' },
        { level: 'error', message: '2026-10-05T20:48:20.123Z ERROR [startup] Failed' },
    ]);
    for (const [index, level] of LOG_LEVELS.entries()) {
        configureLogging({ level }); lines.length = 0;
        for (const candidate of LOG_LEVELS) logger[candidate]('Message');
        assert.deepEqual(lines.map(line => line.level), LOG_LEVELS.slice(index));
    }
});

test('configured credentials, authorization headers, and URL credentials are redacted; messages stay on one line', t => {
    const lines = capture(t), logger = createLogger('rpc');
    const password = 'rpc-secret-123456', token = 'admin', encoded = Buffer.from('rpc-user:' + password).toString('base64');
    configureLogging({ level: 'debug', secrets: [password, token, encoded] });
    logger.debug(`password=${password}; token=${token}; Authorization: Bearer unknown-token; Basic ${encoded}; https://other:credential@node/\nFORGED ERROR\r\u001b[31m`);
    const output = lines[0].message;
    for (const value of [password, token, encoded, 'unknown-token', 'other:credential']) assert.equal(output.includes(value), false);
    assert.match(output, /password=\[redacted\]; token=\[redacted\]/);
    assert.equal(/[\r\n\u001b]/.test(output), false);
    configureLogging({ level: 'debug', secrets: ['a'] });
    logger.debug('Calling getblockchaininfo; token=a');
    assert.match(lines[1].message, /Calling getblockchaininfo; token=\[redacted\]$/);
});

test('recurring failures emit a first warning, minute reminders, and one recovery without noisy successes', t => {
    const lines = capture(t), reporter = createFailureReporter(createLogger('peers'));
    let now = 0; t.mock.method(performance, 'now', () => now);
    reporter.recovered('Recovered'); assert.equal(lines.length, 0);
    reporter.failure('Unavailable'); reporter.failure('Still unavailable');
    now = 59_999; reporter.failure('Still unavailable');
    assert.equal(lines.length, 1);
    now = 60_000; reporter.failure('Still unavailable');
    assert.match(lines[1].message, /WARN \[peers\] Still unavailable \(4 consecutive failures\)$/);
    reporter.recovered('Recovered'); reporter.recovered('Recovered');
    assert.equal(lines.length, 3);
    assert.match(lines[2].message, /INFO \[peers\] Recovered \(after 4 failed attempts\)$/);
    reporter.failure('New outage', 'error');
    assert.equal(lines[3].level, 'error');
});

test('debug logging exposes suppressed retry details while maintaining warning reminders', t => {
    const lines = capture(t);
    configureLogging({ level: 'debug' });
    const reporter = createFailureReporter(createLogger('node'));
    t.mock.method(performance, 'now', () => 0);
    reporter.failure('First failure'); reporter.failure('Retry detail');
    assert.deepEqual(lines.map(line => line.level), ['warn', 'debug']);
    assert.match(lines[1].message, /DEBUG \[node\] Retry detail$/);
});

test('startup configuration errors are formatted before runtime creation, even with an invalid log level', () => {
    for (const overrides of [{ BITCOIN_RPC_PORT: '0' }, { BPM_LOG_LEVEL: 'invalid' }]) {
        const result = spawnSync(process.execPath, ['src/server/main.ts'], {
            cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 5000,
            env: {
                PATH: process.env.PATH,
                BITCOIN_RPC_HOST: '127.0.0.1', BITCOIN_RPC_USER: 'fixture', BITCOIN_RPC_PASSWORD: 'secret-not-in-logs',
                BPM_ADMIN_TOKEN: 'admin', BPM_LOG_LEVEL: 'error', ...overrides,
            },
        });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z ERROR \[startup\] Bitcoin Peer Map: startup failed: /m);
        assert.equal(result.stderr.includes('secret-not-in-logs'), false);
        assert.equal(result.stdout, '');
    }
});

test('startup redacts viewing secrets before and after loading direct or mounted credentials', t => {
    const directory = temporaryDirectory(t);
    const token = 'viewer-startup-log-secret';
    const dataDir = join(directory, token);
    mkdirSync(dataDir);
    writeFileSync(join(dataDir, 'settings.json'), JSON.stringify({ geoip_db_only: 'invalid' }));
    const tokenFile = join(directory, 'view-token');
    writeFileSync(tokenFile, token + '\n', { mode: 0o600 });
    const cases = [
        { BPM_VIEW_TOKEN: token, BITCOIN_RPC_PASSWORD: '', BITCOIN_RPC_PASSWORD_FILE: join(directory, token, 'missing-password') },
        { BPM_VIEW_TOKEN: token, BPM_DATA_DIR: dataDir },
        { BPM_VIEW_TOKEN_FILE: tokenFile, BPM_DATA_DIR: dataDir },
    ];
    for (const overrides of cases) {
        const result = spawnSync(process.execPath, ['src/server/main.ts'], {
            cwd: new URL('../../', import.meta.url), encoding: 'utf8', timeout: 5000,
            env: { PATH: process.env.PATH, BITCOIN_RPC_HOST: '127.0.0.1', BITCOIN_RPC_USER: 'fixture',
                BITCOIN_RPC_PASSWORD: 'rpc-log-secret', ...overrides },
        });
        assert.equal(result.status, 1);
        assert.match(result.stderr, /ERROR \[startup\].*startup failed:/);
        assert.match(result.stderr, /\[redacted\]/);
        assert.equal(result.stderr.includes(token), false);
        assert.equal(result.stderr.includes('rpc-log-secret'), false);
        assert.equal(result.stdout, '');
    }
});
