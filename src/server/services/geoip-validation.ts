import { isIP } from 'node:net';
import { type Data, object } from '../types.ts';
import { GEO_COLUMNS } from './geoip-schema.ts';

export function isValidGeoData(data: unknown): data is Data {
    if (!object(data) || typeof data.country !== 'string' || !data.country.trim()) return false;
    if (![data.lat, data.lon].every(value => typeof value === 'number' || (typeof value === 'string' && value.trim().length > 0))) return false;
    const lat = Number(data.lat), lon = Number(data.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

// Older datasets permit nullable metadata, but only usable locations may replace local records.
export function normalizeDatasetRow(row: Data): Data | null {
    if (typeof row.ip !== 'string' || !isIP(row.ip.trim()) || !isValidGeoData(row)) return null;
    const normalized: Data = { ip: row.ip.trim(), lat: Number(row.lat), lon: Number(row.lon) };
    for (const key of GEO_COLUMNS) {
        if (['ip', 'lat', 'lon'].includes(key)) continue;
        const value = row[key];
        if (['mobile', 'proxy', 'hosting'].includes(key)) {
            if (value !== null && value !== 0 && value !== 1) return null;
            normalized[key] = value;
        } else if (key === 'last_updated' || key === 'utc_offset') {
            if (value !== null && (typeof value !== 'number' || !Number.isSafeInteger(value) || (key === 'last_updated' && value < 0))) return null;
            normalized[key] = value;
        } else {
            if (value !== null && typeof value !== 'string') return null;
            normalized[key] = value;
        }
    }
    normalized.country = (normalized.country as string).trim();
    return normalized;
}
