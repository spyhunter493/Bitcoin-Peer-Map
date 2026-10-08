import { mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { object } from './types.ts';
import { ConfigurationError } from './settings.ts';

export interface OutboundPreferences {
    optional_outbound: boolean;
    geoip_dataset_downloads: boolean;
    release_checks: boolean;
    reachability_checks: boolean;
}
export type OutboundPreference = keyof OutboundPreferences;
export interface Preferences extends OutboundPreferences { geoip_auto_update: boolean; geoip_db_only: boolean }
export const DEFAULT_PREFERENCES: Readonly<Preferences> = Object.freeze({ geoip_auto_update: true, geoip_db_only: true,
    optional_outbound: false, geoip_dataset_downloads: true, release_checks: true, reachability_checks: true });
export class PreferenceStore {
    readonly path: string;
    private defaults: Preferences;
    constructor(path: string, optionalOutbound = false) { this.path = path; this.defaults = { ...DEFAULT_PREFERENCES, optional_outbound: optionalOutbound }; }
    load(): Preferences {
        const defaults = this.defaults;
        const invalid = (reason: string) => new ConfigurationError(`Cannot load saved settings at ${this.path}: ${reason}. Repair the file as a JSON object with boolean preferences, preserving your privacy choices, then restart. The file has not been changed.`);
        let raw: string;
        try { raw = readFileSync(this.path, 'utf8'); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...defaults };
            throw invalid('file is not readable');
        }
        let data: unknown;
        try { data = JSON.parse(raw); } catch { throw invalid('malformed JSON'); }
        if (!object(data)) throw invalid('expected a JSON object');
        for (const key of Object.keys(defaults)) {
            if (Object.hasOwn(data, key) && typeof data[key] !== 'boolean') throw invalid(`${key} must be a boolean`);
        }
        return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, data[key] ?? value])) as unknown as Preferences;
    }
    save(preferences: Preferences) {
        mkdirSync(dirname(this.path), { recursive: true });
        const temporary = join(dirname(this.path), `.settings-${randomUUID()}.json`);
        try {
            const fd = openSync(temporary, 'wx', 0o600);
            try { writeFileSync(fd, JSON.stringify(preferences, null, 2) + '\n'); fsyncSync(fd); }
            finally { closeSync(fd); }
            renameSync(temporary, this.path);
        } finally { rmSync(temporary, { force: true }); }
    }
}
