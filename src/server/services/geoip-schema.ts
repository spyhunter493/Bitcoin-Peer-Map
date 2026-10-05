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
