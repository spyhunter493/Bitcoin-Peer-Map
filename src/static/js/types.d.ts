/** Browser contract for /api/peers. Strings remain raw until rendered into HTML. */
export interface AdminAuthentication {
    getToken(): string;
    clearToken(): void;
    requestToken(signal?: AbortSignal): Promise<string>;
}

export type PeerDirection = 'IN' | 'OUT';
export type PeerNetwork = 'ipv4' | 'ipv6' | 'onion' | 'i2p' | 'cjdns';
export interface Peer {
    id: number;
    network: PeerNetwork;
    direction: PeerDirection;
    addr: string;
    ip: string;
    subver: string;
    city: string;
    region: string;
    regionName: string;
    country: string;
    countryCode: string;
    continent: string;
    continentCode: string;
    bytessent_fmt: string;
    bytesrecv_fmt: string;
    conntime_fmt: string;
    connection_type: string;
    connection_type_abbrev: string;
    services_abbrev: string;
    isp: string;
    district: string;
    zip: string;
    timezone: string;
    currency: string;
    org: string;
    as: string;
    asname: string;
    location: string;
    location_status: string;
    transport_protocol_type: string;
    session_id: string;
    addrlocal: string;
    port: number | null;
    bytessent: number;
    bytesrecv: number;
    ping_ms: number;
    conntime: number;
    version: number;
    lat?: number | null;
    lon?: number | null;
    offset?: number | null;
    minping?: number | null;
    lastsend?: number | null;
    lastrecv?: number | null;
    startingheight?: number | null;
    synced_headers?: number | null;
    synced_blocks?: number | null;
    last_transaction: number;
    last_block: number;
    timeoffset: number;
    minfeefilter?: number | null;
    addr_processed: number;
    addr_rate_limited: number;
    mapped_as?: number | null;
    mobile?: boolean | null;
    proxy?: boolean | null;
    hosting?: boolean | null;
    in_addrman?: boolean | null;
    addr_relay_enabled?: boolean | null;
    bip152_hb_from?: boolean | null;
    bip152_hb_to?: boolean | null;
    relaytxes?: boolean | null;
    services: string[];
    permissions: string[];
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
    privateNetwork: string | null;
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
    privateNetSelectedPeerId: number | null;
    privateNetLinePeer: number | null;
    pnMiniHover: boolean;
    pnPreviewPeerIds: number[] | null;
    pnMiniHoverNet: string | null;
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
    pnSegments: { net: string; count: number; color: string; label: string }[];
    pnSelectedNet: string | null;
    pnHoveredNet: string | null;
    pnSubTooltipPinned: boolean;
    pnPinnedSubSrc: HTMLElement | null;
    pnFilter: { filter: { kind: string; key: string }; label: string } | null;
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
    dashboard: ReturnType<typeof import('./core/dashboard-state.js').create>;
    mapView: Pick<MapView, 'width'>;
    preferences: {
        writeSavedDisplaySettings(settings: Partial<TableDisplaySettings>): void;
        readSavedDisplaySettings(): Partial<TableDisplaySettings>;
    };
    onAction(action: { type: 'layout' } | { type: 'fit'; top?: number; immediate?: boolean } | { type: 'antarctica'; visible: boolean }): void;
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

export interface ServiceFlag {
    abbr: string;
    label: string;
    rpc: string;
}
export interface PrivatePanelOptions {
    state: PrivateNetworkState;
    getColor(network: string): string;
    onAction(
        action:
            | { type: 'select'; peerId: number }
            | { type: 'highlight'; peerId: number | null }
            | { type: 'redraw' | 'table' }
    ): void;
}
export interface PrivatePanelController {
    cachePnElements(): void;
    refreshPinnedPreview(): void;
    openPnDetailPanel(network: string): void;
    closePnDetailPanel(): void;
    updatePnDetailPanel(network: string): void;
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

export type PeerFilter =
    | { kind: 'all'; filters: PeerFilter[]; key?: never }
    | { kind: string; key: string; filters?: never };
export interface Point {
    x: number;
    y: number;
}
export interface MapNode {
    peerId: number;
    peer: Peer;
    lat: number;
    lon: number;
    color: RGB;
    isPrivate: boolean;
    phase: number;
    spawnTime: number;
    alive: boolean;
    fadeOutStart: number | null;
}
export interface MapView {
    width: number;
    height: number;
    nodes: MapNode[];
    target: Point & { zoom: number };
}
export interface MapInteraction {
    highlightedPeerId: number | null;
    mapFilterPeerIds: Set<number> | null;
    groupedNodes: MapNode[] | null;
    groupSelection: {
        point: Point;
        radiusX: number;
        radiusY: number;
        mx: number;
        my: number;
        privateGroup: boolean;
    } | null;
    asFilterPeerIds: Set<number> | null;
    asLinePeerIds: number[] | null;
    asLineColor: string | null;
    asLineAsNum: string | null;
    asLineGroups: { asNum: string; peerIds: number[]; color: string }[] | null;
    enabledNets: Set<string>;
    hoveredNode: MapNode | null;
    pinnedNode: MapNode | null;
}
export interface InsightPresentation {
    provName: string;
    asNumber: string;
    color: string;
    peerIds?: number[];
    durText?: string;
    avgPing?: number;
    totalBytes?: number;
    rank?: number;
}
export interface DistributionValues {
    selectedProvider: string | null;
    summarySelected: boolean;
    activeNetwork: string | null;
    lens: 'provider' | 'country';
    hoveredProvider: string | null;
    hoveringAll: boolean;
    focusedHoverProvider: string | null;
    legendFocusProvider: string | null;
    hoveredPeerId: number | null;
    summaryPreviewPeerIds: number[] | null;
    summaryPreviewLabel: string | null;
    filterPeerIds: number[] | null;
    filterDescriptor: PeerFilter | null;
    filterLabel: string | null;
    filterCategory: string | null;
    subTooltipPinned: boolean;
    subSubTooltipPinned: boolean;
    subSubFilterPeerIds: number[] | null;
    subSubFilterProvider: string | null;
    subSubFilterColor: string | null;
    panelHistory: { type: 'summary' | 'provider'; scrollTop: number; asNumber?: string | null }[];
    donutFocused: boolean;
    peerDetailActive: boolean;
    selectedPeerId: number | null;
    insightActiveAsNum: string | null;
    insightActiveType: string | null;
    insightActiveData: InsightPresentation | null;
}

export interface GroupIdentity {
    asNumber: string;
    asName: string;
    asShort: string;
    countryCode?: string;
    countryName?: string;
    isCountryGroup?: boolean;
}
export type DistributionGroup = ReturnType<typeof import('./distribution/data.js').buildDistributionGroup>;
export type DistributionSegment = Pick<
    DistributionGroup,
    'asNumber' | 'asName' | 'asShort' | 'peerCount' | 'percentage' | 'riskLevel' | 'riskLabel' | 'color' | 'peerIds'
> &
    Partial<DistributionGroup> & {
        isOthers?: boolean;
        _othersGroups?: DistributionGroup[];
    };
export interface SummaryProvider {
    asNumber: string;
    name: string;
    color: string;
    peerCount: number;
    peerIds: number[];
    peers: Peer[];
}
export interface PingProvider {
    asNumber: string;
    provName: string;
    color: string;
    avgPing: number;
    peers: Peer[];
    peerIds: number[];
}
export interface DataProvider {
    asNumber: string;
    provName: string;
    color: string;
    totalBytes: number;
    peers: Peer[];
}
export type DistributionInsight =
    | {
          type: 'stable';
          icon: string;
          asNumber: string;
          provName: string;
          durText: string;
          peerIds: number[];
          peers: Peer[];
      }
    | { type: 'fastest'; icon: string; topProviders: PingProvider[]; field: 'ping' }
    | {
          type: 'data-providers';
          icon: string;
          label: string;
          topProviders: DataProvider[];
          field: 'bytessent' | 'bytesrecv';
      };

export interface ModalOptions {
    id: string;
    title?: string;
    maxWidth?: number;
    closeId?: string;
    bodyId?: string;
    initialHtml?: string;
    overlayClass?: string;
    boxClass?: string;
    headerClass?: string;
    titleClass?: string;
    closeClass?: string;
    bodyClass?: string;
    showHeader?: boolean;
    contentHtml?: string;
    ariaLabel?: string;
    initialFocusSelector?: string;
    onClose?: () => void;
}
export interface ModalController {
    overlay: HTMLElement;
    body: HTMLElement;
    signal?: AbortSignal;
    close(restoreFocus?: boolean): void;
    isOpen(): boolean;
}

export interface PeerDetailOptions {
    providerColor?: string | null;
    privateNetwork?: boolean;
    showBack?: boolean;
    nowSeconds?: number;
    connectionTypeLabels?: Readonly<Record<string, string>>;
    serviceFlags?: Readonly<Record<string, ServiceFlag>>;
}
export interface PeerDetailControllerOptions extends PeerDetailOptions {
    getPeers(): Peer[];
    getProviderColor?: (asNumber: string | null) => string;
    onRequestClose(): void;
    onRequestGroup?: (peerIds: number[]) => void;
    onRequestPeer?: (peer: Peer, source: string) => void;
    onDisconnect(peerId: number, network: PeerNetwork): void;
}
export interface RGB {
    r: number;
    g: number;
    b: number;
}
export interface Camera extends Point {
    zoom: number;
}
export interface DistributionHooks {
    drawLinesForAs(asNumber: string, peerIds: number[], color: string | null): void;
    drawLinesForAllAs(groups: { asNum: string; peerIds: number[]; color: string }[]): void;
    clearAsLines(): void;
    filterPeerTable(peerIds: number[] | null): void;
    dimMapPeers(peerIds: number[] | null): void;
    zoomToPeerOnly(peerId: number): void;
    resetMapZoom(): void;
    clearPeerSelection(): void;
    hideMapTooltip(): void;
    enterPrivateNetMode(network?: string): void;
    showDisconnectDialog(peerId: number, network: string): void;
}
export interface GeometryLayers {
    world: number[][][][];
    lakes: number[][][][];
    borders: number[][][];
    states: number[][][];
    cities: { n: string; p: number; c: number[] }[];
    countryLabels: { n: string; c: number[] }[];
    stateLabels: { n: string; c: number[] }[];
}
export interface GeometryLoaderOptions {
    fetchJson<T>(filename: string): Promise<T>;
    thresholds?: { states?: number; stateLabels?: number; cities?: number };
    callbacks?: { [K in keyof GeometryLayers]?: (data: GeometryLayers[K]) => void };
    logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

export interface DashboardConfig {
    pollInterval: number;
    infoPollInterval: number;
    nodeRadius: number;
    glowRadius: number;
    fadeInDuration: number;
    fadeOutDuration: number;
    minZoom: number;
    maxZoom: number;
    zoomStep: number;
    panSmooth: number;
    gridSpacing: number;
    coastlineWidth: number;
    arrivalDuration: number;
    arrivalRingMaxRadius: number;
    arrivalRingDuration: number;
    arrivalPulseSpeed: number;
    ageBrightnessMin: number;
    ageBrightnessMax: number;
    ageRampSeconds: number;
    pulseSpeedInbound: number;
    pulseSpeedOutbound: number;
    pulseDepthInbound: number;
    pulseDepthOutbound: number;
    nervousnessMax: number;
    nervousnessRampSec: number;
    shimmerStrength: number;
    shimmerFreq1: number;
    shimmerFreq2: number;
    shimmerFreq3: number;
    fadeOutEase: number;
}

export interface AdvancedSettings {
    shimmerStrength: number;
    pulseDepthIn: number;
    pulseDepthOut: number;
    pulseSpeedIn: number;
    pulseSpeedOut: number;
    asLineWidth: number;
    asLineFan: number;
    landHue: number;
    landBright: number;
    snowPoles: number;
    oceanHue: number;
    oceanBright: number;
    oceanLightBlue: boolean;
    gridVisible: boolean;
    gridThickness: number;
    gridHue: number;
    gridBright: number;
    borderScale: number;
    borderHue: number;
    hudSolidBg: boolean;
    showDonutLegends: boolean;
}
export type NumericSetting = {
    [K in keyof AdvancedSettings]: AdvancedSettings[K] extends number ? K : never;
}[keyof AdvancedSettings];
export interface Theme {
    label: string;
    dot: string;
    desc: string;
    cssVars: Record<string, string>;
    advOverrides: Partial<Pick<AdvancedSettings, NumericSetting>>;
    nodeHighlight: RGB;
    netColors?: Record<string, RGB> | null;
    netColorUnknown?: RGB | null;
    oceanLightBlue?: boolean;
    hudSolidBg?: boolean;
}
export interface AdvancedOptions {
    settings: AdvancedSettings;
    defaults: AdvancedSettings;
    themes: Record<string, Theme>;
    config: DashboardConfig;
    getCurrentTheme(): string;
    applyTheme(name: string): void;
    saveSettings(): void;
    saveTheme(): void;
    updateColors(): void;
    markMapDirty(): void;
    applyHud(): void;
}
export interface DonutConfig {
    size: number;
    radius: number;
    width: number;
    selectedWidth: number;
    dimmedWidth: number;
    expandedRatio: number;
    duration: number;
    maxSegments: number;
}
export interface DonutAnimation {
    state: string;
    target: string | null;
    progress: number;
    startedAt: number;
}
export interface DonutElements {
    svg?: HTMLElement | SVGElement | null;
    wrap?: HTMLElement | null;
    center?: HTMLElement | null;
    insight?: HTMLElement | null;
    legend?: HTMLElement | null;
    loading?: HTMLElement | null;
}
export interface DonutView {
    segments: DistributionSegment[];
    groups: DistributionGroup[];
    totalPeers: number;
    countryLens: boolean;
}
export interface DonutOptions {
    state: DistributionValues;
    config?: Partial<DonutConfig>;
    getView(): DonutView;
    getColor(provider: string): string;
    onSegmentHover(event: MouseEvent): void;
    onSegmentLeave(event: MouseEvent): void;
    onSegmentClick(event: MouseEvent | KeyboardEvent): void;
    onInsightClose(): void;
}
export interface ProviderCenterOptions {
    focused?: boolean;
    legendHover?: boolean;
    isSubProvider?: boolean;
    countryLens?: boolean;
    entityKind?: string;
    rank?: number;
    onBack?: (() => void) | null;
}
export type SummaryCategory = ReturnType<typeof import('./distribution/data.js').aggregateSummaryNetworks>[number];
export type SummaryProviderRow = Partial<
    SummaryProvider & { a: string; n: string; c: string; pc: number; pi: number[] }
>;
export interface SummaryPanelOptions {
    serviceFlags: Readonly<Record<string, ServiceFlag>>;
    connectionTypeLabels: Readonly<Record<string, string>>;
    elements: { readonly panel: HTMLElement | null };
    actions: {
        buildScoreTooltip(score: number): string;
        buildActiveScoreTooltip(score: number): string;
        getColorForAsNum(asNumber: string): string;
    };
}
export interface EntityPanelOptions {
    panelEl: HTMLElement;
    segment: DistributionSegment;
    group: DistributionSegment;
    summaryView: ReturnType<typeof import('./distribution/summary-panel.js').create>;
    connectionTypeLabels: Readonly<Record<string, string>>;
    attachInteractiveRowHandlers(body: HTMLElement, segment: DistributionSegment): void;
    attachPanelBlankClickHandler(body: HTMLElement): void;
}
export interface MapPlace {
    n: string;
    c: number[];
    mapX?: number;
    mapY?: number;
}
export type PrivateNetworkAction =
    | { type: 'highlight' | 'pin' | 'highlight-row'; peerId: number | null }
    | { type: 'networks'; networks: Set<string> }
    | { type: 'disconnect'; peerId: number; network: string }
    | { type: 'hide-tooltip' | 'clear-filter' | 'badges' | 'table' | 'layout' };

export interface NodeAddress {
    address: string;
    port: number | null;
    score?: number;
}
export interface NetworkDetails {
    reachable: boolean;
    limited: boolean;
    proxy: string;
    localaddresses: NodeAddress[];
}
export interface GeoStats {
    status: string;
    entries?: number;
    size_bytes?: number;
    db_path?: string;
    newest_age_seconds?: number | null;
    newest_age_days?: number | null;
    oldest_age_days?: number | null;
    auto_lookup: boolean;
    auto_update: boolean;
    db_only_mode: boolean;
}
export interface NodeTraffic {
    download_bytes: number;
    upload_bytes: number;
    download_fmt: string;
    upload_fmt: string;
}
export interface UpdateStatus {
    update_available: boolean;
    latest_version: string | null;
    changes_url: string | null;
    checked_at: number | null;
    check_failed: boolean;
}
export interface NodeInfo {
    updates?: UpdateStatus;
    connected: number | null;
    subversion: string | null;
    services: string[] | null;
    blockchain: { size_gb: number; pruned: boolean; indexed: boolean; ibd: boolean } | null;
    last_block: { height: number; time: number } | null;
    mempool_size: number | null;
    internet_state: string;
    api_available: boolean;
    geo_db_only_mode: boolean;
    node_traffic: NodeTraffic | null;
    node_metrics?: NodeMetrics;
    geo_db_stats: GeoStats;
    network_scores: Record<string, number | null> | null;
    network_details: Record<string, NetworkDetails> | null;
}
export type NodeAction = { type: 'refresh-peers' | 'intervals' } | { type: 'network'; network: string };
export interface NodeMetrics {
    uptime: string | null;
    uptime_sec: number | null;
    download_bytes: number | null;
    upload_bytes: number | null;
    rx_bps: number | null;
    tx_bps: number | null;
    ts: number;
}
export interface RecentBlocksResponse {
    success: boolean;
    error?: string;
    detail?: string;
    summary?: {
        chain?: string;
        tip_height?: number;
        count?: number;
        avg_size_mb?: number;
        avg_transactions?: number;
        total_transactions?: number;
        latest_time?: number;
    };
    blocks?: {
        height: number;
        hash: string;
        time: number;
        age_seconds: number | null;
        size: number;
        tx_count: number;
        version: number;
        difficulty: number;
    }[];
}
export interface ChainTipsResponse {
    success: boolean;
    error?: string;
    detail?: string;
    summary?: {
        chain?: string;
        best_height?: number;
        total?: number;
        active_count?: number;
        non_active_count?: number;
        fork_count?: number;
        latest_non_active_height?: number | null;
        latest_non_active_status?: string;
        best_hash?: string;
        age_lookup_limited?: boolean;
        age_lookup_limit?: number;
    };
    tips?: {
        status: string;
        status_label: string;
        height: number;
        branch_length: number;
        hash: string;
        time: number | null;
        age_seconds: number | null;
    }[];
}
export interface MempoolResponse {
    error?: string;
    mempool?: {
        size: number;
        bytes: number;
        usage: number;
        total_fee: number;
        maxmempool: number;
        mempoolminfee?: number;
        minrelaytxfee?: number;
        fullrbf?: boolean;
        unbroadcastcount?: number;
    };
}
export interface BlockchainResponse {
    error?: string;
    blockchain?: {
        chain: string;
        blocks: number;
        headers: number;
        bestblockhash: string;
        difficulty: number;
        mediantime: number;
        initialblockdownload: boolean;
        size_on_disk: number;
        pruned: boolean;
        softforks?: Record<string, { active: boolean; type: string }>;
    };
}

export interface BanEntry {
    address: string;
    ban_created: number;
    banned_until: number;
}
export interface ActionResponse {
    success: boolean;
    error?: string;
    banned_ip?: string;
}

export type DistributionSummaryData = ReturnType<typeof import('./distribution/data.js').computeSummaryData> & {
    quality: { word: string; cls: string };
};

export interface DistributionSummaryInteractionsOptions {
    state: Readonly<DistributionValues>;
    isReconciling(): boolean;
    getSummaryView(): ReturnType<typeof import('./distribution/summary-panel.js').create>;
    getGroups(): DistributionGroup[];
    actions: {
        previewCountry: (rowEl: HTMLElement) => void;
        restoreCountryPreview: () => void;
        selectCountryFromSummary: (rowEl: HTMLElement, bodyEl: HTMLElement, e: PointerEvent) => void;
        dismissPanelTooltips: (bodyEl: HTMLElement, e: PointerEvent) => void;
        previewNestedProvider: (provRow: HTMLElement) => void;
        selectNestedProvider: (provRow: HTMLElement, e: PointerEvent) => void;
        enterPrivateFromTooltip: (linkEl: HTMLElement, e: PointerEvent) => void;
        previewConnectionProvider: (rowEl: HTMLElement, buildProvPeerHtml: () => string | null, e: MouseEvent) => void;
        selectConnectionProvider: (rowEl: HTMLElement, buildProvPeerHtml: () => string | null, e: PointerEvent) => void;
        previewOutboundTypeGroup: (rowEl: HTMLElement, buildOutSubHtml: () => string | null, e: MouseEvent) => void;
        selectOutboundTypeGroup: (rowEl: HTMLElement, buildOutSubHtml: () => string | null, e: PointerEvent) => void;
        previewConnectionDirection: (rowEl: HTMLElement, buildDirPeerHtml: () => string | null, e: MouseEvent) => void;
        selectConnectionDirection: (rowEl: HTMLElement, buildDirPeerHtml: () => string | null, e: PointerEvent) => void;
        selectOtherProviders: (rowEl: HTMLElement, e: PointerEvent) => void;
        previewTooltipPeer: (row: HTMLElement) => void;
        restoreTooltipPeerPreview: () => void;
        selectPrimaryTooltipPeer: (link: HTMLElement, e: PointerEvent) => void;
        selectSecondaryTooltipPeer: (link: HTMLElement, e: PointerEvent) => void;
        clearLegendFocus: () => void;
        closePeerPopup: (skipZoomReset?: boolean | undefined) => void;
        insightAttachSummaryLinkHandlers: (bodyEl: HTMLElement) => void;
        navigateToProvider: (asNum: string) => void;
        peersByIds: (peerIds: number[], peers?: Peer[] | undefined) => Peer[];
        summaryApplySubFilter: (peerIds: number[], category: string, label: string) => void;
        summaryApplySummarySubFilter: (peerIds: number[], label: string) => void;
        summaryBuildPeerSummaryHtml: (peerIds: number[], category: string, label: string) => string;
        summaryClearSubFilter: () => void;
        summaryClearSummarySubFilter: () => void;
        summaryPreviewProviderLines: (peerIds: number[]) => void;
        summaryPreviewSummaryCenterText: (peerIds: number[], label: string) => void;
        summaryPreviewSummaryLines: (peerIds: number[]) => void;
        summaryRestoreDonutAfterPreview: () => void;
        summaryRestoreProviderFromPreview: () => void;
        summaryRestoreSummaryFromPreview: () => void;
        tooltipHideSubTooltip: () => void;
        tooltipIsPinnedTo: (element: HTMLElement) => boolean;
        tooltipPinSubTooltip: (srcEl: HTMLElement) => void;
        tooltipPositionSubTooltip: (event: MouseEvent) => void;
        tooltipShowSubTooltip: (html: string, event: MouseEvent) => void;
    };
}
export interface DistributionSummaryInteractions {
    summaryAttachCountrySummaryRowHandlers: (bodyEl: HTMLElement) => void;
    summaryAttachPanelBlankClickHandler: (bodyEl: HTMLElement) => void;
    summaryAttachInteractiveRowHandlers: (bodyEl: HTMLElement) => void;
    summaryAttachSummaryRowHandlers: (bodyEl: HTMLElement) => void;
    summaryAttachProviderClickHandlers: (tip: HTMLElement) => void;
    summaryAttachGridHandlers: (bodyEl: HTMLElement) => void;
    summaryAttachProviderNavHandlers: (tip: HTMLElement) => void;
    summaryAttachSummaryHandlers: (bodyEl: HTMLElement) => void;
    tooltipAttachPeerRowHoverHandlers: (tip: HTMLElement) => void;
    tooltipAttachSubTooltipHandlers: () => void;
    tooltipAttachSubSubTooltipHandlers: () => void;
}

export interface DistributionInsightInteractionsOptions {
    state: Readonly<DistributionValues>;
    getPanel(): HTMLElement | null;
    getDonut(): ReturnType<typeof import('./distribution/donut.js').create>;
    actions: {
        previewNavigationProvider: (el: HTMLElement) => void;
        selectAllProviders: (el: HTMLElement, e: PointerEvent) => void;
        selectHeaderProviders: (el: HTMLElement, e: PointerEvent) => void;
        previewFastestProviders: (e: MouseEvent) => void;
        selectFastestProviders: (fastestLink: HTMLElement | null, e: PointerEvent) => void;
        previewStablePeers: (stableLink: HTMLElement | null, e: MouseEvent) => void;
        selectStablePeers: (stableLink: HTMLElement | null, e: PointerEvent) => void;
        previewDataProviders: (field: 'bytesrecv' | 'bytessent', e: MouseEvent) => void;
        selectDataProviders: (el: HTMLElement, field: 'bytesrecv' | 'bytessent', e: PointerEvent) => void;
        enterPrivateFromSummary: (e: PointerEvent) => void;
        previewFastestProvider: (provRow: HTMLElement) => void;
        selectFastestProvider: (provRow: HTMLElement, e: PointerEvent) => void;
        previewDataProvider: (provRow: HTMLElement, field: string) => void;
        selectDataProvider: (provRow: HTMLElement, e: PointerEvent) => void;
        clearLegendFocus: () => void;
        hideInsightRect: () => void;
        navigateToProvider: (asNum: string) => void;
        restoreInsightRectProvider: () => void;
        summaryRestoreDonutAfterPreview: () => void;
        summaryRestoreSummaryFromPreview: () => void;
        tooltipHideSubTooltip: () => void;
    };
}
export interface DistributionInsightInteractions {
    insightAttachSummaryLinkHandlers: (bodyEl: HTMLElement) => void;
    insightAttachFastestProvRowHandlers: (tip: HTMLElement) => void;
    insightAttachDataProviderRowHandlers: (tip: HTMLElement, field: string) => void;
}

export interface DistributionTooltipsOptions {
    state: DistributionValues;
    getPanel(): HTMLElement | null;
    getSummaryView(): ReturnType<typeof import('./distribution/summary-panel.js').create>;
    actions: {
        clearSecondaryFilter(): void;
        aggregateProvidersForPeers(peers: Peer[]): SummaryProvider[];
        buildFastestProvHtml(): string | null;
        buildDataProviderHtml(
            field: string
        ): { html: string; insight: Extract<DistributionInsight, { type: 'data-providers' }> } | null;
        summaryAttachProviderClickHandlers(tip: HTMLElement): void;
        insightAttachFastestProvRowHandlers(tip: HTMLElement): void;
        insightAttachDataProviderRowHandlers(tip: HTMLElement, field: string): void;
        summaryAttachProviderNavHandlers(tip: HTMLElement): void;
        tooltipAttachSubSubTooltipHandlers: () => void;
        tooltipAttachSubTooltipHandlers: () => void;
    };
}
export interface DistributionTooltips {
    tooltipPinSecondary(): void;
    refreshPinned(context: DistributionTooltipRefresh): void;
    getRankedProvider(): { asNumber: string; peerIds: number[] } | null;
    tooltipIsPinnedTo: (element: HTMLElement) => boolean;
    tooltipShowSubTooltip: (html: string, event: MouseEvent) => void;
    tooltipPositionSubTooltip: (event: MouseEvent) => void;
    tooltipHideSubTooltip: () => void;
    tooltipPinSubTooltip: (srcEl: HTMLElement) => void;
    tooltipShowSubSubTooltip: (html: string, event: MouseEvent) => void;
    tooltipPositionSubSubTooltip: (event: MouseEvent) => void;
    tooltipHideSubSubTooltip: () => void;
    tooltipHighlightSelectedPeerRow: (peerId: number) => void;
    captureSource(): string | null;
    restoreSource(key: string | null): void;
    clearPeerHighlight(): void;
}

export interface DistributionTooltipRefresh {
    category: string | null;
    label: string;
    filtered: Peer[];
    secondary: string | null;
    secondaryPeers: Peer[] | null;
}

export interface DistributionNavigationOptions {
    getCountrySegments(): DistributionSegment[];
    state: DistributionValues;
    hooks: Partial<DistributionHooks>;
    getPanel(): HTMLElement | null;
    getContainer(): HTMLElement | null;
    getDonut(): ReturnType<typeof import('./distribution/donut.js').create>;
    areLegendsHidden(): boolean;
    getPeerDetail(): ReturnType<typeof import('./peers/detail.js').create>;
    getSegments(): DistributionSegment[];
    getGroups(): DistributionGroup[];
    getTooltips(): DistributionTooltips;
    getDashboard(): { readonly peers: Peer[]; readonly byId: Map<number, Peer> };
    getNetworkPanel(): typeof import('./distribution/network-panel.js');
    getSummaryView(): ReturnType<typeof import('./distribution/summary-panel.js').create>;
    actions: {
        insightAttachDataProviderRowHandlers: (tip: HTMLElement, field: string) => void;
        insightAttachFastestProvRowHandlers: (tip: HTMLElement) => void;
        animateDonutExpand: (asNum: string) => void;
        animateDonutRevert: () => void;
        buildDataProviderHtml: (field: string) => {
            html: string;
            insight: {
                type: 'data-providers';
                icon: string;
                label: string;
                topProviders: DataProvider[];
                field: 'bytesrecv' | 'bytessent';
            };
        } | null;
        buildFastestProvHtml: () => string | null;
        buildStablePeersHtml: () => { html: string; peerIds: number[]; asNum: string } | null;
        clearLegendHighlight: () => void;
        closePanel: () => void;
        computeSummaryData: () => DistributionSummaryData;
        findActiveSegment: (asNum: string) => DistributionSegment | null;
        findActiveSegmentOrGroup: (asNum: string) => DistributionSegment | null;
        getActiveSegments: () => DistributionSegment[];
        getActiveTotalPeers: () => number;
        getColorForActiveEntity: (asNum: string | null) => string;
        getColorForAsNum: (asNum: string | null) => string;
        getInsightDataForActive: () =>
            | {
                  provName: string;
                  asNumber: string;
                  peerIds: number[];
                  durText: string;
                  color: string;
                  avgPing?: undefined;
                  rank?: undefined;
                  totalBytes?: undefined;
              }
            | {
                  provName: string;
                  asNumber: string;
                  peerIds: number[];
                  avgPing: number;
                  rank: number;
                  color: string;
                  durText?: undefined;
                  totalBytes?: undefined;
              }
            | {
                  provName: string;
                  asNumber: string;
                  peerIds: number[];
                  totalBytes: number;
                  rank: number;
                  color: string;
                  durText?: undefined;
                  avgPing?: undefined;
              }
            | null;
        getPeerIdsForActiveEntity: (asNum: string) => number[];
        getPeerIdsForAnyAs: (asNum: string) => number[];
        hideInsightRect: () => void;
        highlightLegendItem: (asNum: string) => void;
        isCountryLens: () => boolean;
        isOthersSubProvider: (asNum: string) => boolean;
        peersByIds: (peerIds: number[], peers?: Peer[] | undefined) => Peer[];
        renderCenter: () => void;
        renderCountrySummaryPanel: () => void;
        renderDonut: () => void;
        renderLegend: () => void;
        renderPanel: (asNum: string) => void;
        renderSummaryPanel: () => void;
        restoreInsightRectProvider: () => void;
        showFocusedCenterText: (asNum: string | null) => void;
        showInsightRect: (type: string, data: InsightPresentation) => void;
        showLegendHoverCenterText: (asNum: string) => void;
        showPeerInDonutCenter: (peer: Peer, color: string) => void;
        stopDonutAnimation: () => void;
        summaryAttachProviderClickHandlers: (tip: HTMLElement) => void;
        summaryAttachProviderNavHandlers: (tip: HTMLElement) => void;
        summaryAttachSummaryHandlers: (bodyEl: HTMLElement) => void;
        summaryHighlightActiveSubRow: () => void;
        summaryHighlightActiveSummaryRow: () => void;
        tooltipAttachSubTooltipHandlers: () => void;
        tooltipHideSubSubTooltip: () => void;
        tooltipHideSubTooltip: () => void;
        tooltipHighlightSelectedPeerRow: (peerId: number) => void;
        tooltipIsPinnedTo: (element: HTMLElement) => boolean;
        tooltipPinSecondary: () => void;
        tooltipPinSubTooltip: (srcEl: HTMLElement) => void;
        tooltipShowSubSubTooltip: (html: string, event: MouseEvent) => void;
        tooltipShowSubTooltip: (html: string, event: MouseEvent) => void;
        updateInsightRectForPeer: (peer: Peer, provColor: string) => void;
        updateLensChrome: () => void;
    };
}
export interface DistributionNavigation {
    clearFocusedHover(): void;
    isReconciling(): boolean;
    isOthersListOpen(): boolean;
    clearSecondaryFilter(): void;
    setFilterDescriptor(descriptor: PeerFilter | null): void;
    closeActiveInsight: () => void;
    setLegendFocus: (asNum: string) => void;
    clearLegendFocus: () => void;
    selectSummary: () => void;
    deselectSummary: () => void;
    navigateToProvider: (asNum: string) => void;
    navigateBack: () => void;
    renderBackButton: () => void;
    onMapClick: () => boolean;
    backToOthersList: () => void;
    clearLegendHoverActive: () => void;
    showOthersListInDonut: () => void;
    closeOthersListInDonut: () => void;
    updateOthersPopupHighlight: () => void;
    onSegmentHover: (e: MouseEvent) => void;
    onSegmentLeave: () => void;
    activateHoverAll: () => void;
    deactivateHoverAll: () => void;
    onTitleEnter: () => void;
    onTitleLeave: () => void;
    onSegmentClick: (e: MouseEvent) => void;
    deselect: () => void;
    onKeyDown: (e: KeyboardEvent) => void;
    enterFocusedMode: () => void;
    exitFocusedMode: () => void;
    isFocusedMode: () => boolean;
    dismissPeerDetailView: (restoreFocus?: boolean | undefined) => void;
    previewPeerInPopup: (peer: Peer) => void;
    restorePeerPopupToSelected: () => void;
    closePeerPopup: (skipZoomReset?: boolean | undefined) => void;
    openMultiPeerPopup: (peerIds: number[]) => void;
    openPeerDetailPanel: (peer: Peer, source: string, groupPeerIds?: number[] | undefined) => void;
    clearSelectionForLensSwitch: () => void;
    setDistributionLens: (lens: string) => void;
    summaryOpenLensSummaryPanel: () => void;
    summaryOpenCountrySummaryPanel: () => void;
    summaryOpenSummaryPanel: () => void;
    openPanel: (asNum: string) => void;
    summaryRestoreDonutAfterPreview: () => void;
    summaryPreviewSummaryLines: (peerIds: number[]) => void;
    summaryPreviewProviderLines: (peerIds: number[]) => void;
    summaryPreviewSummaryCenterText: (peerIds: number[], label: string) => void;
    summaryRestoreSummaryFromPreview: () => void;
    summaryRestoreProviderFromPreview: () => void;
    summaryApplySummarySubFilter: (peerIds: number[], label: string) => void;
    summaryClearSummarySubFilter: () => void;
    summaryApplySubFilter: (peerIds: number[], category: string, label: string) => void;
    summaryClearSubFilter: () => void;
    refreshSelectionViews: () => void;
    openNetworkPanel: (netKey: string) => void;
    previewCountry: (rowEl: HTMLElement) => void;
    restoreCountryPreview: () => void;
    selectCountryFromSummary: (rowEl: HTMLElement, bodyEl: HTMLElement, e: PointerEvent) => void;
    dismissPanelTooltips: (bodyEl: HTMLElement, e: PointerEvent) => void;
    previewNestedProvider: (provRow: HTMLElement) => void;
    selectNestedProvider: (provRow: HTMLElement, e: PointerEvent) => void;
    enterPrivateFromTooltip: (linkEl: HTMLElement, e: PointerEvent) => void;
    previewConnectionProvider: (rowEl: HTMLElement, buildProvPeerHtml: () => string | null, e: MouseEvent) => void;
    selectConnectionProvider: (rowEl: HTMLElement, buildProvPeerHtml: () => string | null, e: PointerEvent) => void;
    previewOutboundTypeGroup: (rowEl: HTMLElement, buildOutSubHtml: () => string | null, e: MouseEvent) => void;
    selectOutboundTypeGroup: (rowEl: HTMLElement, buildOutSubHtml: () => string | null, e: PointerEvent) => void;
    previewConnectionDirection: (rowEl: HTMLElement, buildDirPeerHtml: () => string | null, e: MouseEvent) => void;
    selectConnectionDirection: (rowEl: HTMLElement, buildDirPeerHtml: () => string | null, e: PointerEvent) => void;
    selectOtherProviders: (rowEl: HTMLElement, e: PointerEvent) => void;
    previewTooltipPeer: (row: HTMLElement) => void;
    restoreTooltipPeerPreview: () => void;
    selectPrimaryTooltipPeer: (link: HTMLElement, e: PointerEvent) => void;
    selectSecondaryTooltipPeer: (link: HTMLElement, e: PointerEvent) => void;
    previewNavigationProvider: (el: HTMLElement) => void;
    selectAllProviders: (el: HTMLElement, e: PointerEvent) => void;
    selectHeaderProviders: (el: HTMLElement, e: PointerEvent) => void;
    previewFastestProviders: (e: MouseEvent) => void;
    selectFastestProviders: (fastestLink: HTMLElement | null, e: PointerEvent) => void;
    previewStablePeers: (stableLink: HTMLElement | null, e: MouseEvent) => void;
    selectStablePeers: (stableLink: HTMLElement | null, e: PointerEvent) => void;
    previewDataProviders: (field: 'bytesrecv' | 'bytessent', e: MouseEvent) => void;
    selectDataProviders: (el: HTMLElement, field: 'bytesrecv' | 'bytessent', e: PointerEvent) => void;
    enterPrivateFromSummary: (e: PointerEvent) => void;
    previewFastestProvider: (provRow: HTMLElement) => void;
    selectFastestProvider: (provRow: HTMLElement, e: PointerEvent) => void;
    previewDataProvider: (provRow: HTMLElement, field: string) => void;
    selectDataProvider: (provRow: HTMLElement, e: PointerEvent) => void;
}

export interface MapTooltipOptions {
    element: HTMLElement;
    getWidth(): number;
    networkLabels: Readonly<Record<string, string>>;
    rgba(color: RGB, alpha: number): string;
    onCloseGroup(): void;
    onSelectPeer(peerId: number, privateGroup: boolean): void;
    onBack(hasBackNav: boolean, mx: number, my: number): void;
    onDisconnect(peerId: number, network: string): void;
}

export interface PeerCameraOptions {
    width: number;
    height: number;
    panelCollapsed: boolean;
    maxZoom: number;
}
export interface MapNavigationOptions {
    interaction: MapInteraction;
    view: Camera;
    target: Camera;
    maxZoom: number;
    getNodes(): MapNode[];
    getPeer(peerId: number): Peer | undefined;
    getSize(): { width: number; height: number };
    isPanelCollapsed(): boolean;
    collapsePanel(): void;
    getWrapOffsets(): number[];
    worldToScreen(lon: number, lat: number): Point;
    screenToWorld(x: number, y: number): { lon: number; lat: number };
    findNodesAtScreen(x: number, y: number): MapNode[];
    tooltips: ReturnType<typeof import('./map/tooltips.js').create>;
    renderTable(): void;
    highlightRow(peerId: number | null, scrollIntoView?: boolean): void;
    openPeerDetail(peer: Peer, source: string, groupPeerIds?: number[]): boolean;
    closePeerPopup(): void;
    isPeerDetailActive(): boolean;
    onMapClick(): boolean;
    getProviderColor(provider: string): string | null;
    isPrivateMode(): boolean;
    enterPrivateMode(peerId: number): void;
    selectPrivatePeer(peerId: number): void;
    clearPrivatePeer(): void;
    schedule?: (callback: () => void, delay: number) => number;
    cancelScheduled?: (timer: number) => void;
}
