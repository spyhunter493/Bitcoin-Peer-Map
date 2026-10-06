import { mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { object } from './types.ts';
import { ConfigurationError } from './settings.ts';

export interface Preferences { geoip_auto_update: boolean; geoip_db_only: boolean }
export class PreferenceStore {
    readonly path: string;
    constructor(path: string) { this.path = path; }
    load(): Preferences {
        const defaults = { geoip_auto_update: true, geoip_db_only: false };
        const invalid = (reason: string) => new ConfigurationError(`Cannot load saved settings at ${this.path}: ${reason}. Repair the file as a JSON object with boolean geoip_auto_update and geoip_db_only preferences, preserving your privacy choices, then restart. The file has not been changed.`);
        let raw: string;
        try { raw = readFileSync(this.path, 'utf8'); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaults;
            throw invalid('file is not readable');
        }
        let data: unknown;
        try { data = JSON.parse(raw); } catch { throw invalid('malformed JSON'); }
        if (!object(data)) throw invalid('expected a JSON object');
        for (const key of Object.keys(defaults)) {
            if (Object.hasOwn(data, key) && typeof data[key] !== 'boolean') throw invalid(`${key} must be a boolean`);
        }
        return {
            geoip_auto_update: data.geoip_auto_update as boolean ?? defaults.geoip_auto_update,
            geoip_db_only: data.geoip_db_only as boolean ?? defaults.geoip_db_only,
        };
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
