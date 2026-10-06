export const GEO_COLUMNS = ['ip', 'continent', 'continentCode', 'country', 'countryCode', 'region', 'regionName', 'city', 'district', 'zip', 'lat', 'lon', 'timezone', 'utc_offset', 'currency', 'isp', 'org', 'as_info', 'asname', 'mobile', 'proxy', 'hosting', 'last_updated'];
export const GEO_SCHEMA = `CREATE TABLE IF NOT EXISTS geo_cache (
    ip TEXT PRIMARY KEY, continent TEXT, continentCode TEXT, country TEXT, countryCode TEXT,
    region TEXT, regionName TEXT, city TEXT, district TEXT, zip TEXT, lat REAL, lon REAL,
    timezone TEXT, utc_offset INTEGER, currency TEXT, isp TEXT, org TEXT, as_info TEXT,
    asname TEXT, mobile INTEGER DEFAULT 0, proxy INTEGER DEFAULT 0, hosting INTEGER DEFAULT 0,
    last_updated INTEGER
);
CREATE INDEX IF NOT EXISTS idx_geo_country ON geo_cache(countryCode);
CREATE INDEX IF NOT EXISTS idx_geo_updated ON geo_cache(last_updated);
PRAGMA journal_mode=WAL;
PRAGMA trusted_schema=OFF;`;
export const GEO_UPDATES = GEO_COLUMNS.filter(column => column !== 'ip').map(column => `${column}=excluded.${column}`).join(',');
// Local provenance stays separate from the downloaded dataset's fixed schema.
export const GEO_PROVENANCE_SCHEMA = `CREATE TABLE IF NOT EXISTS geo_provenance (
    ip TEXT PRIMARY KEY, source TEXT NOT NULL CHECK (source IN ('dataset', 'ip_api')),
    observed_at INTEGER
);`;
export const GEO_RECORD_QUERY = `SELECT g.*, COALESCE(p.source, 'unknown') AS geo_source
    FROM geo_cache g LEFT JOIN geo_provenance p
    ON p.ip = g.ip AND p.observed_at IS g.last_updated WHERE g.ip = ?`;
export const GEO_PROVENANCE_WRITE = `INSERT INTO geo_provenance (ip, source, observed_at) VALUES (?, ?, ?)
    ON CONFLICT(ip) DO UPDATE SET source = excluded.source, observed_at = excluded.observed_at`;
