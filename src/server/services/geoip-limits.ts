import type { Data } from '../types.ts';
import type { DatabaseSync } from 'node:sqlite';

export const MAX_GEOIP_RESPONSE_BYTES = 65_536;
export const MAX_GEOIP_STRING_BYTES = 4_096;
// A valid UTF-8 string may occupy twice as many bytes in a UTF-16 SQLite file.
const MAX_SQL_VALUE_BYTES = MAX_GEOIP_STRING_BYTES * 2;

/** Check before trimming or converting untrusted string values. */
export function hasOversizedGeoStrings(data: Data) {
    return Object.values(data).some(value => typeof value === 'string' && Buffer.byteLength(value, 'utf8') > MAX_GEOIP_STRING_BYTES);
}

/** Only application-owned SQL identifiers are passed to this expression. */
export function geoSqlStringSizePredicate(column: string) {
    return `(CASE WHEN COALESCE(length(CAST(${column} AS BLOB)), 0) > ${MAX_SQL_VALUE_BYTES}
        THEN 0 ELSE bpm_geoip_string_bytes(${column}) <= ${MAX_GEOIP_STRING_BYTES} END)`;
}

export function registerGeoipSqlLimits(database: DatabaseSync) {
    // CASE rejects giant values natively before this callback can see them.
    // Exact UTF-8 counting also handles UTF-16 databases and embedded NULs.
    database.function('bpm_geoip_string_bytes', { deterministic: true, directOnly: true, useBigIntArguments: true }, (value: unknown) => {
        if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
        return value instanceof Uint8Array ? value.byteLength : 0;
    });
}
