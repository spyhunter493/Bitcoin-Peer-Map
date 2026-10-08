import { isPublicAddress } from '../network.ts';
import { object, type Data } from '../types.ts';
import type { OutboundPolicy } from '../outbound-policy.ts';
import { isValidGeoData } from './geoip-validation.ts';
import type { ConnectivityService } from './connectivity.ts';

const fields = 'status,message,continent,continentCode,country,countryCode,region,regionName,city,district,zip,lat,lon,timezone,offset,currency,isp,org,as,asname,mobile,proxy,hosting';

/** The existing free HTTP provider is used only after explicit privacy opt-ins. */
export function createGeoipLookup(connectivity: ConnectivityService, outbound: OutboundPolicy, fetcher = fetch) {
    return async (host: string, ownedSignal: AbortSignal): Promise<Data | null> => {
        if (!outbound.allowed('geoip') || !connectivity.providerReady('geoip') || !isPublicAddress(host.includes(':') ? 'ipv6' : 'ipv4', host)) return null;
        const lifetime = AbortSignal.any([ownedSignal, outbound.signal('geoip')]);
        const signal = AbortSignal.any([lifetime, AbortSignal.timeout(10_000)]);
        let response: Response | undefined;
        try {
            signal.throwIfAborted();
            response = await fetcher(`http://ip-api.com/json/${encodeURIComponent(host)}?fields=${fields}`, { signal, redirect: 'manual' });
            signal.throwIfAborted();
            if (!response.ok) { await response.body?.cancel(); throw new Error(`GeoIP HTTP ${response.status}`); }
            const data: unknown = await response.json();
            signal.throwIfAborted();
            if (object(data) && data.status === 'fail' && (data.message === undefined || typeof data.message === 'string')) {
                connectivity.providerSuccess('geoip', response);
                return null;
            }
            if (!object(data) || data.status !== 'success' || !isValidGeoData(data)) throw new Error('GeoIP response did not include valid geolocation data');
            connectivity.providerSuccess('geoip', response);
            return data;
        } catch {
            if (!lifetime.aborted) {
                const message = response && !response.ok ? `GeoIP HTTP ${response.status}` : 'GeoIP request failed or returned invalid data';
                connectivity.providerFailure('geoip', new Error(message), response);
            }
            return null;
        } finally {
            if (response && !response.bodyUsed) await response.body?.cancel().catch(() => {});
        }
    };
}
