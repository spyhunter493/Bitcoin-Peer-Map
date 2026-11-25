import { lstatSync, readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpError } from './http.ts';
import { object } from './types.ts';
import { normalizePolicyAddress } from './peer-policy/observer.ts';

export type NetworkName = 'ipv4' | 'ipv6' | 'onion' | 'i2p' | 'cjdns';
export type FilterKind = 'network' | 'provider' | 'country' | 'software' | 'services' | 'conntype' | 'direction' | 'hosting' | 'others' | 'insight';
export type ViewFilter = { kind: 'all'; filters: ViewFilter[] } | { kind: FilterKind; key: string };
export interface PeerViewState {
    query: string; networks: NetworkName[]; filter: ViewFilter | null; private_mode: boolean; columns: string[];
    sort: { key: string | null; direction: 'ascending' | 'descending' | null };
}
export interface PolicyViewState { query: string; status: '' | 'candidate' | 'protected' | 'observing' | 'unknown'; network: string; page_size: 0 | 10 | 20 | 30 | 40 | 50 }
export type SavedView = { id: string; name: string; kind: 'peers'; state: PeerViewState } | { id: string; name: string; kind: 'policy'; state: PolicyViewState };
export interface SavedViewsResponse { revision: number; views: SavedView[] }
export interface KeepAnnotation { address: string; label: string; note: string }
export interface AnnotationsResponse { revision: number; annotations: KeepAnnotation[] }
const networks = ['ipv4', 'ipv6', 'onion', 'i2p', 'cjdns'];
const filterKinds = ['network', 'provider', 'country', 'software', 'services', 'conntype', 'direction', 'hosting', 'others', 'insight'];
const MAX_BYTES = 256 * 1024;
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(v);
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const revision = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const invalid = () => new HttpError(422, 'Invalid saved view or annotation.', 'operator_metadata_invalid');

export function parseViewFilter(value: unknown, depth = 0): ViewFilter {
    if (!object(value) || depth > 4) throw invalid();
    if (value.kind === 'all') {
        if (!exact(value, ['kind', 'filters']) || !Array.isArray(value.filters) || !value.filters.length || value.filters.length > 16) throw invalid();
        return { kind: 'all', filters: value.filters.map(v => parseViewFilter(v, depth + 1)) };
    }
    if (!exact(value, ['kind', 'key']) || typeof value.kind !== 'string' || !filterKinds.includes(value.kind) || !text(value.key, 256)) throw invalid();
    return { kind: value.kind as FilterKind, key: value.key };
}
export function parseViewState(kind: 'peers', value: unknown): PeerViewState;
export function parseViewState(kind: 'policy', value: unknown): PolicyViewState;
export function parseViewState(kind: 'peers' | 'policy', value: unknown): PeerViewState | PolicyViewState {
    if (!object(value) || !text(value.query, 512)) throw invalid();
    if (kind === 'policy') {
        if (!exact(value, ['query', 'status', 'network', 'page_size']) || !['', 'candidate', 'protected', 'observing', 'unknown'].includes(value.status as string)
            || typeof value.network !== 'string' || !['', ...networks].includes(value.network) || ![0, 10, 20, 30, 40, 50].includes(value.page_size as number)) throw invalid();
        return { query: value.query, status: value.status as PolicyViewState['status'], network: value.network, page_size: value.page_size as PolicyViewState['page_size'] };
    }
    if (!exact(value, ['query', 'networks', 'filter', 'private_mode', 'columns', 'sort']) || !Array.isArray(value.networks) || value.networks.length > 5
        || !value.networks.every(v => typeof v === 'string' && networks.includes(v)) || new Set(value.networks).size !== value.networks.length
        || typeof value.private_mode !== 'boolean' || !Array.isArray(value.columns) || !value.columns.length || value.columns.length > 64
        || !value.columns.every(v => typeof v === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(v)) || new Set(value.columns).size !== value.columns.length
        || !object(value.sort) || !exact(value.sort, ['key', 'direction']) || (value.sort.key !== null && (typeof value.sort.key !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(value.sort.key)))
        || ![null, 'ascending', 'descending'].includes(value.sort.direction as string | null) || ((value.sort.key === null) !== (value.sort.direction === null))) throw invalid();
    return { query: value.query, networks: [...value.networks] as NetworkName[], filter: value.filter === null ? null : parseViewFilter(value.filter), private_mode: value.private_mode,
        columns: [...value.columns] as string[], sort: { key: value.sort.key as string | null, direction: value.sort.direction as PeerViewState['sort']['direction'] } };
}
function parseView(value: unknown): SavedView {
    if (!object(value) || !exact(value, ['id', 'name', 'kind', 'state']) || !text(value.id, 80) || !value.id || !text(value.name, 80) || !value.name.trim()) throw invalid();
    const base = { id: value.id, name: value.name.trim() };
    if (value.kind === 'peers') return { ...base, kind: 'peers', state: parseViewState('peers', value.state) };
    if (value.kind === 'policy') return { ...base, kind: 'policy', state: parseViewState('policy', value.state) };
    throw invalid();
}
function parseAnnotations(value: unknown): KeepAnnotation[] {
    if (!Array.isArray(value) || value.length > 128) throw invalid();
    const addresses = new Set<string>();
    return value.map(item => {
        if (!object(item) || !exact(item, ['address', 'label', 'note']) || typeof item.address !== 'string' || !text(item.label, 80) || !text(item.note, 512)) throw invalid();
        const address = normalizePolicyAddress(item.address);
        if (!address || addresses.has(address)) throw invalid();
        addresses.add(address);
        return { address, label: item.label.trim(), note: item.note.trim() };
    });
}
function parseViews(value: unknown): SavedView[] {
    if (!Array.isArray(value) || value.length > 50) throw invalid();
    const views = value.map(parseView);
    if (new Set(views.map(v => v.id)).size !== views.length || new Set(views.map(v => `${v.kind}:${v.name.toLocaleLowerCase()}`)).size !== views.length) throw invalid();
    return views;
}

/** Small operator metadata is deliberately independent of policy authority. */
class AtomicStore<T> {
    readonly path: string;
    readonly scope: string;
    private parse: (value: unknown) => T;
    private value: T;
    private revision = 0;
    private failed = false;
    constructor(path: string, scope: string, empty: T, parse: (value: unknown) => T) {
        this.path = path; this.scope = scope; this.parse = parse;
        this.value = empty;
        try {
            const stat = lstatSync(path);
            if (!stat.isFile() || stat.size > MAX_BYTES || (stat.mode & 0o077) !== 0) throw invalid();
            const data: unknown = JSON.parse(readFileSync(path, 'utf8'));
            if (!object(data) || !exact(data, ['version', 'scope', 'revision', 'value']) || data.version !== 1 || typeof data.scope !== 'string' || !revision(data.revision)) throw invalid();
            const parsed = parse(data.value);
            if (data.scope === scope) { this.value = parsed; this.revision = data.revision; }
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.failed = true; }
    }
    private unavailable() { return new HttpError(503, 'Operator metadata is unavailable. Check its saved file and permissions.', 'operator_metadata_unavailable'); }
    read(): { revision: number; value: T } {
        if (this.failed) throw this.unavailable();
        return { revision: this.revision, value: structuredClone(this.value) };
    }
    write(value: T, expected: unknown) {
        if (this.failed || this.revision >= Number.MAX_SAFE_INTEGER) throw this.unavailable();
        if (!revision(expected)) throw invalid();
        if (expected !== this.revision) throw new HttpError(409, 'Saved data changed in another browser. Reload before saving again.', 'operator_metadata_conflict');
        const validated = this.parse(value), next = this.revision + 1;
        const body = JSON.stringify({ version: 1, scope: this.scope, revision: next, value: validated }) + '\n';
        if (Buffer.byteLength(body) > MAX_BYTES) throw invalid();
        const temporary = join(dirname(this.path), `.operator-metadata-${randomUUID()}.json`);
        try {
            mkdirSync(dirname(this.path), { recursive: true });
            const fd = openSync(temporary, 'wx', 0o600);
            try { writeFileSync(fd, body); fsyncSync(fd); } finally { closeSync(fd); }
            renameSync(temporary, this.path);
            const directory = openSync(dirname(this.path), 'r');
            try { fsyncSync(directory); } finally { closeSync(directory); }
        } catch { throw this.unavailable(); }
        finally { try { rmSync(temporary, { force: true }); } catch { /* The original file remains authoritative. */ } }
        this.value = validated; this.revision = next;
    }
}
export class OperatorMetadataService {
    private annotationStore: AtomicStore<KeepAnnotation[]>;
    private viewStore: AtomicStore<SavedView[]>;
    constructor(dataDir: string, scope: string) {
        this.annotationStore = new AtomicStore(join(dataDir, 'keep-annotations.json'), scope, [], parseAnnotations);
        this.viewStore = new AtomicStore(join(dataDir, 'saved-views.json'), scope, [], parseViews);
    }
    annotations(): AnnotationsResponse { const data = this.annotationStore.read(); return { revision: data.revision, annotations: data.value }; }
    savedViews(): SavedViewsResponse { const data = this.viewStore.read(); return { revision: data.revision, views: data.value }; }
    setAnnotations(payload: unknown, acceptedKeeps?: readonly string[]): AnnotationsResponse {
        if (!object(payload) || !exact(payload, ['expected_revision', 'address', 'label', 'note'])) throw invalid();
        const [annotation] = parseAnnotations([{ address: payload.address, label: payload.label, note: payload.note }]);
        const allowed = acceptedKeeps ? new Set(acceptedKeeps) : null;
        if (allowed && !allowed.has(annotation.address)) throw new HttpError(409, 'This address is no longer a Keep exception. Refresh the policy before editing its note.', 'annotation_keep_changed');
        const next = this.annotations().annotations.filter(v => v.address !== annotation.address && (!allowed || allowed.has(v.address)));
        if (annotation.label || annotation.note) next.push(annotation);
        this.annotationStore.write(next, payload.expected_revision);
        return this.annotations();
    }
    setSavedViews(payload: unknown): SavedViewsResponse {
        if (!object(payload) || !['create', 'update', 'rename', 'delete'].includes(payload.operation as string)) throw invalid();
        const operation = payload.operation as string;
        const fields = operation === 'create' ? ['expected_revision', 'operation', 'name', 'kind', 'state'] : operation === 'update' ? ['expected_revision', 'operation', 'id', 'state'] : operation === 'rename' ? ['expected_revision', 'operation', 'id', 'name'] : ['expected_revision', 'operation', 'id'];
        if (!exact(payload, fields)) throw invalid();
        let next = this.savedViews().views;
        if (operation === 'create') next.push(parseView({ id: randomUUID(), name: payload.name, kind: payload.kind, state: payload.state }));
        else {
            const current = next.find(v => v.id === payload.id);
            if (!current) throw new HttpError(404, 'Saved view no longer exists.', 'saved_view_missing');
            if (operation === 'delete') next = next.filter(v => v.id !== current.id);
            else if (operation === 'rename') next = next.map(v => v.id === current.id ? parseView({ ...v, name: payload.name }) : v);
            else next = next.map(v => v.id === current.id ? parseView({ ...v, state: payload.state }) : v);
        }
        this.viewStore.write(next, payload.expected_revision);
        return this.savedViews();
    }
}
