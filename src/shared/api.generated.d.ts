// Generated from src/server/openapi.json. Run npm run generate:api; do not edit.
export interface paths {
    "/api/peers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Peers */
        get: operations["list_peers_api_peers_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/peer/connect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Connect Peer */
        post: operations["connect_peer_api_peer_connect_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/peer/disconnect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Disconnect Peer */
        post: operations["disconnect_peer_api_peer_disconnect_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/peer/ban": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Ban Peer */
        post: operations["ban_peer_api_peer_ban_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/peer/unban": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Unban Peer */
        post: operations["unban_peer_api_peer_unban_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/bans": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Bans */
        get: operations["list_bans_api_bans_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/bans/clear": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Clear Bans */
        post: operations["clear_bans_api_bans_clear_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/info": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Dashboard Info
         * @description Includes node_metrics: Bitcoin Knots uptime, P2P totals, and average P2P rates between RPC samples. Unavailable metrics and rates without a valid baseline are null. Includes services: the P2P service names advertised by this node, from getnetworkinfo.localservicesnames. An empty array means no services are advertised; null means service information is unavailable. Includes updates: the cached application update status. Dashboard reads do not trigger GitHub requests; the server checks once every 24 hours. Updates compare stable release versions, never unreleased main commits. Development builds skip checks. Blockchain ibd is true during initial block download, false only when explicitly complete, and null when unavailable. Includes bitcoin_network: configured chain and default peer connection port. Explicit peer ports are preserved; I2P requires :0. Blockchain txindex_status distinguishes disabled, syncing, ready, and unknown; txindex_height reports the indexed height. The legacy indexed boolean indicates index presence, not readiness.
         */
        get: operations["dashboard_info_api_info_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/mempool": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Mempool */
        get: operations["mempool_api_mempool_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/blockchain": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Blockchain */
        get: operations["blockchain_api_blockchain_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/blocks/recent": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Recent Blocks */
        get: operations["recent_blocks_api_blocks_recent_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/rpc-info": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Rpc Info */
        get: operations["rpc_info_api_rpc_info_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/chain-tips": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Chain Tips
         * @description Loads tips within 15 seconds including RPC queue time. Required tips have up to 10 seconds; optional blockchain metadata has up to 5 seconds concurrently. Up to 100 header ages are enriched by 4 workers for at most 5 seconds within the overall deadline. Optional timeouts preserve valid tips with null ages. Completed partial results are shared for 5 seconds; ages and generated_at are refreshed on independent returned copies.
         */
        get: operations["chain_tips_api_chain_tips_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/connectivity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Connectivity */
        get: operations["connectivity_api_connectivity_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/connectivity/api-prompt-ack": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Acknowledge Connectivity Prompt */
        post: operations["acknowledge_connectivity_prompt_api_connectivity_api_prompt_ack_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/geodb/toggle-db-only": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Toggle Geoip Api
         * @deprecated
         * @description Retired without side effects. Reload the dashboard or use POST /api/geodb/db-only with {"enabled": boolean}. Authentication and same-origin protection still apply.
         */
        post: operations["toggle_geoip_api_api_geodb_toggle_db_only_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/geodb/toggle-auto-update": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Toggle Auto Update
         * @deprecated
         * @description Retired without side effects. Reload the dashboard or use POST /api/geodb/auto-update with {"enabled": boolean}. Authentication and same-origin protection still apply.
         */
        post: operations["toggle_auto_update_api_geodb_toggle_auto_update_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/geodb/update": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Update Database
         * @description Validates streamed IPv4/IPv6 location rows in a worker and merges valid rows transactionally using timestamp precedence. Invalid rows are skipped and cannot replace local records. If no valid rows remain, the import fails without changing local records.
         */
        post: operations["update_database_api_geodb_update_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Node Metrics
         * @description RPC-only node metrics from uptime and getnettotals, shared with /api/info.node_metrics. The legacy system_stats response key is retained; no dashboard host metrics are collected.
         */
        get: operations["stats_api_stats_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Config
         * @description Runtime configuration without credentials. build.version is the release tag or dev; build.revision is the exact source commit. build.updates contains cached release update status.
         */
        get: operations["config_api_config_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/stream/system": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Node Metrics Stream */
        get: operations["system_stream_api_stream_system_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Dashboard */
        get: operations["dashboard__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/admin/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Verify Admin Token
         * @description Verify the shared token without changing node or dashboard settings. Does not create a server session.
         */
        post: operations["verify_admin_token"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/geodb/db-only": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Set Database-only Mode
         * @description Set enabled=true to disable external peer location lookups. The dashboard API Lookup checkbox uses the inverse of this setting. Settings are persisted before changing live state.
         */
        post: operations["set_geodb_db_only"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/geodb/auto-update": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Set Automatic GeoIP Updates
         * @description Enabling schedules an immediate update. Disabling cancels future scheduling and lets an active import finish. Settings are persisted before changing live state.
         */
        post: operations["set_geodb_auto_update"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/healthz": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** HTTP liveness */
        get: operations["healthz"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        AddressRequest: {
            /**
             * @description Omitted or null becomes the empty string; other values must be strings.
             * @default
             */
            address: string | null;
        };
        PeerIdRequest: {
            /** @description Omitted or null becomes null. Numbers and nonempty strings are accepted only when Number(value) is a safe integer; numeric-string compatibility is preserved. */
            peer_id?: number | string | null;
        };
        ErrorResponse: {
            /** @description Description of the request error. */
            detail: string;
            /** @description Optional machine-readable error code, including admin_required, management_disabled, admin_rate_limited, endpoint_retired, or rpc_busy. */
            code?: string;
        };
        UpdateStatus: {
            /** @description Whether the latest published stable release has a higher semantic version than the installed release. */
            update_available: boolean;
            /** @description Latest published stable release tag; null before a check or when no release exists. */
            latest_version: string | null;
            /** @description GitHub Release notes URL for a newer stable release; null when no update is available. */
            changes_url: string | null;
            /** @description Unix timestamp in seconds of the last completed check, including failures. */
            checked_at: number | null;
            /** @description Whether the last check failed. A previously known update is retained. */
            check_failed: boolean;
        };
        ProviderHealth: {
            /** @enum {string} */
            state: "unknown" | "healthy" | "unavailable" | "rate_limited";
            consecutive_failures: number;
            last_error: string | null;
            /** @description Unix timestamp in seconds. */
            last_success_at: number | null;
            /** @description Unix timestamp in seconds. */
            last_failure_at: number | null;
            /** @description Provider requests resume at or after this Unix timestamp. Null means no cooldown. Quota headers and provider outage backoff govern attempts independently of the reachability probe. After five consecutive failures, outage backoff starts at 30 seconds and doubles to a five-minute maximum. */
            retry_at: number | null;
        };
        ConnectivityStatus: {
            /**
             * @description Independent internet reachability probe status.
             * @enum {string}
             */
            internet_state: "green" | "yellow" | "red";
            /** @description GeoIP has fewer than five consecutive failures and is outside its rate-limit cooldown. */
            api_available: boolean;
            /** @description Consecutive GeoIP failures only. */
            api_consecutive_failures: number;
            geo_db_only_mode: boolean;
            api_down_prompt: boolean;
            providers: {
                geoip: components["schemas"]["ProviderHealth"];
            };
        };
        BitcoinNetwork: {
            /** @enum {string} */
            chain: "main" | "test" | "testnet4" | "signet" | "regtest";
            /** @description Default P2P connection port for the configured chain; independent of BITCOIN_RPC_PORT. */
            default_peer_port: number;
        };
        EnabledRequest: {
            /** @description Desired state; repeating the same value is a no-op. */
            enabled: boolean;
        };
        Peer: {
            id: number;
            /** @description RPC network name, or inferred family. Known names are ipv4, ipv6, onion, i2p, cjdns; unknown RPC names are retained. */
            network: string;
            ip: string;
            /** @description Port text extracted from addr; empty string when no port is present. It is not normalized into a number. */
            port: string;
            direction: components["schemas"]["PeerDirection"];
            addr: string;
            subver: string;
            bytessent: number;
            bytesrecv: number;
            bytessent_fmt: string;
            bytesrecv_fmt: string;
            /** @description Measured ping in fractional milliseconds. Null means no valid measurement; measured zero is valid. */
            ping_ms: number | null;
            conntime: number;
            conntime_fmt: string;
            version: number;
            connection_type: string;
            connection_type_abbrev: string;
            services: string[];
            services_abbrev: string;
            in_addrman: boolean;
            location: string;
            /** @enum {string} */
            location_status: "pending" | "private" | "ok" | "unavailable";
            geo: components["schemas"]["GeoMetadata"];
            /** @description Whether this peer has a public IPv4 or IPv6 address, using the same server classification as GeoIP lookup eligibility. Private, reserved, malformed, and overlay addresses are excluded. Independent of whether location or provider data is available. */
            is_public: boolean;
            /** @description GeoIP metadata retained from the dataset/provider; consumers must check its type before rendering. */
            continent: unknown;
            /** @description GeoIP metadata retained from the dataset/provider; consumers must check its type before rendering. */
            continentCode: unknown;
            /** @description GeoIP metadata retained from the dataset/provider; consumers must check its type before rendering. */
            countryCode: unknown;
            /** @description GeoIP metadata retained from the dataset/provider; consumers must check its type before rendering. */
            region: unknown;
            /** @description GeoIP metadata retained from the dataset/provider; consumers must check its type before rendering. */
            regionName: unknown;
            /** @description GeoIP metadata retained from the dataset/provider; consumers must check its type before rendering. */
            city: unknown;
            /** @description GeoIP metadata retained from the dataset/provider; consumers must check its type before rendering. */
            district: unknown;
            /** @description GeoIP metadata retained from the dataset/provider; consumers must check its type before rendering. */
            zip: unknown;
            /** @description GeoIP metadata retained from the dataset/provider; consumers must check its type before rendering. */
            timezone: unknown;
            /** @description GeoIP metadata retained from the dataset/provider; consumers must check its type before rendering. */
            currency: unknown;
            /** @description GeoIP metadata retained from the dataset/provider; consumers must check its type before rendering. */
            isp: unknown;
            /** @description GeoIP metadata retained from the dataset/provider; consumers must check its type before rendering. */
            org: unknown;
            /** @description GeoIP metadata retained from the dataset/provider; consumers must check its type before rendering. */
            as: unknown;
            /** @description GeoIP metadata retained from the dataset/provider; consumers must check its type before rendering. */
            asname: unknown;
            country: string;
            lat: number;
            lon: number;
            /** @description Raw provider offset or database utc_offset; defaults to 0. */
            offset: unknown;
            /** @description Raw provider flag or database 0/1; defaults to false. */
            mobile: unknown;
            /** @description Raw provider flag or database 0/1; defaults to false. */
            proxy: unknown;
            /** @description Raw provider flag or database 0/1; defaults to false. */
            hosting: unknown;
            minping: number | null;
            lastsend: number | null;
            lastrecv: number | null;
            startingheight: number | null;
            synced_headers: number | null;
            synced_blocks: number | null;
            minfeefilter: number | null;
            mapped_as: number | null;
            addr_relay_enabled: boolean | null;
            relaytxes: boolean | null;
            transport_protocol_type: string;
            session_id: string;
            addrlocal: string;
            bip152_hb_from: boolean;
            bip152_hb_to: boolean;
            last_transaction: number;
            last_block: number;
            timeoffset: number;
            addr_processed: number;
            addr_rate_limited: number;
            permissions: string[];
        } & {
            [key: string]: unknown;
        };
        GeoMetadata: {
            /**
             * @description Provenance of the winning location record. Legacy records report unknown; absent locations report null.
             * @enum {string|null}
             */
            source: "dataset" | "ip_api" | "unknown" | null;
            /** @description Location observation Unix timestamp, not dataset download time. */
            observed_at: number | null;
            /** @description Seconds since observation; null for missing, zero, or future timestamps. */
            age_seconds: number | null;
            /**
             * @description Usable locations become stale at 30 days. Stale and unknown-age public locations refresh when API lookup is enabled; existing coordinates remain usable. Failed refreshes retry after one hour, and missing locations retry after one minute.
             * @enum {string}
             */
            freshness: "fresh" | "stale" | "unknown" | "unavailable";
            /** @constant */
            stale_after_seconds: 2592000;
        };
        /** @enum {string} */
        NetworkFamily: "ipv4" | "ipv6" | "onion" | "i2p" | "cjdns";
        /** @enum {string} */
        PeerDirection: "IN" | "OUT";
        PeerStatus: {
            connected: boolean | null;
            last_success_at: number | null;
            last_attempt_at: number | null;
            /** @description Snapshot age in seconds, null before the first successful read. */
            age_seconds: number | null;
            stale_after_seconds: number;
            error: string | null;
        };
        PeerSnapshot: {
            peers: components["schemas"]["Peer"][];
            status: components["schemas"]["PeerStatus"];
        };
        NodeAddress: {
            address: string;
            port: number | null;
            score: number;
        };
        NetworkDetails: {
            reachable: boolean;
            limited: boolean;
            proxy: string;
            localaddresses: components["schemas"]["NodeAddress"][];
        };
        NetworkSummary: {
            ipv4: components["schemas"]["NetworkDetails"];
            ipv6: components["schemas"]["NetworkDetails"];
            onion: components["schemas"]["NetworkDetails"];
            i2p: components["schemas"]["NetworkDetails"];
            cjdns: components["schemas"]["NetworkDetails"];
        };
        NetworkScores: {
            ipv4: number | null;
            ipv6: number | null;
        };
        NodeTraffic: {
            download_bytes: number;
            upload_bytes: number;
            download_fmt: string;
            upload_fmt: string;
        };
        NodeMetrics: {
            uptime: string | null;
            uptime_sec: number | null;
            download_bytes: number | null;
            upload_bytes: number | null;
            /** @description Received bytes/second, null before a rate baseline or when unavailable. */
            rx_bps: number | null;
            /** @description Sent bytes/second, null before a rate baseline or when unavailable. */
            tx_bps: number | null;
            ts: number;
        };
        GeoDatabaseStats: {
            /** @enum {string} */
            status: "disabled" | "closed" | "not_found" | "ok" | "error";
            entries: number;
            size_bytes: number;
            last_updated: number | null;
            oldest_updated: number | null;
            db_path: string;
            error?: string;
        };
        GeoStats: {
            /** @enum {string} */
            status: "disabled" | "closed" | "not_found" | "ok" | "error";
            entries: number;
            size_bytes: number;
            last_updated: number | null;
            oldest_updated: number | null;
            db_path: string;
            error?: string;
            auto_lookup: boolean;
            auto_update: boolean;
            db_only_mode: boolean;
            newest_age_seconds?: number | null;
            newest_age_days?: number | null;
            oldest_age_days?: number | null;
        };
        DashboardBlockchain: {
            size_gb: number;
            pruned: boolean;
            /** @description Legacy presence indicator: true for a valid syncing or ready transaction index. */
            indexed: boolean;
            /** @description Initial block download; null when unavailable. */
            ibd: boolean | null;
            /**
             * @description Missing txindex in a successful index response means disabled. Failed or malformed readiness information means unknown.
             * @enum {string}
             */
            txindex_status: "disabled" | "syncing" | "ready" | "unknown";
            /** @description Last indexed block height when readiness information is valid; otherwise null. */
            txindex_height: number | null;
        };
        LastBlock: {
            height: number;
            time: number;
        };
        DashboardInfo: {
            blockchain: components["schemas"]["DashboardBlockchain"] | null;
            last_block: components["schemas"]["LastBlock"] | null;
            subversion: string | null;
            connected: number | null;
            services: string[] | null;
            network_details: components["schemas"]["NetworkSummary"] | null;
            network_scores: components["schemas"]["NetworkScores"] | null;
            node_traffic: components["schemas"]["NodeTraffic"] | null;
            node_metrics: components["schemas"]["NodeMetrics"];
            mempool_size: number | null;
            bitcoin_network: components["schemas"]["BitcoinNetwork"];
            /**
             * @description Independent internet reachability probe status.
             * @enum {string}
             */
            internet_state: "green" | "yellow" | "red";
            api_available: boolean;
            geo_db_only_mode: boolean;
            providers: {
                geoip: components["schemas"]["ProviderHealth"];
            };
            geo_db_stats: components["schemas"]["GeoStats"];
            updates: components["schemas"]["UpdateStatus"];
        };
        RecentBlock: {
            height: number;
            hash: string;
            time: number;
            size: number;
            size_mb: number;
            weight: number;
            tx_count: number;
            version: number | null;
            difficulty: number | null;
            age_seconds: number | null;
        };
        RecentBlocksSummary: {
            chain: string | null;
            tip_height: number;
            count: number;
            latest_time: number | null;
            total_size: number;
            avg_size_mb: number;
            total_transactions: number;
            avg_transactions: number;
            generated_at: number;
        };
        RecentBlocksResponse: {
            success: boolean;
            blocks: components["schemas"]["RecentBlock"][];
            error: string | null;
            summary: components["schemas"]["RecentBlocksSummary"] | null;
        };
        ChainTip: {
            height: number;
            hash: string;
            branch_length: number;
            status: string;
            status_label: string;
            time: number | null;
            age_seconds: number | null;
            is_active: boolean;
        };
        ChainTipsSummary: {
            chain: string | null;
            best_height: number | null;
            best_hash: string | null;
            total: number;
            active_count: number;
            non_active_count: number;
            fork_count: number;
            headers_only_count: number;
            latest_non_active_height: number | null;
            latest_non_active_status: string | null;
            counts_by_status: {
                [key: string]: number;
            };
            /** @description More tips exist than the 100-tip age lookup cap. */
            age_lookup_limited: boolean;
            /** @constant */
            age_lookup_limit: 100;
            /** @description Header age enrichment exceeded its time budget; some ages may be unavailable. */
            age_lookup_timed_out: boolean;
            /** @description Unix timestamp in seconds for this returned copy. */
            generated_at: number;
        };
        ChainTipsResponse: {
            success: boolean;
            tips: components["schemas"]["ChainTip"][];
            error: string | null;
            summary: components["schemas"]["ChainTipsSummary"] | null;
        };
        MempoolData: {
            size?: number | null;
            /** @description RPC extension retained without type validation. */
            bytes?: unknown;
            /** @description RPC extension retained without type validation. */
            usage?: unknown;
            /** @description RPC extension retained without type validation. */
            total_fee?: unknown;
            /** @description RPC extension retained without type validation. */
            maxmempool?: unknown;
            /** @description RPC extension retained without type validation. */
            mempoolminfee?: unknown;
            /** @description RPC extension retained without type validation. */
            minrelaytxfee?: unknown;
            /** @description RPC extension retained without type validation. */
            fullrbf?: unknown;
            /** @description RPC extension retained without type validation. */
            unbroadcastcount?: unknown;
        } & {
            [key: string]: unknown;
        };
        BlockchainData: {
            chain?: string | null;
            blocks?: number | null;
            bestblockhash?: string | null;
            size_on_disk?: number | null;
            pruned?: boolean | null;
            initialblockdownload: boolean | null;
            /** @description RPC extension retained without type validation. */
            headers?: unknown;
            /** @description RPC extension retained without type validation. */
            difficulty?: unknown;
            /** @description RPC extension retained without type validation. */
            mediantime?: unknown;
            /** @description RPC extension retained without type validation. */
            softforks?: unknown;
        } & {
            [key: string]: unknown;
        };
        MempoolResponse: {
            mempool: components["schemas"]["MempoolData"] | null;
            error: string | null;
        };
        BlockchainResponse: {
            blockchain: components["schemas"]["BlockchainData"] | null;
            error: string | null;
        };
        ActionResponse: {
            success: boolean;
            error?: string;
            address?: string;
            banned_ip?: string;
            network?: string;
        };
        BansResponse: {
            success: boolean;
            /** @description Raw listbanned response, normally an array of ban entries. Retained without shape validation; empty array on failure. */
            bans: unknown;
            error?: string;
        };
        /** @description Conventional listbanned entry; listbanned is passed through unchanged rather than validated against this schema. */
        BanEntry: {
            address: string;
            ban_created: number;
            banned_until: number;
        } & {
            [key: string]: unknown;
        };
        SuccessResponse: {
            success: boolean;
        };
        GeoUpdateResponse: {
            success: boolean;
            message: string;
            skipped_rows: number;
            added_rows?: number;
            updated_rows?: number;
        };
        GeoDbOnlyResponse: {
            success: boolean;
            geo_db_only_mode: boolean;
            message: string;
        };
        GeoAutoUpdateResponse: {
            success: boolean;
            auto_update: boolean;
            message: string;
        };
        StatsResponse: {
            system_stats: components["schemas"]["NodeMetrics"];
        };
        RpcInfo: {
            scheme: string;
            host: string;
            port: number;
            /** @enum {string} */
            network: "main" | "test" | "testnet4" | "signet" | "regtest";
            endpoint: string;
        };
        ConfigResponse: {
            bitcoin_rpc: {
                scheme: string;
                host: string;
                port: number;
                /** @enum {string} */
                network: "main" | "test" | "testnet4" | "signet" | "regtest";
                endpoint: string;
                verify_tls: boolean;
                timeout: number;
                startup_timeout: number;
                username_configured: boolean;
                password_configured: boolean;
                password_file_configured: boolean;
            };
            server: {
                listen_address: string;
                listen_port: number;
                /** @enum {string} */
                log_level: "debug" | "info" | "warn" | "error";
            };
            management: {
                enabled: boolean;
            };
            geoip: {
                enabled: boolean;
                auto_update_override: boolean | null;
            };
            build: {
                version: string;
                revision: string;
                revision_known: boolean;
                asset_revision: string;
                revision_url: string;
                updates: components["schemas"]["UpdateStatus"];
            };
            repository: {
                github: string;
                url: string;
            };
            data: {
                data_dir: string;
            };
        };
        HealthResponse: {
            /** @constant */
            status: "ok";
        };
        SystemConnectedEvent: {
            /** @constant */
            type: "connected";
        };
    };
    responses: {
        /** @description Browser requests whose Origin host does not match Host are rejected. Reverse proxies must preserve the external Host header. Management is also rejected when BPM_ADMIN_TOKEN is not configured (code: management_disabled). */
        CrossOriginRequest: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description Missing or incorrect admin token. The action was not executed. */
        AdminRequired: {
            headers: {
                "WWW-Authenticate"?: string;
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description Anonymous authentication cooldown for the client address (socket by default, or the first untrusted hop supplied by explicitly trusted proxies). Invalid credentials are rejected until Retry-After expires. Invalid credentials from untracked addresses are also rejected while all 1,024 active windows are occupied. Valid admin tokens remain usable during cooldowns and storage saturation without clearing anonymous failure history. */
        AdminRateLimited: {
            headers: {
                "Retry-After"?: string;
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
        /** @description RPC capacity exhausted (8 active calls and 32 queued calls). No RPC was dispatched for the rejected operation. Mutations are never retried automatically. */
        RpcBusy: {
            headers: {
                /** @description Retry delay in seconds. */
                "Retry-After"?: 1;
                [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "detail": "Bitcoin RPC is busy; try again shortly",
                 *       "code": "rpc_busy"
                 *     }
                 */
                "application/json": components["schemas"]["ErrorResponse"];
            };
        };
    };
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type AddressRequest = components['schemas']['AddressRequest'];
export type PeerIdRequest = components['schemas']['PeerIdRequest'];
export type ErrorResponse = components['schemas']['ErrorResponse'];
export type UpdateStatus = components['schemas']['UpdateStatus'];
export type ProviderHealth = components['schemas']['ProviderHealth'];
export type ConnectivityStatus = components['schemas']['ConnectivityStatus'];
export type BitcoinNetwork = components['schemas']['BitcoinNetwork'];
export type EnabledRequest = components['schemas']['EnabledRequest'];
export type Peer = components['schemas']['Peer'];
export type GeoMetadata = components['schemas']['GeoMetadata'];
export type NetworkFamily = components['schemas']['NetworkFamily'];
export type PeerDirection = components['schemas']['PeerDirection'];
export type PeerStatus = components['schemas']['PeerStatus'];
export type PeerSnapshot = components['schemas']['PeerSnapshot'];
export type NodeAddress = components['schemas']['NodeAddress'];
export type NetworkDetails = components['schemas']['NetworkDetails'];
export type NetworkSummary = components['schemas']['NetworkSummary'];
export type NetworkScores = components['schemas']['NetworkScores'];
export type NodeTraffic = components['schemas']['NodeTraffic'];
export type NodeMetrics = components['schemas']['NodeMetrics'];
export type GeoDatabaseStats = components['schemas']['GeoDatabaseStats'];
export type GeoStats = components['schemas']['GeoStats'];
export type DashboardBlockchain = components['schemas']['DashboardBlockchain'];
export type LastBlock = components['schemas']['LastBlock'];
export type DashboardInfo = components['schemas']['DashboardInfo'];
export type RecentBlock = components['schemas']['RecentBlock'];
export type RecentBlocksSummary = components['schemas']['RecentBlocksSummary'];
export type RecentBlocksResponse = components['schemas']['RecentBlocksResponse'];
export type ChainTip = components['schemas']['ChainTip'];
export type ChainTipsSummary = components['schemas']['ChainTipsSummary'];
export type ChainTipsResponse = components['schemas']['ChainTipsResponse'];
export type MempoolData = components['schemas']['MempoolData'];
export type BlockchainData = components['schemas']['BlockchainData'];
export type MempoolResponse = components['schemas']['MempoolResponse'];
export type BlockchainResponse = components['schemas']['BlockchainResponse'];
export type ActionResponse = components['schemas']['ActionResponse'];
export type BansResponse = components['schemas']['BansResponse'];
export type BanEntry = components['schemas']['BanEntry'];
export type SuccessResponse = components['schemas']['SuccessResponse'];
export type GeoUpdateResponse = components['schemas']['GeoUpdateResponse'];
export type GeoDbOnlyResponse = components['schemas']['GeoDbOnlyResponse'];
export type GeoAutoUpdateResponse = components['schemas']['GeoAutoUpdateResponse'];
export type StatsResponse = components['schemas']['StatsResponse'];
export type RpcInfo = components['schemas']['RpcInfo'];
export type ConfigResponse = components['schemas']['ConfigResponse'];
export type HealthResponse = components['schemas']['HealthResponse'];
export type SystemConnectedEvent = components['schemas']['SystemConnectedEvent'];
export type ResponseCrossOriginRequest = components['responses']['CrossOriginRequest'];
export type ResponseAdminRequired = components['responses']['AdminRequired'];
export type ResponseAdminRateLimited = components['responses']['AdminRateLimited'];
export type ResponseRpcBusy = components['responses']['RpcBusy'];
export type $defs = Record<string, never>;
export interface operations {
    list_peers_api_peers_get: {
        parameters: {
            query?: {
                /** @description Case-insensitive true/1/yes/on or false/0/no/off; omitted defaults to false. */
                include_status?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Peer"][] | components["schemas"]["PeerSnapshot"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: components["responses"]["RpcBusy"];
            /** @description HTTP request failure (including unexpected internal failures). */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    connect_peer_api_peer_connect_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AddressRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActionResponse"];
                };
            };
            401: components["responses"]["AdminRequired"];
            403: components["responses"]["CrossOriginRequest"];
            /** @description Request body exceeds 64 KiB */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: components["responses"]["AdminRateLimited"];
            503: components["responses"]["RpcBusy"];
            /** @description HTTP request failure (including unexpected internal failures). */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    disconnect_peer_api_peer_disconnect_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PeerIdRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActionResponse"];
                };
            };
            401: components["responses"]["AdminRequired"];
            403: components["responses"]["CrossOriginRequest"];
            /** @description Request body exceeds 64 KiB */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: components["responses"]["AdminRateLimited"];
            503: components["responses"]["RpcBusy"];
            /** @description HTTP request failure (including unexpected internal failures). */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    ban_peer_api_peer_ban_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PeerIdRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActionResponse"];
                };
            };
            401: components["responses"]["AdminRequired"];
            403: components["responses"]["CrossOriginRequest"];
            /** @description Request body exceeds 64 KiB */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: components["responses"]["AdminRateLimited"];
            503: components["responses"]["RpcBusy"];
            /** @description HTTP request failure (including unexpected internal failures). */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    unban_peer_api_peer_unban_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AddressRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActionResponse"];
                };
            };
            401: components["responses"]["AdminRequired"];
            403: components["responses"]["CrossOriginRequest"];
            /** @description Request body exceeds 64 KiB */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: components["responses"]["AdminRateLimited"];
            503: components["responses"]["RpcBusy"];
            /** @description HTTP request failure (including unexpected internal failures). */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    list_bans_api_bans_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BansResponse"];
                };
            };
            503: components["responses"]["RpcBusy"];
            /** @description HTTP request failure (including unexpected internal failures). */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    clear_bans_api_bans_clear_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ActionResponse"];
                };
            };
            401: components["responses"]["AdminRequired"];
            403: components["responses"]["CrossOriginRequest"];
            429: components["responses"]["AdminRateLimited"];
            503: components["responses"]["RpcBusy"];
            /** @description HTTP request failure (including unexpected internal failures). */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    dashboard_info_api_info_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DashboardInfo"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: components["responses"]["RpcBusy"];
            /** @description HTTP request failure (including unexpected internal failures). */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    mempool_api_mempool_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MempoolResponse"];
                };
            };
            503: components["responses"]["RpcBusy"];
            /** @description HTTP request failure (including unexpected internal failures). */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    blockchain_api_blockchain_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["BlockchainResponse"];
                };
            };
            503: components["responses"]["RpcBusy"];
            /** @description HTTP request failure (including unexpected internal failures). */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    recent_blocks_api_blocks_recent_get: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RecentBlocksResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            503: components["responses"]["RpcBusy"];
            /** @description HTTP request failure (including unexpected internal failures). */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    rpc_info_api_rpc_info_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["RpcInfo"];
                };
            };
            503: components["responses"]["RpcBusy"];
            /** @description HTTP request failure (including unexpected internal failures). */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    chain_tips_api_chain_tips_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ChainTipsResponse"];
                };
            };
            503: components["responses"]["RpcBusy"];
            /** @description HTTP request failure (including unexpected internal failures). */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    connectivity_api_connectivity_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConnectivityStatus"];
                };
            };
            503: components["responses"]["RpcBusy"];
            /** @description HTTP request failure (including unexpected internal failures). */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    acknowledge_connectivity_prompt_api_connectivity_api_prompt_ack_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SuccessResponse"];
                };
            };
            401: components["responses"]["AdminRequired"];
            403: components["responses"]["CrossOriginRequest"];
            429: components["responses"]["AdminRateLimited"];
            503: components["responses"]["RpcBusy"];
            /** @description HTTP request failure (including unexpected internal failures). */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    toggle_geoip_api_api_geodb_toggle_db_only_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            401: components["responses"]["AdminRequired"];
            403: components["responses"]["CrossOriginRequest"];
            /** @description Retired endpoint. Response identifies the replacement and asks old dashboard tabs to reload. */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: components["responses"]["AdminRateLimited"];
            503: components["responses"]["RpcBusy"];
            /** @description HTTP request failure (including unexpected internal failures). */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    toggle_auto_update_api_geodb_toggle_auto_update_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            401: components["responses"]["AdminRequired"];
            403: components["responses"]["CrossOriginRequest"];
            /** @description Retired endpoint. Response identifies the replacement and asks old dashboard tabs to reload. */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: components["responses"]["AdminRateLimited"];
            503: components["responses"]["RpcBusy"];
            /** @description HTTP request failure (including unexpected internal failures). */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    update_database_api_geodb_update_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GeoUpdateResponse"];
                };
            };
            401: components["responses"]["AdminRequired"];
            403: components["responses"]["CrossOriginRequest"];
            429: components["responses"]["AdminRateLimited"];
            503: components["responses"]["RpcBusy"];
            /** @description HTTP request failure (including unexpected internal failures). */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    stats_api_stats_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StatsResponse"];
                };
            };
            503: components["responses"]["RpcBusy"];
            /** @description HTTP request failure (including unexpected internal failures). */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    config_api_config_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ConfigResponse"];
                };
            };
            503: components["responses"]["RpcBusy"];
            /** @description HTTP request failure (including unexpected internal failures). */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    system_stream_api_stream_system_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Server-sent events: a connected message followed by RPC-only node metric samples, at most once every five seconds. The legacy path and system event name are retained. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": string;
                };
            };
        };
    };
    dashboard__get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/html": string;
                };
            };
        };
    };
    verify_admin_token: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Token accepted */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SuccessResponse"];
                };
            };
            401: components["responses"]["AdminRequired"];
            403: components["responses"]["CrossOriginRequest"];
            429: components["responses"]["AdminRateLimited"];
            503: components["responses"]["RpcBusy"];
            /** @description HTTP request failure (including unexpected internal failures). */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    set_geodb_db_only: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EnabledRequest"];
            };
        };
        responses: {
            /** @description Authoritative saved setting. Identical requests do not rewrite settings or reset scheduling. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GeoDbOnlyResponse"];
                };
            };
            401: components["responses"]["AdminRequired"];
            403: components["responses"]["CrossOriginRequest"];
            /** @description Request body exceeds 64 KiB. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Missing or non-boolean enabled value. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: components["responses"]["AdminRateLimited"];
            503: components["responses"]["RpcBusy"];
            /** @description HTTP request failure (including unexpected internal failures). */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    set_geodb_auto_update: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["EnabledRequest"];
            };
        };
        responses: {
            /** @description Authoritative saved setting. Identical requests do not rewrite settings or reset scheduling. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GeoAutoUpdateResponse"];
                };
            };
            401: components["responses"]["AdminRequired"];
            403: components["responses"]["CrossOriginRequest"];
            /** @description Request body exceeds 64 KiB. */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            /** @description Missing or non-boolean enabled value. */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
            429: components["responses"]["AdminRateLimited"];
            503: components["responses"]["RpcBusy"];
            /** @description HTTP request failure (including unexpected internal failures). */
            default: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ErrorResponse"];
                };
            };
        };
    };
    healthz: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description HTTP server is listening; this does not assert Bitcoin RPC readiness. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HealthResponse"];
                };
            };
        };
    };
}
