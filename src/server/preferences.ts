import { mkdirSync, readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { object } from './types.ts';

export interface Preferences { geoip_auto_update: boolean; geoip_db_only: boolean }
export class PreferenceStore {
    readonly path: string;
    constructor(path: string) { this.path = path; }
    load(): Preferences {
        let data: unknown;
        try { data = JSON.parse(readFileSync(this.path, 'utf8')); } catch { data = {}; }
        if (!object(data)) data = {};
        const values = data as Record<string, unknown>;
        return {
            geoip_auto_update: typeof values.geoip_auto_update === 'boolean' ? values.geoip_auto_update : true,
            geoip_db_only: typeof values.geoip_db_only === 'boolean' ? values.geoip_db_only : false,
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
