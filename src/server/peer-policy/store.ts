import { mkdirSync, lstatSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpError } from '../http.ts';
import { object } from '../types.ts';
import { DEFAULT_POLICY_CONFIG, type PolicyConfig, type PolicyDocument, type PolicyState, type PolicyEvent, type PolicyAttempt } from './types.ts';
import { normalizePolicyAddress } from './observer.ts';

const MAX_BYTES = 1024 * 1024;
const nonnegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const time = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value);
const keys = (value: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const invalid = () => new HttpError(422, 'Invalid inbound peer policy settings.', 'peer_policy_invalid');
const unavailable = () => new HttpError(503, 'Inbound peer policy state is unavailable. Check its saved data and file permissions.', 'peer_policy_unavailable');

export function parsePolicyConfig(payload: unknown): PolicyConfig {
    if (!object(payload) || !keys(payload, ['mode', 'listener_allowance', 'keep_addresses']) || !['off', 'preview', 'automatic'].includes(payload.mode as string)
        || !nonnegativeInteger(payload.listener_allowance) || payload.listener_allowance > 20
        || !Array.isArray(payload.keep_addresses) || payload.keep_addresses.length > 128) throw invalid();
    const keep: string[] = [];
    for (const value of payload.keep_addresses) {
        if (typeof value !== 'string') throw invalid();
        const normalized = normalizePolicyAddress(value);
        if (normalized === null) throw invalid();
        keep.push(normalized);
    }
    return { mode: payload.mode as PolicyConfig['mode'], listener_allowance: payload.listener_allowance, keep_addresses: [...new Set(keep)].sort() };
}
function validAddress(value: unknown): value is string { return text(value, 512) && normalizePolicyAddress(value) !== null; }
function parseState(payload: unknown): PolicyState {
    if (!object(payload) || !keys(payload, ['attempts', 'events', 'last_wall_time'], ['failure_guard']) || !time(payload.last_wall_time)
        || !Array.isArray(payload.attempts) || payload.attempts.length > 2000 || !Array.isArray(payload.events) || payload.events.length > 200) throw unavailable();
    const attempts: PolicyAttempt[] = [];
    const ids = new Set<string>();
    for (const item of payload.attempts) {
        if (!object(item) || !keys(item, ['id', 'time', 'peer_id', 'address', 'identity', 'outcome'], ['departure_observed', 'return_observed'])
            || !text(item.id, 128) || ids.has(item.id) || !time(item.time) || !nonnegativeInteger(item.peer_id)
            || !validAddress(item.address) || !text(item.identity, 2048) || !['requested', 'succeeded', 'failed', 'uncertain'].includes(item.outcome as string)
            || (item.departure_observed !== undefined && typeof item.departure_observed !== 'boolean')
            || (item.return_observed !== undefined && (typeof item.return_observed !== 'boolean' || (item.return_observed && item.departure_observed !== true)))) throw unavailable();
        ids.add(item.id);
        attempts.push({ id: item.id, time: item.time, peer_id: item.peer_id, address: normalizePolicyAddress(item.address)!, identity: item.identity,
            outcome: item.outcome as PolicyAttempt['outcome'], ...(item.departure_observed === undefined ? {} : { departure_observed: item.departure_observed }),
            ...(item.return_observed === undefined ? {} : { return_observed: item.return_observed }) });
    }
    const events: PolicyEvent[] = [];
    for (const item of payload.events) {
        if (!object(item) || !keys(item, ['id', 'time', 'peer_id', 'address', 'kind', 'reason']) || !text(item.id, 128) || !time(item.time)
            || (item.peer_id !== null && !nonnegativeInteger(item.peer_id)) || (item.address !== null && !validAddress(item.address))
            || !['would_disconnect', 'requested', 'succeeded', 'failed', 'uncertain', 'departure_observed', 'same_host_return', 'paused', 'skipped'].includes(item.kind as string)
            || !text(item.reason, 512)) throw unavailable();
        events.push({ id: item.id, time: item.time, peer_id: item.peer_id, address: item.address === null ? null : normalizePolicyAddress(item.address)!, kind: item.kind as PolicyEvent['kind'], reason: item.reason });
    }
    let guard: PolicyState['failure_guard'];
    if (payload.failure_guard !== undefined) {
        const value = payload.failure_guard;
        if (!object(value) || !keys(value, ['consecutive_failures', 'paused', 'reason'])
            || !nonnegativeInteger(value.consecutive_failures) || value.consecutive_failures > 3 || typeof value.paused !== 'boolean'
            || (value.reason !== null && !text(value.reason, 512)) || (value.paused ? value.reason === null : value.reason !== null)) throw unavailable();
        guard = { consecutive_failures: value.consecutive_failures, paused: value.paused, reason: value.reason };
    }
    return { attempts, events, last_wall_time: payload.last_wall_time, ...(guard ? { failure_guard: guard } : {}) };
}
function initial(scope: string): PolicyDocument {
    return { version: 1, scope, revision: 0, config: structuredClone(DEFAULT_POLICY_CONFIG), state: { attempts: [], events: [], last_wall_time: 0 } };
}

/** Config and reserved action budgets share one atomic owner-only document. */
export class PeerPolicyStore {
    readonly path: string;
    readonly scope: string;
    private value: PolicyDocument;
    private failed = false;
    private scopeMismatch = false;
    constructor(dataDir: string, scope: string) {
        this.path = join(dataDir, 'peer-policy.json'); this.scope = scope; this.value = initial(scope);
        if (!text(scope, 512)) { this.failed = true; return; }
        try {
            const stat = lstatSync(this.path);
            if (!stat.isFile() || stat.size > MAX_BYTES || (stat.mode & 0o077) !== 0) throw unavailable();
            const data: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
            if (!object(data) || !keys(data, ['version', 'scope', 'revision', 'config', 'state']) || data.version !== 1 || !text(data.scope, 512)
                || !nonnegativeInteger(data.revision)) throw unavailable();
            const config = parsePolicyConfig(data.config), state = parseState(data.state);
            if (data.scope === scope) this.value = { version: 1, scope, revision: data.revision, config, state };
            else this.scopeMismatch = true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.failed = true;
        }
    }
    snapshot(): PolicyDocument {
        if (this.failed) throw unavailable();
        return structuredClone(this.value);
    }
    configure(config: PolicyConfig, expectedRevision: number, state?: PolicyState): void {
        if (this.failed) throw unavailable();
        if (!nonnegativeInteger(expectedRevision) || expectedRevision !== this.value.revision) throw new HttpError(409, 'Inbound peer policy changed. Reload its settings before saving.', 'peer_policy_conflict');
        const validated = parsePolicyConfig(config);
        if (this.value.revision >= Number.MAX_SAFE_INTEGER) { this.failed = true; throw unavailable(); }
        this.write({ ...this.value, revision: this.value.revision + 1, config: validated, ...(state ? { state: parseState(state) } : {}) });
        this.scopeMismatch = false;
    }
    updateState(state: PolicyState): void {
        if (this.failed || this.scopeMismatch) throw unavailable();
        let validated: PolicyState;
        try { validated = parseState(state); }
        catch { this.failed = true; throw unavailable(); }
        this.write({ ...this.value, state: validated });
    }
    private write(document: PolicyDocument): void {
        const serialized = JSON.stringify(document, null, 2) + '\n';
        if (Buffer.byteLength(serialized) > MAX_BYTES) { this.failed = true; throw unavailable(); }
        const temporary = join(dirname(this.path), `.peer-policy-${randomUUID()}.json`);
        try {
            mkdirSync(dirname(this.path), { recursive: true });
            const descriptor = openSync(temporary, 'wx', 0o600);
            try { writeFileSync(descriptor, serialized); fsyncSync(descriptor); }
            finally { closeSync(descriptor); }
            renameSync(temporary, this.path);
            const directory = openSync(dirname(this.path), 'r');
            try { fsyncSync(directory); } finally { closeSync(directory); }
        } catch { this.failed = true; throw unavailable(); }
        finally { try { rmSync(temporary, { force: true }); } catch { /* Preserve the original failure. */ } }
        this.value = structuredClone(document);
    }
}
