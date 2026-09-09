/** Browser contract for /api/peers. Strings remain raw until rendered into HTML. */
export type PeerDirection = 'IN' | 'OUT';
export type PeerNetwork = 'ipv4' | 'ipv6' | 'onion' | 'i2p' | 'cjdns';
export interface Peer {
    id: number;
    network: PeerNetwork;
    direction: PeerDirection;
    addr?: string;
    ip?: string;
    subver?: string;
    city?: string;
    region?: string;
    regionName?: string;
    country?: string;
    countryCode?: string;
    continent?: string;
    continentCode?: string;
    bytessent_fmt?: string;
    bytesrecv_fmt?: string;
    conntime_fmt?: string;
    connection_type?: string;
    connection_type_abbrev?: string;
    services_abbrev?: string;
    isp?: string;
    district?: string;
    zip?: string;
    timezone?: string;
    currency?: string;
    org?: string;
    as?: string;
    asname?: string;
    location?: string;
    location_status?: string;
    transport_protocol_type?: string;
    session_id?: string;
    addrlocal?: string;
    port?: string;
    bytessent?: number | null;
    bytesrecv?: number | null;
    ping_ms?: number | null;
    conntime?: number | null;
    version?: number | null;
    lat?: number | null;
    lon?: number | null;
    offset?: number | null;
    minping?: number | null;
    lastsend?: number | null;
    lastrecv?: number | null;
    startingheight?: number | null;
    synced_headers?: number | null;
    synced_blocks?: number | null;
    last_transaction?: number | null;
    last_block?: number | null;
    timeoffset?: number | null;
    minfeefilter?: number | null;
    addr_processed?: number | null;
    addr_rate_limited?: number | null;
    mapped_as?: number | null;
    mobile?: boolean | null;
    proxy?: boolean | null;
    hosting?: boolean | null;
    in_addrman?: boolean | null;
    addr_relay_enabled?: boolean | null;
    bip152_hb_from?: boolean | null;
    bip152_hb_to?: boolean | null;
    relaytxes?: boolean | null;
    services?: string[];
    permissions?: string[];
}

export interface PeerSnapshot {
    peers: Peer[];
    status: {
        connected: boolean | null;
        last_success_at: number | null;
        last_attempt_at?: number | null;
        age_seconds: number | null;
        stale_after_seconds: number;
        error?: string | null;
    };
}
export interface PeerDataStatus {
    state: 'live' | 'connecting' | 'node-unavailable' | 'dashboard-unavailable' | 'delayed';
    ageSeconds: number | null;
    lastSuccessAt: number | null;
    stale: boolean;
}
export interface PeerRefreshOptions {
    api?: { getJson(url: string, options: RequestInit): Promise<PeerSnapshot> };
    now?: () => number;
    timeoutMs?: number;
    onPeers: (peers: Peer[]) => void;
    onStatus: (status: PeerDataStatus) => void;
}
export interface PeerRefreshController {
    refresh(): Promise<void>;
    getStatus(): PeerDataStatus;
    renderStatus(): void;
}
export interface PollingOptions {
    task: () => Promise<void>;
    intervalMs: number;
    onError?: (error: unknown) => void;
}
export interface PollingController {
    run(): Promise<void>;
    start(): void;
    stop(): void;
    setIntervalMs(value: number): void;
}
export interface PeerColumn {
    key: keyof Peer | 'services_abbrev';
    get: (peer: Peer) => string | number | boolean;
}
export interface PeerTableFilters {
    privateMode: boolean;
    privateNetwork: PeerNetwork | null;
    passesNetwork: (network: PeerNetwork) => boolean;
    providerPeerIds: ReadonlySet<number> | null;
    mapPeerIds: ReadonlySet<number> | null;
}
export interface PeerMapNode {
    peerId: number;
    net: PeerNetwork;
    direction: PeerDirection;
    alive: boolean;
}
export interface PrivateInsight {
    peerId: number;
    peerNet: PeerNetwork;
    statText: string;
}
export interface PrivateNetworkState {
    privateNetMode: boolean;
    privateNetSelectedPeer: PeerMapNode | null;
    privateNetLinePeer: number | null;
    pnBigPopupEl: HTMLElement | null;
    pnMiniHover: boolean;
    pnPreviewPeerIds: number[] | null;
    pnMiniHoverNet: PeerNetwork | null;
    pnInsightRectEl: HTMLElement | null;
    pnInsightRectVisible: boolean;
    pnInsightActiveType: string | null;
    pnInsightActivePeerId: number | null;
    pnInsightActiveData: PrivateInsight | null;
    pnContainerEl: HTMLElement | null;
    pnDonutSvg: SVGElement | null;
    pnCenterCount: HTMLElement | null;
    pnCenterLabel: HTMLElement | null;
    pnCenterSub: HTMLElement | null;
    pnDetailPanelEl: HTMLElement | null;
    pnDetailBodyEl: HTMLElement | null;
    pnDetailBodyHandlerAttached: boolean;
    pnDetailNetNameEl: HTMLElement | null;
    pnDetailMetaEl: HTMLElement | null;
    pnSegments: {net: PeerNetwork; count: number; color: string; label: string}[];
    pnSelectedNet: PeerNetwork | null;
    pnHoveredNet: PeerNetwork | null;
    pnPopupTimer: number | null;
    pnSubTooltipPinned: boolean;
    pnPinnedSubSrc: HTMLElement | null;
    pnCenterPreviewLabel: string | null;
    pnCenterPreviewPeerIds: number[] | null;
}
export interface TableDisplaySettings {
    visibleColumns: string[];
    autoFitColumns: boolean;
    userColumnWidths: Record<string, number>;
    panelOpacity: number;
    maxPeerRows: number;
    showAntarcticaPeers: boolean;
}
export interface PeerTableOptions {
    state: PrivateNetworkState;
    data: {
        readonly NET_DISPLAY: Record<PeerNetwork, string>;
        readonly clamp: (value: number, min: number, max: number) => number;
        readonly lastPeers: Peer[];
        readonly W: number;
        readonly asFilterPeerIds: Set<number> | null;
        readonly mapFilterPeerIds: Set<number> | null;
        readonly highlightedPeerId: number | null;
    };
    actions: {
        serviceAbbrev: (services: string[]) => string;
        serviceHover: (services: string[]) => string;
        writeSavedDisplaySettings: (settings: Partial<TableDisplaySettings>) => void;
        readSavedDisplaySettings: () => Partial<TableDisplaySettings>;
        scheduleDonutStackFit: () => void;
        passesNetFilter: (network: PeerNetwork) => boolean;
        fitDonutStackForPanelTop: (top: number, immediate: boolean) => void;
        fitDonutStackToViewport: () => void;
    };
}
export interface PeerTableController {
    readonly showAntarcticaPeers: boolean;
    readonly panelEl: HTMLElement;
    readonly tbodyEl: HTMLElement;
    currentTableDisplaySettings(): TableDisplaySettings;
    loadTableDisplaySettings(): void;
    renderPeerTableHead(): void;
    renderPeerTable(): void;
    updateAutoFitBtn(): void;
    applyPanelOpacity(): void;
    applyMaxPeerRows(): void;
    highlightTableRow(peerId: number | null, scrollIntoView?: boolean): void;
}

export interface ServiceFlag { abbr: string; label: string; rpc: string }
export interface PrivatePanelOptions {
    state: PrivateNetworkState;
    data: {
        readonly lastPeers: Peer[];
        readonly PN_NET_LABELS: Partial<Record<PeerNetwork, string>>;
        readonly PRIVATE_NETS: ReadonlySet<PeerNetwork>;
        readonly nodes: PeerMapNode[];
        highlightedPeerId: number | null;
    };
    actions: {
        cachePnElements(): void;
        getPnNetColor(network: PeerNetwork): string;
        pnEsc(value: unknown): string;
        pnFmtDuration(seconds: number): string;
        selectPrivatePeer(peerId: number): void;
        renderPnDonut(): void;
        serviceFlagFromAbbr(abbreviation: string): ServiceFlag | null;
        serviceFlagDescription(flag: ServiceFlag): string;
    };
}
export interface PrivatePanelController {
    refreshPinnedPreview(): void;
    openPnDetailPanel(network: PeerNetwork): void;
    closePnDetailPanel(): void;
    updatePnDetailPanel(network: PeerNetwork): void;
    openPnOverviewPanel(): void;
    updatePnOverviewPanel(): void;
    showPnInsightRect(type: string, data: PrivateInsight): void;
    hidePnInsightRect(): void;
    clearPnInsightState(): void;
    getPnInsightRectOrigin(): { x: number; y: number } | null;
    buildPnInsightData(peer: Peer, type: string): PrivateInsight;
    hidePnSubTooltip(): void;
    fmtBytesShort(bytes: number): string;
}
export interface PrivatePeerDetailOptions {
    state: PrivateNetworkState;
    data: {
        readonly lastPeers: Peer[];
        readonly PN_CONN_TYPE_FULL: Record<string, string>;
        highlightedPeerId: number | null;
        pinnedNode: PeerMapNode | null;
    };
    actions: {
        pnEsc(value: unknown): string;
        pnFmtDuration(seconds: number): string;
        pnFmtBytes(bytes: number): string;
        renderServiceFlagList(abbreviations: string): string;
        cachePnElements(): void;
        updatePrivateNetUI(): void;
        showDisconnectDialog(peerId: number, network: PeerNetwork): void;
    };
}
export interface PrivatePeerDetailController {
    closePnBigPopup(): void;
    closePnBigPopupSync(): void;
    showPnBigPopup(node: PeerMapNode): void;
}

declare global {
    interface Window {
        BPMApi: NonNullable<PeerRefreshOptions['api']>;
        BPMPeerRefresh: { create(options: PeerRefreshOptions): PeerRefreshController };
        BPMPolling: { create(options: PollingOptions): PollingController };
        BPMPeerTableModel: {
            filterPeers(peers: readonly Peer[], filters: PeerTableFilters): Peer[];
            sortPeers(peers: readonly Peer[], column: PeerColumn | undefined, ascending: boolean): Peer[];
        };
        BPMPrivateNetworkState: { create(): PrivateNetworkState };
    }
}
