/* ============================================================
   Bitcoin Peer Map — Canvas World Map with Real Bitcoin Peers
   Interaction Stabilization Pass
   ============================================================
   - Fetches real peers from the existing server backend
   - Renders them on a canvas world map (no Leaflet)
   - Private/overlay networks (Tor, I2P, CJDNS) placed in Antarctica
   - Visual peer lifecycle: arrival bloom → age brightness → fade-out
   - Inbound vs outbound peers have distinct pulse rhythms
   - Long-lived peers glow bright & steady; fresh peers dim & nervous
   - Rich hover tooltip with identity, location, network, performance
   - Collapsible bottom panel with full peer table
   - Bidirectional highlight: hover map node ↔ table row
   - Click table row → center map on that peer
   - Peer actions: disconnect, ban (24h)
   - Network badge click-to-filter + hover stats popover
   - Horizontal world wrapping (seamless pan)
   - Vertical lock at zoom 1, vertical clamping at all zooms
   - Antarctica annotation for private network peers
   ============================================================ */

(function () {
    'use strict';

    const STORAGE_KEYS = Object.freeze({
        theme: 'bpm.theme',
        peerTableDisplay: 'bpm.peerTable.display',
        antarcticaDisclaimerSeen: 'bpm.antarcticaDisclaimerSeen',
    });
    const repositoryUrl = document.body.dataset.repositoryUrl;
    const repositoryDiscussionsUrl = `${repositoryUrl}/discussions`;
    const assetRevision = document.body.dataset.assetRevision;
    const mrow = window.BPMModal.row;

    function staticAssetUrl(filename) {
        return `/static/assets/${filename}?v=${encodeURIComponent(assetRevision)}`;
    }

    async function fetchStaticJson(filename) {
        const response = await fetch(staticAssetUrl(filename));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }

    // ═══════════════════════════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════════════════════════

    const CFG = {
        pollInterval: 10000,       // ms between /api/peers fetches
        infoPollInterval: 15000,   // ms between /api/info fetches
        nodeRadius: 3,             // base circle radius in px
        glowRadius: 14,            // outer glow radius in px
        fadeInDuration: 800,       // ms for opacity fade-in
        fadeOutDuration: 1500,     // ms for disconnected node fade-out
        minZoom: 1,
        maxZoom: 18,
        zoomStep: 1.15,
        panSmooth: 0.12,           // smoothing factor for view interpolation
        gridSpacing: 30,           // degrees between grid lines
        coastlineWidth: 1.0,

        // ── Arrival bloom (first ~5 seconds) ──
        arrivalDuration: 5000,     // ms — how long the arrival phase lasts
        arrivalRingMaxRadius: 28,  // px — expanding ring max radius
        arrivalRingDuration: 1200, // ms — how long the ring expansion takes
        arrivalPulseSpeed: 0.006,  // fast energetic pulse during arrival

        // ── Connection age -> brightness & steadiness ──
        ageBrightnessMin: 0.35,    // floor opacity for brand-new peers
        ageBrightnessMax: 1.0,     // ceiling opacity for veteran peers
        ageRampSeconds: 3600,      // seconds to go from min to max brightness (1 hour)

        // ── Pulse behaviour by direction ──
        // Base rates — new peers get additional "nervousness" on top
        pulseSpeedInbound: 0.0014,   // slower, calm breathing for inbound
        pulseSpeedOutbound: 0.0026,  // faster, sharper pulse for outbound
        pulseDepthInbound: 0.32,     // gentle but visible amplitude for inbound
        pulseDepthOutbound: 0.48,    // more pronounced for outbound
        // Nervousness: young peers pulse faster, veterans are steady
        nervousnessMax: 0.003,     // extra pulse speed added to young peers
        nervousnessRampSec: 1800,  // seconds for nervousness to decay to zero (30 min)

        // ── Ambient shimmer (residual twinkle for veteran peers) ──
        // Three sine waves at incommensurate frequencies; when they align
        // positively a peer gets a brief bright "twinkle."  Each node's
        // unique phase keeps the sparkles scattered across the map.
        shimmerStrength: 0.36,     // how bright the twinkle spikes get (0 = off)
        shimmerFreq1: 0.00293,    // primary wave   (period ≈ 2.1 s)
        shimmerFreq2: 0.00517,    // secondary wave  (period ≈ 1.2 s)
        shimmerFreq3: 0.00711,    // tertiary wave   (period ≈ 0.88 s)

        // ── Fade-out ──
        fadeOutEase: 2.0,          // exponent for ease-out curve
    };

    // ═══════════════════════════════════════════════════════════
    // ADVANCED DISPLAY SETTINGS — tuneable from the floating panel
    // Persisted to localStorage when user clicks "Save".
    // Defaults restore the map to its original pre-shimmer appearance.
    // ═══════════════════════════════════════════════════════════

    const ADV_DEFAULTS = {
        // Peer effects (defaults = original values before shimmer was added)
        shimmerStrength: 0.09,       // subtle ambient twinkle
        pulseDepthIn:    0.4,        // inbound pulse amplitude
        pulseDepthOut:   0.48,       // outbound pulse amplitude
        pulseSpeedIn:    50,         // slider 0-100, 50 = original speed
        pulseSpeedOut:   50,         // slider 0-100, 50 = original speed
        // AS Distribution line settings
        asLineWidth:     40,         // slider 0-100, 40 = ~1.8px (default — visible)
        asLineFan:       50,         // slider 0-100, 50 = 35% spread (default)
        // Land appearance
        landHue:        215,         // hue degrees (current dark blue-gray)
        landBright:      50,         // slider 0-100, 50 = original L=12%
        snowPoles:       0,          // slider 0-100, 0 = off, 100 = full ice
        // Ocean appearance
        oceanHue:       220,         // hue degrees (current near-black blue)
        oceanBright:     50,         // slider 0-100, 50 = original L=3.5%
        oceanLightBlue: false,       // light blue preset active
        // Grid lines
        gridVisible:    true,
        gridThickness:   50,         // slider 0-100, 50 = default 0.5 lineWidth
        gridHue:        212,         // hue degrees (accent blue)
        gridBright:      50,         // slider 0-100, 50 = default alpha 0.04
        // Borders
        borderScale:     50,         // slider 0-100, 50 = current size; scales country+state borders
        borderHue:      212,         // hue degrees (accent blue, matches grid default)
        // HUD overlay backgrounds
        hudSolidBg:    false,        // when true, HUD overlays get semi-opaque backgrounds
        // Donut legend display
        showDonutLegends: false,     // when true, top-8 ISP and network lists animate on donut hover
    };

    // ═══════════════════════════════════════════════════════════
    // THEME DEFINITIONS
    // Each theme provides CSS variable overrides and map defaults.
    // The 'dark' theme uses the original CSS values (no overrides).
    // ═══════════════════════════════════════════════════════════

    const THEMES = {
        dark: {
            label: 'Dark',
            dot: '#0a0e14',
            desc: 'The original dark canvas dashboard. Ideal for low-light environments.',
            cssVars: {},   // empty = CSS defaults (the dark theme IS the default)
            advOverrides: {},
            nodeHighlight: { r: 255, g: 255, b: 255 },
            netColors: null,  // null = use default NET_COLORS
        },
        light: {
            label: 'Light',
            dot: '#e4e8ec',
            desc: 'Bright, clean interface with green land and blue ocean. Best for well-lit rooms.',
            cssVars: {
                '--bg-void':        '#e4e8ec',
                '--bg-deep':        '#edf0f4',
                '--bg-surface':     '#ffffff',
                '--bg-raised':      '#f4f6f8',
                '--surface-overlay-rgb': '240, 242, 248',
                '--bg-surface-rgb': '255, 255, 255',
                '--text-primary':   '#1a1f36',
                '--text-secondary': '#4a5568',
                '--text-muted':     '#718096',
                '--text-dim':       '#a0aec0',
                '--accent':         '#2563eb',
                '--accent-dim':     '#93b4f5',
                '--accent-glow':    'rgba(37, 99, 235, 0.20)',
                '--net-ipv4':       '#a67c00',
                '--net-ipv6':       '#c2343f',
                '--net-tor':        '#0d47a1',
                '--net-i2p':        '#6d28d9',
                '--net-cjdns':      '#7e22ce',
                '--net-unknown':    '#718096',
                '--ok':             '#16a34a',
                '--ok-bright':      '#15803d',
                '--warn':           '#b45309',
                '--err':            '#dc2626',
                '--err-bright':     '#b91c1c',
                '--map-land':       '#c8d5c0',
                '--map-border':     '#8a9bb0',
                '--map-grid':       'rgba(37, 99, 235, 0.08)',
                '--title-accent':   '#9a7b1a',
                '--section-color':  '#5a6570',
                '--logo-primary':   '#2b5ea0',
                '--logo-accent':    '#1a7a9e',
                '--peer-panel-bg':  'rgba(255, 255, 255, 0.95)',
                '--peer-panel-blur': 'none',
            },
            advOverrides: {
                landHue:     120,
                landBright:  82,
                oceanHue:    210,     // center of light-blue range (190-230)
                oceanBright: 50,      // midpoint = soft sky blue
                gridHue:     220,
                gridBright:  45,
                borderHue:   215,
                snowPoles:   94,
            },
            oceanLightBlue: true,  // light blue ocean preset enabled by default
            hudSolidBg: true,      // solid HUD backgrounds for readability on light ocean
            nodeHighlight: { r: 30, g: 30, b: 30 },
            netColors: {
                ipv4:  { r: 166, g: 124, b: 0   },
                ipv6:  { r: 194, g: 52,  b: 63  },
                onion: { r: 13,  g: 71,  b: 161 },
                i2p:   { r: 109, g: 40,  b: 217 },
                cjdns: { r: 126, g: 34,  b: 206 },
            },
            netColorUnknown: { r: 100, g: 110, b: 130 },
        },
        oled: {
            label: 'OLED',
            dot: '#000000',
            desc: 'Pure black for OLED screens. Maximum contrast, minimum power draw.',
            cssVars: {
                '--bg-void':        '#000000',
                '--bg-deep':        '#030303',
                '--bg-surface':     '#0a0a0a',
                '--bg-raised':      '#111111',
                '--surface-overlay-rgb': '0, 0, 0',
                '--bg-surface-rgb': '10, 10, 10',
                '--map-land':       '#0a0a0a',
                '--map-border':     '#1a1a1a',
                '--map-grid':       'rgba(88, 166, 255, 0.025)',
            },
            advOverrides: {
                landHue:     0,
                landBright:  18,
                oceanHue:    0,
                oceanBright: 5,
                gridBright:  35,
            },
            nodeHighlight: { r: 255, g: 255, b: 255 },
            netColors: null,
        },
        midnight: {
            label: 'Midnight',
            dot: '#111b38',
            desc: 'Deep indigo-blue tones with purple accents. Rich and atmospheric.',
            cssVars: {
                '--bg-void':        '#060b1a',
                '--bg-deep':        '#0b1226',
                '--bg-surface':     '#111b38',
                '--bg-raised':      '#192448',
                '--surface-overlay-rgb': '8, 14, 32',
                '--bg-surface-rgb': '17, 27, 56',
                '--text-primary':   '#d0dbf0',
                '--text-secondary': '#7e90b8',
                '--text-muted':     '#566988',
                '--text-dim':       '#3a4d6e',
                '--accent':         '#818cf8',
                '--accent-dim':     '#4f46e5',
                '--accent-glow':    'rgba(129, 140, 248, 0.30)',
                '--net-ipv4':       '#fbbf24',
                '--net-ipv6':       '#fb7185',
                '--net-tor':        '#2979ff',
                '--net-i2p':        '#a78bfa',
                '--net-cjdns':      '#c4b5fd',
                '--net-unknown':    '#566988',
                '--ok':             '#34d399',
                '--ok-bright':      '#6ee7b7',
                '--warn':           '#fbbf24',
                '--err':            '#f87171',
                '--err-bright':     '#fca5a5',
                '--map-land':       '#111b38',
                '--map-border':     '#283a60',
                '--map-grid':       'rgba(129, 140, 248, 0.04)',
                '--title-accent':   '#c9a83e',
                '--section-color':  '#7e90b8',
                '--logo-primary':   '#818cf8',
                '--logo-accent':    '#a5b4fc',
            },
            advOverrides: {
                landHue:     230,
                landBright:  45,
                oceanHue:    235,
                oceanBright: 38,
                gridHue:     245,
                gridBright:  48,
                borderHue:   240,
            },
            nodeHighlight: { r: 255, g: 255, b: 255 },
            netColors: {
                ipv4:  { r: 251, g: 191, b: 36  },
                ipv6:  { r: 251, g: 113, b: 133 },
                onion: { r: 41,  g: 121, b: 255 },
                i2p:   { r: 167, g: 139, b: 250 },
                cjdns: { r: 196, g: 181, b: 253 },
            },
            netColorUnknown: null,
        },
    };

    // Current active theme name
    let currentTheme = 'dark';

    // Node centre highlight colour (white for dark themes, dark for light themes)
    let nodeHighlightColor = { r: 255, g: 255, b: 255 };

    // Canvas text label colours — adapted per theme for readability on map
    const canvasLabelColors = {
        countryShadow: '6,8,12',      // dark shadow behind country names
        countryText:   '200,210,225',  // country name fill
        stateText:     '140,160,190',  // state/province name fill
        cityDot:       '212,218,228',  // city marker dot
        cityText:      '212,218,228',  // city name fill
    };
    const CANVAS_LABEL_DARK = {
        countryShadow: '6,8,12',
        countryText:   '200,210,225',
        stateText:     '140,160,190',
        cityDot:       '212,218,228',
        cityText:      '212,218,228',
    };
    const CANVAS_LABEL_LIGHT = {
        countryShadow: '255,255,255',
        countryText:   '40,50,65',
        stateText:     '70,80,100',
        cityDot:       '50,55,65',
        cityText:      '50,55,65',
    };
    const CANVAS_LABEL_MIDNIGHT = {
        countryShadow: '6,10,25',
        countryText:   '160,175,210',
        stateText:     '120,140,175',
        cityDot:       '170,180,200',
        cityText:      '170,180,200',
    };

    // Original CSS variable values from :root (captured once on init for 'dark' theme reset)
    const DARK_CSS_VARS = {};

    /** Apply a theme by name. Updates CSS variables, map defaults, and network colours.
     *  opts.preserveAdvSettings — when true, skip overwriting map slider values
     *  (used on init to respect user's permanently saved settings). */
    function applyTheme(themeName, opts) {
        const theme = THEMES[themeName];
        if (!theme) return;
        currentTheme = themeName;

        const root = document.documentElement;

        // 1. Reset all CSS vars to dark defaults first (clear any previous theme overrides)
        for (const prop of Object.keys(DARK_CSS_VARS)) {
            root.style.removeProperty(prop);
        }
        // Clear any previous theme overrides that aren't in DARK_CSS_VARS
        for (const t of Object.values(THEMES)) {
            for (const prop of Object.keys(t.cssVars)) {
                root.style.removeProperty(prop);
            }
        }

        // 2. Apply theme CSS variable overrides
        for (const [prop, value] of Object.entries(theme.cssVars)) {
            root.style.setProperty(prop, value);
        }

        // 2b. Toggle light-theme body class (used for HUD shadow overrides)
        document.body.classList.toggle('theme-light', themeName === 'light');

        // 3. Update node highlight colour
        nodeHighlightColor = theme.nodeHighlight || { r: 255, g: 255, b: 255 };

        // 3b. Update canvas text label colours
        const labelMap = { light: CANVAS_LABEL_LIGHT, midnight: CANVAS_LABEL_MIDNIGHT };
        const labelSet = labelMap[themeName] || CANVAS_LABEL_DARK;
        Object.assign(canvasLabelColors, labelSet);

        // 4. Apply map appearance overrides to advSettings
        //    Skip when preserveAdvSettings is set (init with saved settings — don't
        //    let the theme stomp over the user's permanently saved slider values).
        if (!(opts && opts.preserveAdvSettings)) {
            const mapKeys = ['landHue', 'landBright', 'oceanHue', 'oceanBright',
                             'gridHue', 'gridBright', 'borderHue', 'gridThickness', 'borderScale',
                             'snowPoles'];
            for (const k of mapKeys) {
                advSettings[k] = (theme.advOverrides[k] !== undefined) ? theme.advOverrides[k] : ADV_DEFAULTS[k];
            }
            // Ocean light blue preset flag
            advSettings.oceanLightBlue = !!theme.oceanLightBlue;
            // HUD solid background flag
            advSettings.hudSolidBg = !!theme.hudSolidBg;
        }
        applyHudSolidBg();
        updateAdvColors();

        // 5. Update NET_COLORS for canvas rendering if theme provides overrides
        if (theme.netColors) {
            for (const [net, c] of Object.entries(theme.netColors)) {
                NET_COLORS[net] = c;
            }
        } else {
            // Reset to dark defaults
            NET_COLORS.ipv4  = { r: 227, g: 179, b: 65  };
            NET_COLORS.ipv6  = { r: 240, g: 113, b: 120 };
            NET_COLORS.onion = { r: 74,  g: 158, b: 255 };
            NET_COLORS.i2p   = { r: 139, g: 92,  b: 246 };
            NET_COLORS.cjdns = { r: 210, g: 168, b: 255 };
        }
        if (theme.netColorUnknown) {
            NET_COLOR_UNKNOWN.r = theme.netColorUnknown.r;
            NET_COLOR_UNKNOWN.g = theme.netColorUnknown.g;
            NET_COLOR_UNKNOWN.b = theme.netColorUnknown.b;
        } else {
            NET_COLOR_UNKNOWN.r = 120; NET_COLOR_UNKNOWN.g = 130; NET_COLOR_UNKNOWN.b = 140;
        }

        // 6. Re-colour existing nodes to match new theme NET_COLORS
        for (const node of nodes) {
            node.color = NET_COLORS[node.net] || NET_COLOR_UNKNOWN;
        }

        // 7. Refresh advanced panel if open
        if (advPanelEl) {
            syncOceanPresetUI();
            refreshAllAdvSliders();
            // Sync HUD solid checkbox
            const hsc = document.getElementById('adv-hud-solid');
            if (hsc) hsc.checked = advSettings.hudSolidBg;
            // Update dropdown display
            const label = document.getElementById('adv-theme-current');
            if (label) label.textContent = theme.label;
            const list = document.getElementById('adv-theme-list');
            if (list) {
                list.querySelectorAll('.adv-theme-option').forEach(o => {
                    o.classList.toggle('active', o.dataset.theme === themeName);
                });
            }
        }
    }

    /** Capture current :root CSS variable values as the 'dark' theme baseline */
    function captureDarkDefaults() {
        const style = getComputedStyle(document.documentElement);
        const varsToCapture = [
            '--bg-void', '--bg-deep', '--bg-surface', '--bg-raised',
            '--surface-overlay-rgb', '--bg-surface-rgb',
            '--text-primary', '--text-secondary', '--text-muted', '--text-dim',
            '--accent', '--accent-dim', '--accent-glow',
            '--net-ipv4', '--net-ipv6', '--net-tor', '--net-i2p', '--net-cjdns', '--net-unknown',
            '--ok', '--ok-bright', '--warn', '--err', '--err-bright',
            '--map-land', '--map-border', '--map-grid',
            '--title-accent', '--section-color', '--logo-primary', '--logo-accent',
            '--peer-panel-bg', '--peer-panel-blur',
        ];
        for (const v of varsToCapture) {
            DARK_CSS_VARS[v] = style.getPropertyValue(v).trim();
        }
    }

    /** Save theme choice to localStorage */
    function saveTheme() {
        try { localStorage.setItem(STORAGE_KEYS.theme, currentTheme); } catch (e) { /* ignore */ }
    }

    /** Load theme from localStorage and apply it.
     *  If the user has permanently saved adv settings, preserve those slider
     *  values instead of letting the theme overwrite them with its defaults. */
    function loadTheme() {
        try {
            const saved = localStorage.getItem(STORAGE_KEYS.theme);
            if (saved && THEMES[saved]) {
                const savedDisplay = readSavedDisplaySettings();
                const hasSavedAdv = Object.keys(ADV_DEFAULTS).some(k => savedDisplay[k] !== undefined);
                applyTheme(saved, hasSavedAdv ? { preserveAdvSettings: true } : undefined);
            }
        } catch (e) { /* ignore */ }
    }

    // Working copy of advanced settings (mutated by sliders, saved to localStorage)
    const advSettings = Object.assign({}, ADV_DEFAULTS);

    // Pre-computed colour strings, updated whenever a slider changes
    const advColors = {
        landFill:   '#151d28',
        landStroke: '#253040',
        iceFill:    'hsl(210, 15%, 82%)',
        iceStroke:  'hsl(210, 12%, 65%)',
        oceanFill:  '#06080c',
        lakeFill:   '#06080c',
        lakeStroke: '#1a2230',
        gridColor:  'rgba(88,166,255,0.04)',
        gridWidth:  0.5,
        borderRGB:  '88,166,255',   // border colour as r,g,b for rgba()
    };

    // Polar polygon classification (populated when world geometry loads)
    let polarPolygons = [];
    let nonPolarPolygons = [];

    /** Map brightness slider (0-100, centered at 50) to HSL lightness */
    function brightnessToL(slider, defaultL) {
        return defaultL * Math.pow(2, (slider - 50) / 25);
    }

    /** Rebuild advColors from current advSettings */
    function updateAdvColors() {
        // Land
        const ll = Math.max(0.5, Math.min(60, brightnessToL(advSettings.landBright, 12)));
        advColors.landFill   = 'hsl(' + advSettings.landHue + ', 31%, ' + ll.toFixed(1) + '%)';
        advColors.landStroke = 'hsl(' + advSettings.landHue + ', 25%, ' + Math.min(70, ll + 8).toFixed(1) + '%)';

        // Ocean
        if (advSettings.oceanLightBlue) {
            // Light Blue mode: soft sky-blue ocean
            // Hue is constrained to 190-230 by the slider, brightness 0-100 maps to L 75%→50%
            const lbHue = advSettings.oceanHue;  // already in 190-230 range
            const lbL   = 75 - (advSettings.oceanBright / 100) * 25;  // 75% (pale) → 50% (medium)
            const lbS   = 48 + (advSettings.oceanBright / 100) * 12;  // 48-60% saturation
            advColors.oceanFill  = 'hsl(' + lbHue + ', ' + lbS.toFixed(1) + '%, ' + lbL.toFixed(1) + '%)';
            advColors.lakeFill   = advColors.oceanFill;
            advColors.lakeStroke = 'hsl(' + lbHue + ', ' + Math.max(30, lbS - 10).toFixed(1) + '%, ' + Math.max(40, lbL - 8).toFixed(1) + '%)';
        } else {
            // Original mode: near-black ocean with full hue range
            const ol = Math.max(0.2, Math.min(30, brightnessToL(advSettings.oceanBright, 3.5)));
            advColors.oceanFill  = 'hsl(' + advSettings.oceanHue + ', 33%, ' + ol.toFixed(1) + '%)';
            advColors.lakeFill   = advColors.oceanFill;
            advColors.lakeStroke = 'hsl(' + advSettings.oceanHue + ', 25%, ' + Math.min(40, ol + 10).toFixed(1) + '%)';
        }
        // Grid — alpha range: 0.005 (slider=0) to 0.04 (slider=50) to 0.35 (slider=100)
        const ga = Math.min(0.5, 0.04 * Math.pow(2, (advSettings.gridBright - 50) / 18));
        advColors.gridColor = 'hsla(' + advSettings.gridHue + ', 100%, 67%, ' + ga.toFixed(4) + ')';
        advColors.gridWidth = 0.2 + (advSettings.gridThickness / 100) * 1.8;

        // Borders — convert hue to r,g,b at S=100%, L=67% (same as accent blue default)
        advColors.borderRGB = hslToRgbStr(advSettings.borderHue, 100, 67);

        // Ice (constant cool gray)
        advColors.iceFill   = 'hsl(210, 15%, 82%)';
        advColors.iceStroke = 'hsl(210, 12%, 65%)';

        markBasemapDirty();
    }

    /** Toggle solid backgrounds on HUD overlays (map-overlay, flight-deck, btc-price-bar, right-overlay) */
    function applyHudSolidBg() {
        document.body.classList.toggle('hud-solid', !!advSettings.hudSolidBg);
    }

    /** Convert HSL to "r,g,b" string for use in rgba() */
    function hslToRgbStr(h, s, l) {
        s /= 100; l /= 100;
        const a = s * Math.min(l, 1 - l);
        const f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
        return Math.round(f(0) * 255) + ',' + Math.round(f(8) * 255) + ',' + Math.round(f(4) * 255);
    }

    /** Classify world polygons into polar vs non-polar for "Snow the Poles" */
    function classifyPolarPolygons() {
        polarPolygons = [];
        nonPolarPolygons = [];
        for (let i = 0; i < worldPolygons.length; i++) {
            const ring = worldPolygons[i][0];
            if (!ring || ring.length === 0) { nonPolarPolygons.push(worldPolygons[i]); continue; }
            let sumLat = 0;
            for (let j = 0; j < ring.length; j++) sumLat += ring[j][1];
            const avgLat = sumLat / ring.length;
            if (avgLat < -60 || avgLat > 66) polarPolygons.push(worldPolygons[i]);
            else nonPolarPolygons.push(worldPolygons[i]);
        }
    }

    function readSavedDisplaySettings() {
        try {
            const raw = localStorage.getItem(STORAGE_KEYS.peerTableDisplay);
            if (raw) {
                const saved = JSON.parse(raw);
                if (saved && typeof saved === 'object' && !Array.isArray(saved)) return saved;
            }
        } catch (e) { /* ignore corrupt data */ }
        return {};
    }

    function writeSavedDisplaySettings(settings) {
        try {
            localStorage.setItem(STORAGE_KEYS.peerTableDisplay, JSON.stringify(settings));
        } catch (e) { /* quota exceeded, silently fail */ }
    }

    /** Load saved settings from localStorage */
    function loadAdvSettings() {
        const saved = readSavedDisplaySettings();
        for (const k of Object.keys(ADV_DEFAULTS)) {
            if (saved[k] !== undefined) advSettings[k] = saved[k];
        }
        // Always sync CFG from advSettings (whether loaded or defaults)
        CFG.shimmerStrength    = advSettings.shimmerStrength;
        CFG.pulseDepthInbound  = advSettings.pulseDepthIn;
        CFG.pulseDepthOutbound = advSettings.pulseDepthOut;
        CFG.pulseSpeedInbound  = 0.0014 * Math.pow(2, (advSettings.pulseSpeedIn - 50) / 30);
        CFG.pulseSpeedOutbound = 0.0026 * Math.pow(2, (advSettings.pulseSpeedOut - 50) / 30);
        updateAdvColors();
    }

    /** Save current settings to localStorage */
    function saveAdvSettings() {
        writeSavedDisplaySettings(Object.assign(
            {},
            readSavedDisplaySettings(),
            advSettings,
            currentTableDisplaySettings()
        ));
    }

    // ═══════════════════════════════════════════════════════════
    // NETWORK COLOURS (match app.css --net-* variables)
    // ═══════════════════════════════════════════════════════════

    const NET_COLORS = {
        ipv4:  { r: 227, g: 179, b: 65  },   // gold
        ipv6:  { r: 240, g: 113, b: 120 },   // coral
        onion: { r: 21,  g: 101, b: 192 },   // dark blue (Tor)
        i2p:   { r: 139, g: 92,  b: 246 },   // purple
        cjdns: { r: 210, g: 168, b: 255 },   // lavender
    };
    // Fallback colour for unknown network types
    const NET_COLOR_UNKNOWN = { r: 120, g: 130, b: 140 };

    // Map internal network names to display-friendly labels
    const NET_DISPLAY = {
        ipv4: 'IPv4', ipv6: 'IPv6', onion: 'Tor', i2p: 'I2P', cjdns: 'CJDNS',
    };

    // Bitcoin protocol service flag abbreviations and descriptions
    const SERVICE_FLAGS = {
        'NETWORK':          { abbr: 'N',  label: 'Full chain history', rpc: 'NODE_NETWORK' },
        'WITNESS':          { abbr: 'W',  label: 'Segregated Witness', rpc: 'NODE_WITNESS' },
        'NETWORK_LIMITED':  { abbr: 'NL', label: 'Limited chain history', rpc: 'NODE_NETWORK_LIMITED' },
        'P2P_V2':           { abbr: 'P',  label: 'BIP324 v2 transport', rpc: 'P2P_V2' },
        'COMPACT_FILTERS':  { abbr: 'CF', label: 'Compact block filters', rpc: 'NODE_COMPACT_FILTERS' },
        'BLOOM':            { abbr: 'B',  label: 'Bloom filters', rpc: 'NODE_BLOOM' },
    };

    function serviceFlagDescription(flag) {
        return flag.rpc ? `${flag.label} (${flag.rpc})` : flag.label;
    }

    /** Build unique short abbreviation string from services array */
    function serviceAbbrev(services) {
        if (!services || !services.length) return '\u2014';
        return services.map(s => (SERVICE_FLAGS[s] ? SERVICE_FLAGS[s].abbr : s.charAt(0))).join(' ');
    }

    /** Build full hover description from services array */
    function serviceHover(services) {
        if (!services || !services.length) return 'No service flags';
        return services.map(s => {
            const f = SERVICE_FLAGS[s];
            return f ? `${f.abbr} = ${serviceFlagDescription(f)}` : s;
        }).join('\n');
    }

    function escapeServiceHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[ch]));
    }

    function serviceFlagFromAbbr(abbr) {
        for (const flag of Object.values(SERVICE_FLAGS)) {
            if (flag.abbr === abbr) return flag;
        }
        return null;
    }

    function renderServiceFlagList(abbrev) {
        if (!abbrev || abbrev === '\u2014') return '\u2014';
        const flags = abbrev.split(/\s+/).map(f => f.trim()).filter(Boolean);
        if (!flags.length) return '\u2014';

        return '<div class="service-flag-list">'
            + flags.map(abbr => {
                const flag = serviceFlagFromAbbr(abbr);
                const label = flag ? flag.label : 'Unknown service flag';
                const rpc = flag ? flag.rpc : abbr;
                const title = flag ? serviceFlagDescription(flag) : abbr;
                return '<div class="service-flag-row" title="' + escapeServiceHtml(title) + '">'
                    + '<span class="service-flag-abbr">' + escapeServiceHtml(abbr) + '</span>'
                    + '<span class="service-flag-label">' + escapeServiceHtml(label) + '</span>'
                    + '<span class="service-flag-rpc">' + escapeServiceHtml(rpc) + '</span>'
                    + '</div>';
            }).join('')
            + '</div>';
    }

    // ═══════════════════════════════════════════════════════════
    // ANTARCTICA RESEARCH STATIONS
    // Private/overlay peers get placed here (same stations as v5)
    // ═══════════════════════════════════════════════════════════

    const ANTARCTICA_STATIONS = [
        { lat: -67.6020, lon: 62.8730  },  // Mawson Station
        { lat: -68.5760, lon: 77.9670  },  // Davis Station
        { lat: -66.2810, lon: 110.5280 },  // Casey Station
        { lat: -66.6630, lon: 140.0010 },  // Dumont d'Urville
        { lat: -69.0050, lon: 39.5800  },  // Syowa Station
        { lat: -70.6670, lon: 11.6330  },  // Novolazarevskaya
        { lat: -70.7500, lon: -8.2500  },  // Neumayer Station
        { lat: -70.4500, lon: -2.8420  },  // SANAE IV Station
    ];

    // Cache so each peer always lands on the same Antarctica spot
    const antarcticaCache = {};

    // ═══════════════════════════════════════════════════════════
    // CANVAS & VIEW STATE
    // ═══════════════════════════════════════════════════════════

    const basemapCanvas = document.getElementById('basemap');
    const baseCtx = basemapCanvas.getContext('2d', { alpha: false });
    const canvas = document.getElementById('worldmap');
    const ctx = canvas.getContext('2d');
    let W, H;  // canvas logical dimensions (CSS pixels)
    const BASEMAP_DPR_CAP = 1.5;
    const INTERACTION_DPR_CAP = 1;
    let basemapDpr = 1;
    let peerDpr = 1;

    // Static geography is projected into reusable viewport-space paths.
    // The cached basemap bitmap is transformed while the camera is moving,
    // then redrawn once at the settled view for sharp output.
    const basemapPaths = {
        grid: null,
        land: null,
        polar: null,
        lakes: null,
        borders: null,
        states: null,
    };
    let basemapView = null;
    let basemapDirty = true;
    let lastBasemapTransform = '';

    // Current view (smoothly interpolated each frame)
    let view = { x: 0, y: 0, zoom: 1 };
    // Target view (set instantly by user input, view lerps toward it)
    let targetView = { x: 0, y: 0, zoom: 1 };

    // Mouse drag state
    let dragging = false;
    let dragStart = { x: 0, y: 0 };
    let dragViewStart = { x: 0, y: 0 };

    // ═══════════════════════════════════════════════════════════
    // NODE STATE
    // Nodes are built from /api/peers responses.
    // Each node has animation metadata (spawnTime, fadeOutStart).
    // ═══════════════════════════════════════════════════════════

    let nodes = [];          // currently visible + fading-out nodes
    let lastPeers = [];      // raw API response for table rendering
    let highlightedPeerId = null;  // peer ID highlighted via map↔table interaction

    // [MAP DOT FILTER] State for multi-peer dot grouping
    let mapFilterPeerIds = null;   // Set of peer IDs to show when a map dot is clicked (null = no filter)
    let groupedNodes = null;       // Array of nodes at clicked dot (for back navigation from drill-down)

    // [AS-DISTRIBUTION] State for AS Distribution integration
    let asFilterPeerIds = null;    // Set of peer IDs to show when AS is selected (null = no filter)
    let asLinePeerIds = null;      // Array of peer IDs to draw lines to (hover/selection)
    let asLineColor = null;        // Color string for AS lines
    let asLineAsNum = null;        // AS number for legend dot lookup
    let asLineGroups = null;       // Array of {asNum, peerIds, color} for hover-all mode

    // [PRIVATE-NET] State for private network view mode
    let privateNetMode = false;          // true when viewing private networks in Antarctica
    let privateNetSelectedPeer = null;   // node object of selected private peer (or null)
    let privateNetLinePeer = null;       // peer ID to draw line to in private mode
    let pnBigPopupEl = null;             // DOM element for the private peer big detail popup
    let pnMiniHover = false;             // true when hovering the mini donut in default view (draws lines)
    let pnPreviewPeerIds = null;         // peer IDs to preview lines for (panel row hover)
    let pnMiniHoverNet = null;           // which network segment is hovered on the mini donut
    const PRIVATE_NETS = new Set(['onion', 'i2p', 'cjdns']);

    // [PRIVATE-NET] Insight rectangle state (mirrors public AS insight rect)
    let pnInsightRectEl = null;          // DOM ref for PN insight rectangle overlay
    let pnInsightRectVisible = false;    // Whether the PN insight rectangle is currently shown
    let pnInsightActiveType = null;      // 'stable' | 'fastest' | 'data-bytessent' | 'data-bytesrecv'
    let pnInsightActivePeerId = null;    // Peer ID of the active (selected) insight
    let pnInsightActiveData = null;      // Full data object for the active insight

    // Network filter: Set of enabled network keys. When ALL networks are enabled, equivalent to "All".
    const ALL_NETS = new Set(['ipv4', 'ipv6', 'onion', 'i2p', 'cjdns']);
    let enabledNets = new Set(ALL_NETS);  // start with all enabled

    /** Check if all networks are enabled (= "All" state) */
    function isAllNetsEnabled() {
        for (const n of ALL_NETS) {
            if (!enabledNets.has(n)) return false;
        }
        return true;
    }

    /** Check if a node passes the current network filter */
    function passesNetFilter(netKey) {
        return enabledNets.has(netKey);
    }

    // ═══════════════════════════════════════════════════════════
    // WORLD GEOMETRY STATE
    // Land polygons, lake polygons, borders, and cities loaded
    // from static assets. Each layer appears at different zoom levels.
    // ═══════════════════════════════════════════════════════════

    let worldPolygons = [];
    let lakePolygons = [];
    let borderLines = [];      // country border line strings
    let stateLines = [];       // state/province border line strings
    let cityPoints = [];       // { n: name, p: population, c: [lon,lat] }
    let countryLabels = [];    // { n: name, c: [lon,lat] } — country centroids (English)
    let stateLabels = [];      // { n: name, c: [lon,lat] } — state/province centroids (English)
    let worldReady = false;
    let lakesReady = false;
    let bordersReady = false;
    let statesReady = false;
    let citiesReady = false;
    let countryLabelsReady = false;
    let stateLabelsReady = false;
    let stateGeometryPromise = null;
    let stateLabelsPromise = null;
    let cityDataPromise = null;

    // Zoom thresholds for progressive detail layers
    // Country borders render at ALL zoom levels (no threshold)
    // Label hierarchy: countries first → states → cities
    const ZOOM_SHOW_COUNTRY_LABELS = 1.5;  // country names appear (medium zoom)
    const ZOOM_SHOW_STATES         = 3.0;  // state/province borders appear
    const ZOOM_SHOW_STATE_LABELS   = 4.0;  // state/province names (after countries visible)
    const ZOOM_SHOW_CITIES_MAJOR   = 6.0;  // cities > 5M population
    const ZOOM_SHOW_CITIES_LARGE   = 8.0;  // cities > 1M population
    const ZOOM_SHOW_CITIES_MED     = 10.0; // cities > 300K population
    const ZOOM_SHOW_CITIES_ALL     = 12.0; // all cities
    const ZOOM_PREFETCH_STATES       = ZOOM_SHOW_STATES - 0.5;
    const ZOOM_PREFETCH_STATE_LABELS = ZOOM_SHOW_STATE_LABELS - 0.5;
    const ZOOM_PREFETCH_CITIES       = ZOOM_SHOW_CITIES_MAJOR - 0.5;

    // DOM references
    const clockEl = document.getElementById('clock');
    const tooltipEl = document.getElementById('node-tooltip');
    const antOverlay = document.getElementById('antarctica-modal-overlay');
    let hoveredNode = null;
    let pinnedNode = null;  // Tooltip pins when user clicks a node or table row

    // ═══════════════════════════════════════════════════════════
    // PULSE ON CHANGE — Number animation system
    // Ported from legacy dashboard.js with all 4 modes
    // ═══════════════════════════════════════════════════════════

    const prevValues = {};  // elementId -> previous numeric value

    function pulseOnChange(elementId, newValue, mode) {
        const el = document.getElementById(elementId);
        if (!el) return;
        const numNew = parseFloat(String(newValue).replace(/[^0-9.\-]/g, ''));
        if (isNaN(numNew)) { prevValues[elementId] = null; return; }
        const prev = prevValues[elementId];
        prevValues[elementId] = numNew;
        if (prev === null || prev === undefined) return;
        if (numNew === prev) return;
        const up = numNew > prev;
        const allClasses = ['pulse-up','pulse-down','pulse-up-long','pulse-down-long','pulse-white','price-up','price-down','price-pulse-up','price-pulse-down'];
        allClasses.forEach(c => el.classList.remove(c));
        void el.offsetWidth;  // force reflow
        if (mode === 'white') {
            el.classList.add('pulse-white');
            setTimeout(() => el.classList.remove('pulse-white'), 1500);
        } else if (mode === 'long') {
            el.classList.add(up ? 'pulse-up-long' : 'pulse-down-long');
            setTimeout(() => el.classList.remove('pulse-up-long','pulse-down-long'), 5000);
        } else if (mode === 'persistent') {
            el.classList.add(up ? 'price-pulse-up' : 'price-pulse-down');
            setTimeout(() => {
                el.classList.remove('price-pulse-up','price-pulse-down');
                el.classList.add(up ? 'price-up' : 'price-down');
            }, 2000);
        } else {
            el.classList.add(up ? 'pulse-up' : 'pulse-down');
            setTimeout(() => el.classList.remove('pulse-up','pulse-down'), 1500);
        }
        return up ? 1 : -1;
    }

    function showDeltaIndicator(parentEl, delta) {
        if (!parentEl || delta === 0) return;
        const existing = parentEl.querySelector('.delta-indicator');
        if (existing) existing.remove();
        const span = document.createElement('span');
        span.className = 'delta-indicator ' + (delta > 0 ? 'delta-up' : 'delta-down');
        span.textContent = (delta > 0 ? '+' : '') + delta;
        parentEl.appendChild(span);
        setTimeout(() => span.remove(), 2500);
    }

    // ═══════════════════════════════════════════════════════════
    // BTC SUPPORT ADDRESS — Selectable text (no click handler)
    // ═══════════════════════════════════════════════════════════
    // Address is plain selectable text — users can highlight and copy manually.

    // ═══════════════════════════════════════════════════════════
    // FLIGHT DECK — Toggle + Network stats
    // ═══════════════════════════════════════════════════════════

    // Flight deck is always visible (toggle removed)

    // Previous flight deck counts for delta indicators
    const fdPrevCounts = {};

    // Cached flight deck counts and scores for tooltip use
    let fdCachedCounts = { ipv4: {in:0,out:0}, ipv6: {in:0,out:0}, onion: {in:0,out:0}, i2p: {in:0,out:0}, cjdns: {in:0,out:0} };
    let fdCachedScores = { ipv4: null, ipv6: null };
    let fdCachedNetworkDetails = {};

    function updateFlightDeck(peerNodes) {
        const counts = { ipv4: {in:0,out:0}, ipv6: {in:0,out:0}, onion: {in:0,out:0}, i2p: {in:0,out:0}, cjdns: {in:0,out:0} };
        for (const n of peerNodes) {
            if (!n.alive) continue;
            const net = n.net || 'ipv4';
            if (!counts[net]) continue;
            if (n.direction === 'IN') counts[net].in++;
            else counts[net].out++;
        }
        fdCachedCounts = counts;
        const netMap = { ipv4:'ipv4', ipv6:'ipv6', onion:'tor', i2p:'i2p', cjdns:'cjdns' };
        for (const [net, label] of Object.entries(netMap)) {
            const c = counts[net];
            const inEl = document.getElementById(`fd-${label}-in`);
            const outEl = document.getElementById(`fd-${label}-out`);
            if (inEl) {
                const oldIn = fdPrevCounts[`${net}-in`] || 0;
                inEl.textContent = c.in;
                if (oldIn !== c.in && fdPrevCounts[`${net}-in`] !== undefined) {
                    pulseOnChange(`fd-${label}-in`, c.in);
                    showDeltaIndicator(inEl.parentElement, c.in - oldIn);
                }
                fdPrevCounts[`${net}-in`] = c.in;
            }
            if (outEl) {
                const oldOut = fdPrevCounts[`${net}-out`] || 0;
                outEl.textContent = c.out;
                if (oldOut !== c.out && fdPrevCounts[`${net}-out`] !== undefined) {
                    pulseOnChange(`fd-${label}-out`, c.out);
                    showDeltaIndicator(outEl.parentElement, c.out - oldOut);
                }
                fdPrevCounts[`${net}-out`] = c.out;
            }
            // Green/red dot indicator (enabled = has peers, disabled = no peers)
            const dotEl = document.getElementById(`fd-${label}-dot`);
            if (dotEl) {
                const total = c.in + c.out;
                if (total > 0) {
                    dotEl.className = 'fd-net-dot enabled';
                } else {
                    dotEl.className = 'fd-net-dot disabled';
                }
            }
            const chipEl = document.querySelector(`.fd-net-chip[data-net="${net}"]`);
            if (chipEl) {
                const addresses = fdCachedNetworkDetails[net]?.localaddresses || [];
                chipEl.classList.toggle('has-local-address', addresses.length > 0);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // FLIGHT DECK HOVER TOOLTIPS — Detailed network info on hover
    // ═══════════════════════════════════════════════════════════

    const fdTooltipEl = document.getElementById('fd-tooltip');

    // Friendly names and descriptions for each network
    const FD_NET_INFO = {
        ipv4:  { full: 'Public IPv4 network', label: 'Public IPv4', isOverlay: false },
        ipv6:  { full: 'Public IPv6 network', label: 'Public IPv6', isOverlay: false },
        onion: { full: 'Tor onion routing network', label: 'Tor onion routing network', isOverlay: true },
        i2p:   { full: 'I2P anonymous network', label: 'I2P anonymous network', isOverlay: true },
        cjdns: { full: 'CJDNS encrypted mesh network', label: 'CJDNS encrypted mesh network', isOverlay: true },
    };

    function formatNodeAddress(address) {
        if (!address || !address.address) return '';
        const host = String(address.address);
        const port = Number(address.port || 0);
        if (!port) return host;
        return host.includes(':') && !host.endsWith('.onion') && !host.endsWith('.i2p')
            ? `[${host}]:${port}`
            : `${host}:${port}`;
    }

    function shortNodeAddress(value) {
        if (value.length <= 36) return value;
        return `${value.slice(0, 16)}...${value.slice(-15)}`;
    }

    function buildNetworkIdentityRows(netKey, rowClass, mutedClass) {
        const details = fdCachedNetworkDetails[netKey];
        if (!details) return '';

        let html = '';
        html += `<div class="${rowClass}">Reachable: ${details.reachable ? 'Yes' : 'No'}</div>`;
        if (details.limited) html += `<div class="${mutedClass}">Limited by node network settings</div>`;
        if (details.proxy) {
            const proxy = escapeServiceHtml(details.proxy);
            html += `<div class="${rowClass}">Proxy: <span title="${proxy}">${proxy}</span></div>`;
        }

        const addresses = details.localaddresses || [];
        if (addresses.length === 0) {
            html += `<div class="${mutedClass}">No advertised address reported</div>`;
            return html;
        }

        const label = PRIVATE_NETS.has(netKey) ? 'Service' : 'Advertised';
        for (const address of addresses.slice(0, 3)) {
            const fullAddress = formatNodeAddress(address);
            const escapedFull = escapeServiceHtml(fullAddress);
            const shortAddress = escapeServiceHtml(shortNodeAddress(fullAddress));
            html += `<div class="${rowClass}">${label}: <span class="node-address" title="${escapedFull}">${shortAddress}</span></div>`;
        }
        if (addresses.length > 3) {
            html += `<div class="${mutedClass}">${addresses.length - 3} more advertised addresses</div>`;
        }
        return html;
    }

    function buildFdTooltip(netKey) {
        const info = FD_NET_INFO[netKey];
        if (!info) return '';
        const c = fdCachedCounts[netKey] || { in: 0, out: 0 };
        const total = c.in + c.out;
        const isEnabled = total > 0;

        // Get score for ipv4/ipv6 from cached values
        let scoreVal = null;
        if (!info.isOverlay) {
            scoreVal = fdCachedScores[netKey];
        }

        let html = '<div class="fdt-title">';
        if (isEnabled) {
            html += `${info.full} <span class="fdt-status-enabled">(Enabled)</span>`;
        } else {
            html += `${info.label} <span class="fdt-status-disabled">(Disabled)</span>`;
        }
        html += '</div>';

        html += `<div class="fdt-row">Inbound: ${c.in} peers</div>`;
        html += `<div class="fdt-row">Outbound: ${c.out} peers</div>`;
        html += buildNetworkIdentityRows(netKey, 'fdt-row', 'fdt-row-muted');

        if (info.isOverlay) {
            html += '<div class="fdt-row-muted">Overlay network (no reliable local score)</div>';
        } else if (scoreVal) {
            html += `<div class="fdt-row">Local Network Score: ${scoreVal}</div>`;
        }

        if (isEnabled) {
            if (info.isOverlay) {
                html += '<div class="fdt-row-muted">Appears to be properly configured</div>';
            }
        } else {
            html += '<div class="fdt-warn">This network is either disabled or not currently connected.<br>Please check your node network settings.</div>';
        }

        return html;
    }

    // Attach hover + click listeners to all flight deck chips
    document.querySelectorAll('.fd-net-chip').forEach(chip => {
        chip.addEventListener('mouseenter', () => {
            const netKey = chip.dataset.net;
            if (!fdTooltipEl) return;
            const html = buildFdTooltip(netKey);
            if (!html) return;
            fdTooltipEl.innerHTML = html;
            fdTooltipEl.classList.remove('hidden');
            // Position below the chip
            const rect = chip.getBoundingClientRect();
            fdTooltipEl.style.left = rect.left + 'px';
            fdTooltipEl.style.top = (rect.bottom + 6) + 'px';
        });
        chip.addEventListener('mouseleave', () => {
            if (fdTooltipEl) fdTooltipEl.classList.add('hidden');
        });
        // Click: IPv4/IPv6 → open AS distribution focused mode, Tor/I2P/CJDNS → enter private mode
        chip.addEventListener('click', (e) => {
            e.stopPropagation();
            if (fdTooltipEl) fdTooltipEl.classList.add('hidden');
            const netKey = chip.dataset.net;
            if (PRIVATE_NETS.has(netKey)) {
                // Private network chip → enter private mode + open that network's panel
                if (!privateNetMode) {
                    enterPrivateNetMode(null, netKey);
                } else {
                    // Already in private mode — just switch to this network
                    pnSelectedNet = netKey;
                    cachePnElements();
                    if (pnContainerEl) pnContainerEl.classList.add('pn-focused');
                    openPnDetailPanel(netKey);
                    updatePrivateNetUI();
                }
            } else {
                // Public network chip (ipv4/ipv6) → exit private mode if active, open network panel
                if (privateNetMode) exitPrivateNetMode();
                if (window.ASDistribution) {
                    if (!window.ASDistribution.isFocusedMode()) {
                        window.ASDistribution.enterFocusedMode();
                    }
                    // Open the dedicated IPv4/IPv6 network detail panel
                    window.ASDistribution.openNetworkPanel(netKey);
                }
            }
        });
    });

    // ═══════════════════════════════════════════════════════════
    // MINIMIZE BUTTON — Toggle peer panel collapsed state
    // ═══════════════════════════════════════════════════════════

    const minimizeBtn = document.getElementById('btn-minimize');

    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const panel = document.getElementById('peer-panel');
            if (panel) {
                panel.classList.toggle('collapsed');
                const isCollapsed = panel.classList.contains('collapsed');
                minimizeBtn.innerHTML = isCollapsed ? '&#9650;' : '&#9660;';
                minimizeBtn.title = isCollapsed ? 'Show peer list table' : 'Hide peer list table';
                scheduleDonutStackFit();
            }
        });
    }

    // ═══════════════════════════════════════════════════════════
    // BTC PRICE STATE
    // ═══════════════════════════════════════════════════════════

    let btcCurrency = 'USD';
    let btcPriceInterval = 10;  // seconds
    let btcPriceTimer = null;

    // ═══════════════════════════════════════════════════════════
    // CURRENCY SELECTOR DROPDOWN
    // ═══════════════════════════════════════════════════════════

    const CURRENCIES = ['USD','EUR','GBP','JPY','CHF','CAD','AUD','CNY','NZD','SGD'];
    const CURRENCY_META = {
        USD: { symbol: '$',   decimals: 2 },
        EUR: { symbol: '\u20AC',  decimals: 2 },  // €
        GBP: { symbol: '\u00A3',  decimals: 2 },  // £
        JPY: { symbol: '\u00A5',  decimals: 0 },  // ¥
        CHF: { symbol: 'CHF ', decimals: 2 },
        CAD: { symbol: 'C$',  decimals: 2 },
        AUD: { symbol: 'A$',  decimals: 2 },
        CNY: { symbol: 'CN\u00A5', decimals: 2 },  // CN¥
        NZD: { symbol: 'NZ$', decimals: 2 },
        SGD: { symbol: 'S$',  decimals: 2 },
    };

    function formatCurrencyPrice(price, currencyCode) {
        const meta = CURRENCY_META[currencyCode] || { symbol: '', decimals: 2 };
        return meta.symbol + price.toLocaleString(undefined, {
            minimumFractionDigits: meta.decimals,
            maximumFractionDigits: meta.decimals,
        });
    }

    let currencyDropdownEl = null;

    const currCodeEl = document.getElementById('mo-btc-currency');
    const btcPriceBarEl = document.getElementById('btc-price-bar');

    function openCurrencyDropdown() {
        closeCurrencyDropdown();
        const dd = document.createElement('div');
        dd.className = 'currency-dropdown';
        dd.id = 'currency-dropdown';
        let html = '<div class="curr-title">Select Currency</div><div class="curr-grid">';
        for (const c of CURRENCIES) {
            html += `<button class="curr-btn${c === btcCurrency ? ' active' : ''}" data-curr="${c}">${c}</button>`;
        }
        html += '</div>';
        html += `<div class="curr-freq"><span>Update every</span><input type="number" id="curr-freq-input" value="${btcPriceInterval}" min="5" max="99"><span>sec</span></div>`;
        // Show last price error if any
        if (lastNodeInfo && lastNodeInfo.last_price_error) {
            html += `<div class="curr-error" style="color:var(--text-muted);font-size:9px;padding:6px 8px 2px;border-top:1px solid rgba(255,255,255,0.06)">${lastNodeInfo.last_price_error}</div>`;
        }
        dd.innerHTML = html;
        document.body.appendChild(dd);
        currencyDropdownEl = dd;

        // Position below the centered BTC price bar
        const anchor = btcPriceBarEl || currCodeEl;
        if (anchor) {
            const rect = anchor.getBoundingClientRect();
            const ddWidth = 200; // approx dropdown width
            dd.style.left = Math.max(8, rect.left + rect.width / 2 - ddWidth / 2) + 'px';
            dd.style.top = (rect.bottom + 6) + 'px';
        }

        dd.querySelectorAll('.curr-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                btcCurrency = btn.dataset.curr;
                if (currCodeEl) currCodeEl.textContent = btcCurrency;
                dd.querySelectorAll('.curr-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                fetchInfo();
            });
        });

        const freqInput = document.getElementById('curr-freq-input');
        if (freqInput) {
            freqInput.addEventListener('change', () => {
                const v = clamp(parseInt(freqInput.value) || 10, 5, 99);
                freqInput.value = v;
                btcPriceInterval = v;
                // Restart info poll with new interval
                if (btcPriceTimer) clearInterval(btcPriceTimer);
                btcPriceTimer = setInterval(fetchInfo, btcPriceInterval * 1000);
            });
        }

        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', closeCurrencyOnOutside);
        }, 0);
    }

    function closeCurrencyOnOutside(e) {
        const bar = btcPriceBarEl || currCodeEl;
        if (currencyDropdownEl && !currencyDropdownEl.contains(e.target) && (!bar || !bar.contains(e.target))) {
            closeCurrencyDropdown();
        }
    }

    function closeCurrencyDropdown() {
        if (currencyDropdownEl) {
            currencyDropdownEl.remove();
            currencyDropdownEl = null;
        }
        document.removeEventListener('click', closeCurrencyOnOutside);
    }

    // ═══════════════════════════════════════════════════════════
    // GEODB MANAGEMENT DROPDOWN
    // ═══════════════════════════════════════════════════════════

    /** Open GeoIP DB as a centered modal (like Node Info) */
    function openGeoDBDropdown() {
        const existing = document.getElementById('geodb-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'geodb-modal';
        overlay.innerHTML = `<div class="modal-box" style="max-width:480px"><div class="modal-header"><span class="modal-title">GeoIP DB</span><button class="modal-close" id="geodb-modal-close">&times;</button></div><div class="modal-body" id="geodb-modal-body"><div style="color:var(--text-muted);text-align:center;padding:16px">Loading...</div></div></div>`;
        document.body.appendChild(overlay);
        document.getElementById('geodb-modal-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        const body = document.getElementById('geodb-modal-body');

        if (lastNodeInfo && lastNodeInfo.geo_db_stats) {
            const stats = lastNodeInfo.geo_db_stats;
            const statusText = stats.status || 'unknown';
            const statusCls = statusText === 'ok' ? 'ok' : (statusText === 'disabled' ? 'disabled' : 'error');
            let html = '';
            html += `<div class="modal-row"><span class="modal-label" title="Database health status">Status</span><span class="geodb-status-badge ${statusCls}" title="${statusText.toUpperCase()}">${statusText.toUpperCase()}</span></div>`;
            if (stats.entries != null) html += mrow('Entries', stats.entries.toLocaleString(), 'Total number of IP geolocation records in the database', `${stats.entries.toLocaleString()} records`);
            if (stats.size_bytes != null) html += mrow('Size', (stats.size_bytes / 1e6).toFixed(1) + ' MB', 'Database file size on disk', `${(stats.size_bytes / 1e6).toFixed(1)} MB`);
            if (stats.newest_age_seconds != null) {
                const secs = stats.newest_age_seconds;
                let newestText;
                if (secs >= 86400) {
                    newestText = Math.floor(secs / 86400) + ' days';
                } else if (secs >= 3600) {
                    const h = Math.floor(secs / 3600);
                    const m = Math.floor((secs % 3600) / 60);
                    newestText = h + 'h ' + m + 'm';
                } else if (secs >= 60) {
                    const m = Math.floor(secs / 60);
                    const s = secs % 60;
                    newestText = m + 'm ' + s + 's';
                } else {
                    newestText = secs + 's';
                }
                html += mrow('Newest Entry', newestText, 'Age of the newest geolocation record', newestText + ' old');
            } else if (stats.newest_age_days != null) {
                html += mrow('Newest Entry', stats.newest_age_days + ' days', 'Age of the newest geolocation record', `${stats.newest_age_days} days old`);
            }
            if (stats.oldest_age_days != null) html += mrow('Oldest Entry', stats.oldest_age_days + ' days', 'Age of the oldest geolocation record', `${stats.oldest_age_days} days old`);
            if (stats.path) html += `<div class="modal-row"><span class="modal-label" title="File system path to the database">Path</span><span class="modal-val" style="font-size:9px;max-width:260px" title="${stats.path}">${stats.path}</span></div>`;
            const alVal = stats.auto_lookup ? 'On' : 'Off';
            html += mrow('Auto-resolve', alVal, 'Master switch — enables the GeoIP system that resolves peer IPs to locations on the map', alVal, stats.auto_lookup ? 'modal-val-ok' : 'modal-val-warn');
            // Auto-update toggle switch (persists to settings.json)
            const auOn = !!stats.auto_update;
            html += `<div class="modal-row"><span class="modal-label" title="Automatically update the geolocation database (at startup and once per hour while the map is open)">Auto-update</span><span class="modal-val" style="display:flex;align-items:center;gap:6px"><label class="geodb-toggle" title="${auOn ? 'Click to disable auto-update' : 'Click to enable auto-update'}"><input type="checkbox" id="geodb-autoupdate-toggle" ${auOn ? 'checked' : ''}><span class="geodb-toggle-slider"></span></label></span></div>`;
            // API Lookup toggle switch (no On/Off text — slider colour shows state)
            const dbOnly = stats.db_only_mode || false;
            const apiOn = !dbOnly;
            html += `<div class="modal-row"><span class="modal-label" title="When ON, unknown IPs are looked up via ip-api.com. When OFF, only cached database entries are used.">API Lookup</span><span class="modal-val" style="display:flex;align-items:center;gap:6px"><label class="geodb-toggle" title="${apiOn ? 'Click to disable API lookups' : 'Click to enable API lookups'}"><input type="checkbox" id="geodb-dbonly-toggle" ${apiOn ? 'checked' : ''}><span class="geodb-toggle-slider"></span></label></span></div>`;
            html += '<button class="geodb-update-btn" id="geodb-update-btn">Update Database</button>';
            html += '<div class="geodb-result" id="geodb-result"></div>';
            body.innerHTML = html;

            // Auto-update toggle handler (persists to settings.json)
            document.getElementById('geodb-autoupdate-toggle').addEventListener('change', async () => {
                try {
                    const resp = await fetch('/api/geodb/toggle-auto-update', { method: 'POST' });
                    const data = await resp.json();
                    if (data.success) {
                        // Refresh info + modal, and start/stop the hourly timer
                        fetchInfo().then(() => {
                            syncDbAutoUpdateTimer();
                            openGeoDBDropdown();
                        });
                    }
                } catch (err) {
                    console.error('Toggle auto-update failed:', err);
                }
            });

            // DB-only toggle handler
            document.getElementById('geodb-dbonly-toggle').addEventListener('change', async () => {
                try {
                    const resp = await fetch('/api/geodb/toggle-db-only', { method: 'POST' });
                    const data = await resp.json();
                    if (data.success) {
                        // Refresh the modal
                        fetchInfo().then(() => openGeoDBDropdown());
                    }
                } catch (err) {
                    console.error('Toggle DB-only failed:', err);
                }
            });

            document.getElementById('geodb-update-btn').addEventListener('click', async () => {
                const resultEl = document.getElementById('geodb-result');
                resultEl.textContent = 'Updating...';
                resultEl.style.color = 'var(--text-secondary)';
                try {
                    const resp = await fetch('/api/geodb/update', { method: 'POST' });
                    const data = await resp.json();
                    resultEl.textContent = data.message || (data.success ? 'Done' : 'Failed');
                    resultEl.style.color = data.success ? 'var(--ok)' : 'var(--err)';
                } catch (err) {
                    resultEl.textContent = 'Error: ' + err.message;
                    resultEl.style.color = 'var(--err)';
                }
            });
        } else {
            body.innerHTML = '<div style="color:var(--text-muted);padding:8px 0;text-align:center">No GeoDB data available</div>';
        }
    }

    // ═══════════════════════════════════════════════════════════
    // CONNECT PEER MODAL
    // ═══════════════════════════════════════════════════════════

    function openConnectPeerModal() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'connect-peer-modal';
        overlay.innerHTML = `<div class="modal-box" style="max-width:520px">
            <div class="modal-header"><span class="modal-title">Connect Peer</span><button class="modal-close" id="connect-close">&times;</button></div>
            <div class="modal-body">
                <div class="connect-instructions">Enter a peer address to connect. Your node will attempt a one-time (onetry) connection.</div>
                <div class="connect-example">IPv4: 1.2.3.4:8333</div>
                <div class="connect-example">IPv6: [2001:db8::1]:8333</div>
                <div class="connect-example">Tor: abc...xyz.onion:8333</div>
                <div class="connect-example">I2P: abc...xyz.b32.i2p:0</div>
                <div class="connect-example">CJDNS: [fc00::1]:8333</div>
                <div class="connect-input-row">
                    <input type="text" class="connect-input" id="connect-addr-input" placeholder="Enter peer address...">
                    <button class="connect-btn" id="connect-go-btn">Connect</button>
                </div>
                <div class="connect-result" id="connect-result"></div>
                <div class="connect-permanent-hint">For a permanent connection, add the peer to the Bitcoin node's <code>addnode</code> configuration.</div>
            </div>
        </div>`;
        document.body.appendChild(overlay);
        document.getElementById('connect-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        const input = document.getElementById('connect-addr-input');
        const goBtn = document.getElementById('connect-go-btn');
        const resultEl = document.getElementById('connect-result');
        goBtn.addEventListener('click', async () => {
            const addr = input.value.trim();
            if (!addr) { resultEl.textContent = 'Please enter an address'; resultEl.className = 'connect-result err'; return; }
            resultEl.textContent = 'Connecting...';
            resultEl.className = 'connect-result';
            try {
                const resp = await fetch('/api/peer/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: addr }) });
                const data = await resp.json();
                if (data.success) {
                    resultEl.textContent = `Connection attempt sent to ${data.address}`;
                    resultEl.className = 'connect-result ok';
                    setTimeout(fetchPeers, 2000);
                } else {
                    resultEl.textContent = data.error || 'Failed';
                    resultEl.className = 'connect-result err';
                }
            } catch (err) {
                resultEl.textContent = 'Error: ' + err.message;
                resultEl.className = 'connect-result err';
            }
        });

        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') goBtn.click(); });

    }

    // Connect Peer button handler
    const connectPeerBtn = document.getElementById('btn-connect-peer');
    if (connectPeerBtn) {
        connectPeerBtn.addEventListener('click', (e) => { e.stopPropagation(); openConnectPeerModal(); });
    }

    // Node Info button handler (old handle btn, kept for compatibility)
    const nodeInfoBtn = document.getElementById('btn-node-info');
    if (nodeInfoBtn) {
        nodeInfoBtn.addEventListener('click', (e) => { e.stopPropagation(); openNodeInfoModal(); });
    }

    // System Info button handler (old handle btn, kept for compatibility)
    const systemInfoBtn = document.getElementById('btn-system-info');
    if (systemInfoBtn) {
        systemInfoBtn.addEventListener('click', (e) => { e.stopPropagation(); openSystemInfoModal(); });
    }

    // Right overlay: NODE INFO link → opens Node Info modal
    const roNodeInfoLink = document.getElementById('ro-node-info');
    if (roNodeInfoLink) {
        roNodeInfoLink.addEventListener('click', (e) => { e.stopPropagation(); openNodeInfoModal(); });
    }

    // Right overlay: GEOIP DB link
    const roGeodbLink = document.getElementById('ro-geodb-link');
    if (roGeodbLink) {
        roGeodbLink.addEventListener('click', (e) => { e.stopPropagation(); openGeoDBDropdown(); });
    }

    // Left overlay: Peers/CPU/RAM/NET rows → click opens system info modal
    ['mo-row-peers', 'mo-row-cpu', 'mo-row-ram', 'mo-row-netin', 'mo-row-netout'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', (e) => { e.stopPropagation(); openSystemInfoModal(); });
    });

    // BTC price bar: click toggles currency selector
    const btcPriceBar = document.getElementById('btc-price-bar');
    if (btcPriceBar) {
        btcPriceBar.addEventListener('click', (e) => {
            e.stopPropagation();
            if (currencyDropdownEl) {
                closeCurrencyDropdown();
            } else {
                openCurrencyDropdown();
            }
        });
    }

    // Right overlay: click Update/Status rows → open settings popup
    ['ro-row-countdown', 'ro-row-statusmsg'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', (e) => { e.stopPropagation(); openDisplaySettingsPopup(el); });
    });

    // Right overlay: DISPLAY SETTINGS link → open settings popup
    const roDisplaySettingsLink = document.getElementById('ro-display-settings-link');
    if (roDisplaySettingsLink) {
        roDisplaySettingsLink.addEventListener('click', (e) => {
            e.stopPropagation();
            openDisplaySettingsPopup(roDisplaySettingsLink);
        });
    }

    // ═══════════════════════════════════════════════════════════
    // PRIVATE NETWORK MODE — Full Antarctica view for Tor/I2P/CJDNS
    // Circular donut + detail panel with cascading sub-tooltips
    // (mirrors the AS Distribution panel pattern)
    // ═══════════════════════════════════════════════════════════

    // Donut configuration
    const PN_DONUT_SIZE = 260;
    const PN_DONUT_RADIUS = 116;
    const PN_DONUT_WIDTH = 28;
    const PN_DONUT_WIDTH_SELECTED = 40;
    const PN_DONUT_WIDTH_DIMMED = 14;
    const PN_INNER_RADIUS = PN_DONUT_RADIUS - PN_DONUT_WIDTH;

    // DOM refs (cached after first use)
    let pnContainerEl = null;
    let pnDonutSvg = null;
    let pnCenterCount = null;
    let pnCenterLabel = null;
    let pnCenterSub = null;
    let pnDetailPanelEl = null;
    let pnDetailBodyEl = null;
    let pnDetailBodyHandlerAttached = false;  // guard against re-registering click handler
    let pnDetailNetNameEl = null;
    let pnDetailMetaEl = null;

    // Donut state
    let pnSegments = [];           // Array of { net, count, color, label }
    let pnSelectedNet = null;      // Currently selected donut segment (null = overview/all)
    let pnHoveredNet = null;       // Network type hovered on the donut (for peer preview/dimming)
    let pnPopupTimer = null;       // Timer ID for pending popup show (prevents race conditions)

    // Sub-tooltip state
    let pnSubTooltipPinned = false;
    let pnPinnedSubSrc = null;
    let pnCenterPreviewLabel = null;   // Label of active PN center preview (for data refresh preservation)
    let pnCenterPreviewPeerIds = null; // Peer IDs of active PN center preview

    function cachePnElements() {
        if (!pnContainerEl) {
            pnContainerEl = document.getElementById('pn-container');
            pnDonutSvg = document.getElementById('pn-donut-svg');
            pnCenterCount = document.getElementById('pn-center-count');
            pnCenterLabel = document.getElementById('pn-center-label');
            pnCenterSub = document.getElementById('pn-center-sub');
            pnDetailPanelEl = document.getElementById('pn-detail-panel');
            pnDetailBodyEl = document.getElementById('pn-detail-body');
            pnDetailNetNameEl = document.getElementById('pn-detail-net-name');
            pnDetailMetaEl = document.getElementById('pn-detail-meta');
            pnInsightRectEl = document.getElementById('pn-insight-rect');
        }
        // Attach blank-space click handler once on pnDetailBodyEl (dismiss sub-tooltips)
        if (pnDetailBodyEl && !pnDetailBodyHandlerAttached) {
            pnDetailBodyHandlerAttached = true;
            pnDetailBodyEl.addEventListener('click', (e) => {
                if (e.target === pnDetailBodyEl || e.target.classList.contains('modal-section-title') ||
                    e.target.classList.contains('modal-row') || e.target.classList.contains('modal-label') ||
                    e.target.classList.contains('modal-val')) {
                    if (pnSubTooltipPinned) {
                        hidePnSubTooltip();
                        pnDetailBodyEl.querySelectorAll('.pn-sub-filter-active').forEach(r => r.classList.remove('pn-sub-filter-active'));
                    }
                }
            });
        }
    }

    /** Enter private network mode: zoom to Antarctica, show circular donut */
    /** Enter private network mode: zoom to Antarctica, show circular donut.
     *  If targetNet is provided, skip overview and go directly to that net's panel. */
    function enterPrivateNetMode(selectedPeerId, targetNet) {
        if (privateNetMode) {
            if (selectedPeerId) selectPrivatePeer(selectedPeerId);
            return;
        }
        privateNetMode = true;
        document.body.classList.add('private-net-mode');

        // Close any existing AS distribution panels/tooltips
        if (window.ASDistribution) {
            window.ASDistribution.closePeerPopup();
            window.ASDistribution.deselect();
            if (window.ASDistribution.isFocusedMode()) {
                window.ASDistribution.exitFocusedMode();
            }
        }
        hideTooltip();
        clearMapDotFilter();
        highlightedPeerId = null;
        pinnedNode = null;

        // Reset state — but apply targetNet if provided
        pnSelectedNet = targetNet || null;
        hidePnSubTooltip();
        pnMiniHover = false;

        // Switch badge filters to only active private networks
        const activePrivateNets = new Set();
        for (const n of nodes) {
            if (n.alive && PRIVATE_NETS.has(n.net)) activePrivateNets.add(n.net);
        }
        enabledNets = activePrivateNets.size > 0 ? activePrivateNets : new Set(PRIVATE_NETS);
        updateBadgeStates();

        // Show donut container — centered at top with panel open
        cachePnElements();
        if (pnContainerEl) {
            pnContainerEl.classList.remove('hidden');
            requestAnimationFrame(() => {
                pnContainerEl.classList.add('visible', 'pn-focused');
            });
        }

        // Zoom to Antarctica — moderate zoom so the whole continent is visible
        const antCenter = project(40, -75);
        targetView.x = (antCenter.x - 0.5) * W;
        targetView.y = (antCenter.y - 0.5) * H;
        targetView.zoom = 1.8;

        // Focus the donut and open panel
        updatePrivateNetUI();
        if (targetNet) {
            // Go directly to the target network's detail panel
            setTimeout(() => openPnDetailPanel(targetNet), 200);
        } else {
            setTimeout(() => openPnOverviewPanel(), 200);
        }

        // Select the triggering peer if provided
        if (selectedPeerId) {
            setTimeout(() => selectPrivatePeer(selectedPeerId), 300);
        }
    }

    /** Exit private network mode: return to normal public view */
    function exitPrivateNetMode() {
        if (!privateNetMode) return;
        privateNetMode = false;
        privateNetSelectedPeer = null;
        privateNetLinePeer = null;
        pnSelectedNet = null;
        pnHoveredNet = null;
        pnPreviewPeerIds = null;

        // Clear insight rect state
        hidePnInsightRect();
        pnInsightActiveType = null;
        pnInsightActivePeerId = null;
        pnInsightActiveData = null;

        document.body.classList.remove('private-net-mode', 'pn-panel-open');

        // Hide sub-tooltips
        hidePnSubTooltip();

        // Hide private network UI
        cachePnElements();
        if (pnContainerEl) {
            pnContainerEl.classList.remove('visible', 'pn-focused');
            setTimeout(() => pnContainerEl.classList.add('hidden'), 500);
        }
        if (pnDetailPanelEl) {
            pnDetailPanelEl.classList.remove('visible');
            setTimeout(() => pnDetailPanelEl.classList.add('hidden'), 350);
        }

        // Clear state
        hideTooltip();
        closePnBigPopup();
        clearMapDotFilter();
        highlightedPeerId = null;
        pinnedNode = null;

        // Restore badge filters to All (or previous state)
        enabledNets = new Set(ALL_NETS);
        updateBadgeStates();

        // Zoom back to world view
        targetView.x = 0;
        targetView.y = 0;
        targetView.zoom = 1;

        // Immediately re-show the mini donut (don't wait for next poll cycle)
        renderPnMiniDonut();
        renderPeerTable();
    }

    /** Select a specific private peer in Antarctica view */
    function selectPrivatePeer(peerId) {
        const node = nodes.find(n => n.peerId === peerId && n.alive);
        if (!node) return;

        privateNetSelectedPeer = node;
        privateNetLinePeer = peerId;
        highlightedPeerId = peerId;
        pinnedNode = node;

        // Zoom to the peer in Antarctica — moderate zoom so donut stays
        // close; offset slightly right so line isn't straight vertical
        const p = project(node.lon, node.lat);
        targetView.x = (p.x - 0.5) * W - W * 0.04;
        targetView.y = (p.y - 0.5) * H;
        targetView.zoom = 2.5;

        hideTooltip();
        hidePnSubTooltip();

        // Dismiss insight rect if selecting a different peer than the active insight's peer
        if (pnInsightRectVisible && pnInsightActivePeerId !== peerId) {
            hidePnInsightRect();
            clearPnInsightState();
        }

        // Move donut to top-center (focused state)
        cachePnElements();
        if (pnContainerEl) pnContainerEl.classList.add('pn-focused');

        // Cancel any pending popup timer, close existing popup immediately (sync),
        // then schedule the new one
        if (pnPopupTimer) clearTimeout(pnPopupTimer);
        closePnBigPopupSync();
        pnPopupTimer = setTimeout(() => {
            pnPopupTimer = null;
            showPnBigPopup(node);
        }, 350);

        updatePrivateNetUI();
    }

    // ── SVG Arc Path (same approach as AS distribution donut) ──

    function pnDescribeArc(cx, cy, outerR, innerR, startAngle, endAngle) {
        const sweep = endAngle - startAngle;
        const actualEnd = sweep >= 2 * Math.PI ? startAngle + 2 * Math.PI - 0.001 : endAngle;
        const largeArc = sweep > Math.PI ? 1 : 0;
        const ox1 = cx + outerR * Math.cos(startAngle);
        const oy1 = cy + outerR * Math.sin(startAngle);
        const ox2 = cx + outerR * Math.cos(actualEnd);
        const oy2 = cy + outerR * Math.sin(actualEnd);
        const ix1 = cx + innerR * Math.cos(actualEnd);
        const iy1 = cy + innerR * Math.sin(actualEnd);
        const ix2 = cx + innerR * Math.cos(startAngle);
        const iy2 = cy + innerR * Math.sin(startAngle);
        return [
            'M ' + ox1 + ' ' + oy1,
            'A ' + outerR + ' ' + outerR + ' 0 ' + largeArc + ' 1 ' + ox2 + ' ' + oy2,
            'L ' + ix1 + ' ' + iy1,
            'A ' + innerR + ' ' + innerR + ' 0 ' + largeArc + ' 0 ' + ix2 + ' ' + iy2,
            'Z',
        ].join(' ');
    }

    // ── Network metadata ──

    const PN_NET_COLORS_HEX = { onion: '#1565c0', i2p: '#d29922', cjdns: '#bc8cff' };
    const PN_NET_LABELS = { onion: 'Tor', i2p: 'I2P', cjdns: 'CJDNS' };

    function getPnNetColor(net) {
        const varMap = { onion: '--net-tor', i2p: '--net-i2p', cjdns: '--net-cjdns' };
        const v = varMap[net];
        if (v) {
            const c = getComputedStyle(document.documentElement).getPropertyValue(v).trim();
            if (c) return c;
        }
        return PN_NET_COLORS_HEX[net] || '#f0883e';
    }

    // ── Circular Donut Renderer ──

    function renderPnDonut() {
        cachePnElements();
        if (!pnDonutSvg) return;

        const privateNodes = nodes.filter(n => n.alive && PRIVATE_NETS.has(n.net));
        const counts = { onion: 0, i2p: 0, cjdns: 0 };
        for (const n of privateNodes) {
            if (counts.hasOwnProperty(n.net)) counts[n.net]++;
        }
        const total = privateNodes.length;

        // Build segments
        pnSegments = [];
        for (const net of ['onion', 'i2p', 'cjdns']) {
            if (counts[net] > 0) {
                pnSegments.push({ net, count: counts[net], color: getPnNetColor(net), label: PN_NET_LABELS[net] });
            }
        }

        // Update center text
        if (pnCenterLabel && pnCenterCount && pnCenterSub) {
            // If a peer row is hovered in a sub-tooltip, preserve that peer's info
            if (highlightedPeerId && pnSubTooltipPinned) {
                var peer = lastPeers.find(function(p) { return p.id === highlightedPeerId; });
                if (peer) {
                    var netLabel = PN_NET_LABELS[peer.network] || peer.network || 'PEER';
                    var netColor = getPnNetColor(peer.network);
                    pnCenterLabel.textContent = netLabel.toUpperCase();
                    pnCenterLabel.style.color = netColor;
                    pnCenterCount.textContent = '#' + highlightedPeerId;
                    pnCenterCount.style.fontSize = '22px';
                    pnCenterCount.style.fontFamily = '';
                    pnCenterCount.style.color = netColor;
                    pnCenterSub.textContent = peer.direction === 'IN' ? 'inbound' : 'outbound';
                }
            // If a category row preview is active (hover or pinned), preserve it across refresh
            } else if (pnCenterPreviewLabel && pnCenterPreviewPeerIds) {
                var cnt = pnCenterPreviewPeerIds.length;
                pnCenterLabel.textContent = cnt + ' PEER' + (cnt !== 1 ? 'S' : '');
                pnCenterLabel.style.color = 'var(--logo-accent, #7ec8e3)';
                pnCenterCount.textContent = pnCenterPreviewLabel.toUpperCase();
                pnCenterCount.style.fontSize = '17px';
                pnCenterCount.style.fontFamily = 'var(--font-display, Cinzel, serif)';
                pnCenterCount.style.color = '';
                var pct = total > 0 ? Math.round((cnt / total) * 100) : 0;
                pnCenterSub.innerHTML = pct + '% of anonymous<br>peers';
            } else if (privateNetSelectedPeer) {
                pnCenterLabel.textContent = PN_NET_LABELS[privateNetSelectedPeer.net] || 'PEER';
                pnCenterLabel.style.color = '';
                pnCenterCount.textContent = '#' + privateNetSelectedPeer.peerId;
                pnCenterCount.style.fontSize = '22px';
                pnCenterCount.style.fontFamily = '';
                pnCenterCount.style.color = '';
                pnCenterSub.textContent = privateNetSelectedPeer.direction === 'IN' ? 'inbound' : 'outbound';
            } else if (pnSelectedNet) {
                const seg = pnSegments.find(s => s.net === pnSelectedNet);
                var netCount = seg ? seg.count : 0;
                var netPct = total > 0 ? Math.round((netCount / total) * 100) : 0;
                pnCenterLabel.textContent = netCount + ' PEER' + (netCount !== 1 ? 'S' : '');
                pnCenterLabel.style.color = 'var(--logo-accent, #7ec8e3)';
                pnCenterCount.textContent = (PN_NET_LABELS[pnSelectedNet] || pnSelectedNet).toUpperCase();
                pnCenterCount.style.fontSize = '22px';
                pnCenterCount.style.fontFamily = 'var(--font-display, Cinzel, serif)';
                pnCenterCount.style.color = seg ? seg.color : '';
                pnCenterSub.innerHTML = netPct + '% of anonymous<br>peers';
            } else {
                var totalAllPeers = lastPeers.length || total;
                var pnPct = totalAllPeers > 0 ? Math.round((total / totalAllPeers) * 100) : 0;
                pnCenterLabel.textContent = total + ' PEER' + (total !== 1 ? 'S' : '');
                pnCenterLabel.style.color = 'var(--logo-accent, #7ec8e3)';
                pnCenterCount.textContent = 'PRIVATE NETWORKS';
                pnCenterCount.style.fontSize = '13px';
                pnCenterCount.style.fontFamily = 'var(--font-display, Cinzel, serif)';
                pnCenterCount.style.color = '';
                pnCenterSub.innerHTML = pnPct + '% of total<br>connections';
            }
        }

        // Render SVG
        const cx = PN_DONUT_SIZE / 2;
        const cy = PN_DONUT_SIZE / 2;
        const gap = 0.03;
        let html = '';

        // Defs for 3D effects
        html += '<defs>';
        html += '<filter id="pn-donut-shadow" x="-20%" y="-20%" width="140%" height="140%">';
        html += '<feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="#000" flood-opacity="0.55"/>';
        html += '</filter>';
        html += '<linearGradient id="pn-donut-highlight" x1="0" y1="0" x2="0" y2="1">';
        html += '<stop offset="0%" stop-color="rgba(255,255,255,0.12)"/>';
        html += '<stop offset="50%" stop-color="rgba(255,255,255,0)"/>';
        html += '<stop offset="100%" stop-color="rgba(0,0,0,0.10)"/>';
        html += '</linearGradient>';
        html += '</defs>';

        // Background track ring
        html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (PN_DONUT_RADIUS - PN_DONUT_WIDTH / 2) + '" fill="none" stroke="rgba(240,136,62,0.04)" stroke-width="' + PN_DONUT_WIDTH + '" />';
        // Outer decorative ring
        html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (PN_DONUT_RADIUS + 3) + '" fill="none" stroke="rgba(240,136,62,0.08)" stroke-width="1" />';
        // Inner decorative ring
        html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (PN_INNER_RADIUS - 3) + '" fill="none" stroke="rgba(240,136,62,0.06)" stroke-width="0.5" />';

        if (pnSegments.length === 0) {
            // Empty state
            html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (PN_DONUT_RADIUS - PN_DONUT_WIDTH / 2) + '" fill="none" stroke="#2d333b" stroke-width="' + PN_DONUT_WIDTH + '" opacity="0.5" />';
        } else if (pnSegments.length === 1) {
            const seg = pnSegments[0];
            const w = (pnSelectedNet === seg.net) ? PN_DONUT_WIDTH_SELECTED : PN_DONUT_WIDTH;
            html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (PN_DONUT_RADIUS - PN_DONUT_WIDTH / 2) + '" fill="none" stroke="' + seg.color + '" stroke-width="' + w + '" class="pn-donut-segment" data-net="' + seg.net + '" filter="url(#pn-donut-shadow)" style="cursor:pointer" />';
        } else {
            const totalGap = gap * pnSegments.length;
            const available = 2 * Math.PI - totalGap;
            let angle = -Math.PI / 2;
            const highlightNet = pnSelectedNet || (privateNetSelectedPeer ? privateNetSelectedPeer.net : null);

            html += '<g filter="url(#pn-donut-shadow)">';
            for (const seg of pnSegments) {
                const sweep = (seg.count / total) * available;
                if (sweep <= 0) continue;

                const startA = angle + gap / 2;
                const endA = angle + sweep + gap / 2;

                const isSelected = highlightNet === seg.net;
                const isDimmed = highlightNet && highlightNet !== seg.net;
                const segW = isSelected ? PN_DONUT_WIDTH_SELECTED : (isDimmed ? PN_DONUT_WIDTH_DIMMED : PN_DONUT_WIDTH);
                const segOuter = PN_DONUT_RADIUS - (PN_DONUT_WIDTH - segW) / 2;
                const segInner = segOuter - segW;
                const d = pnDescribeArc(cx, cy, segOuter, segInner, startA, endA);

                let cls = 'pn-donut-segment';
                if (isSelected) cls += ' selected';
                if (isDimmed) cls += ' dimmed';

                html += '<path d="' + d + '" fill="' + seg.color + '" class="' + cls + '" data-net="' + seg.net + '" style="cursor:pointer" />';
                angle += sweep + gap;
            }
            html += '</g>';

            // 3D highlight overlay
            html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (PN_DONUT_RADIUS - PN_DONUT_WIDTH / 2) + '" fill="none" stroke="url(#pn-donut-highlight)" stroke-width="' + PN_DONUT_WIDTH + '" pointer-events="none" />';
        }

        pnDonutSvg.innerHTML = html;

        // Attach segment event handlers (hover preview + click)
        // Safe: innerHTML above replaced all children, so old listeners are GC'd with old elements
        pnDonutSvg.querySelectorAll('.pn-donut-segment').forEach(el => {
            el.addEventListener('click', onPnSegmentClick);
            el.addEventListener('mouseenter', onPnSegmentHover);
            el.addEventListener('mouseleave', onPnSegmentLeave);
        });
    }

    /** Hover over a donut segment → preview network, dim others, draw lines to that net's peers */
    function onPnSegmentHover(e) {
        if (pnSelectedNet || privateNetSelectedPeer) return;
        const net = e.currentTarget.dataset.net;
        const seg = pnSegments.find(s => s.net === net);
        if (!seg) return;
        pnHoveredNet = net;
        if (pnCenterLabel) pnCenterLabel.textContent = seg.label.toUpperCase();
        if (pnCenterCount) {
            pnCenterCount.textContent = seg.count;
            pnCenterCount.style.color = seg.color;
        }
        if (pnCenterSub) pnCenterSub.textContent = 'peers';

        // Dim non-matching donut segments
        if (pnDonutSvg) {
            pnDonutSvg.querySelectorAll('.pn-donut-segment').forEach(el => {
                if (el.dataset.net !== net) el.classList.add('dimmed');
                else el.classList.remove('dimmed');
            });
        }
    }

    /** Leave a donut segment → restore center, undim, clear hover lines */
    function onPnSegmentLeave() {
        if (pnSelectedNet || privateNetSelectedPeer) return;
        pnHoveredNet = null;
        const total = pnSegments.reduce((s, seg) => s + seg.count, 0);
        var totalAllPeers = lastPeers.length || total;
        var pnPct = totalAllPeers > 0 ? Math.round((total / totalAllPeers) * 100) : 0;
        if (pnCenterLabel) {
            pnCenterLabel.textContent = total + ' PEER' + (total !== 1 ? 'S' : '');
            pnCenterLabel.style.color = 'var(--logo-accent, #7ec8e3)';
        }
        if (pnCenterCount) {
            pnCenterCount.textContent = 'PRIVATE NETWORKS';
            pnCenterCount.style.fontSize = '13px';
            pnCenterCount.style.fontFamily = 'var(--font-display, Cinzel, serif)';
            pnCenterCount.style.color = '';
        }
        if (pnCenterSub) pnCenterSub.innerHTML = pnPct + '% of total<br>connections';

        // Undim all segments
        if (pnDonutSvg) {
            pnDonutSvg.querySelectorAll('.pn-donut-segment').forEach(el => {
                el.classList.remove('dimmed');
            });
        }
    }

    /** Handle click on a donut segment */
    function onPnSegmentClick(e) {
        e.stopPropagation();
        const net = e.currentTarget.dataset.net;
        if (!net) return;

        // Dismiss insight rect when switching to a network selection
        if (pnInsightRectVisible) {
            hidePnInsightRect();
            clearPnInsightState();
        }

        // Toggle: click same segment deselects
        if (pnSelectedNet === net) {
            pnSelectedNet = null;
            closePnDetailPanel();
            document.body.classList.remove('pn-panel-open');
            // In private mode, donut always stays centered at top
            if (!privateNetMode) {
                cachePnElements();
                if (pnContainerEl) pnContainerEl.classList.remove('pn-focused');
            }
        } else {
            pnSelectedNet = net;
            cachePnElements();
            if (pnContainerEl) pnContainerEl.classList.add('pn-focused');
            openPnDetailPanel(net);
        }
        updatePrivateNetUI();
    }

    // ── Detail Panel (slides in from right, like AS detail panel) ──

    function openPnDetailPanel(net) {
        cachePnElements();
        if (!pnDetailPanelEl || !pnDetailBodyEl) return;

        document.body.classList.add('pn-panel-open');
        pnDetailPanelEl.classList.remove('hidden');
        requestAnimationFrame(() => pnDetailPanelEl.classList.add('visible'));

        updatePnDetailPanel(net);
    }

    function closePnDetailPanel() {
        hidePnSubTooltip();
        cachePnElements();
        if (pnDetailPanelEl) {
            pnDetailPanelEl.classList.remove('visible');
            setTimeout(() => {
                pnDetailPanelEl.classList.add('hidden');
                document.body.classList.remove('pn-panel-open');
            }, 350);
        }
    }

    /** Build and populate the detail panel for a specific network */
    function updatePnDetailPanel(net) {
        cachePnElements();
        if (!pnDetailBodyEl) return;

        // Show back button when viewing a specific network
        const backBtn = document.getElementById('pn-detail-back');
        if (backBtn) backBtn.classList.remove('hidden');

        const ASD = window.ASDistribution;
        const rawPeers = ASD ? ASD.getLastPeersRaw() : lastPeers;
        const netPeers = rawPeers.filter(p => p.network === net);
        const netLabel = PN_NET_LABELS[net] || net.toUpperCase();
        const netColor = getPnNetColor(net);

        // Update header
        if (pnDetailNetNameEl) {
            pnDetailNetNameEl.innerHTML = '<span style="color:' + netColor + '">' + netLabel + '</span> Network';
        }
        if (pnDetailMetaEl) {
            pnDetailMetaEl.textContent = netPeers.length + ' peer' + (netPeers.length !== 1 ? 's' : '') + ' connected';
        }

        if (netPeers.length === 0) {
            pnDetailBodyEl.innerHTML = '<div class="pn-panel-empty">No ' + netLabel + ' peers connected</div>';
            return;
        }

        // Calculate stats
        let inbound = 0, outbound = 0, totalPing = 0, pingCount = 0;
        let totalBytesSent = 0, totalBytesRecv = 0;
        const softwareMap = {};
        const servicesMap = {};
        const connTypeMap = {};

        for (const p of netPeers) {
            if (p.direction === 'IN') inbound++; else outbound++;
            if (p.ping_ms > 0) { totalPing += p.ping_ms; pingCount++; }
            totalBytesSent += (p.bytessent || 0);
            totalBytesRecv += (p.bytesrecv || 0);
            const sw = p.subver || 'Unknown';
            softwareMap[sw] = softwareMap[sw] || [];
            softwareMap[sw].push(p);
            const svc = p.services_abbrev || '\u2014';
            servicesMap[svc] = servicesMap[svc] || [];
            servicesMap[svc].push(p);
            const ct = p.connection_type || 'unknown';
            connTypeMap[ct] = connTypeMap[ct] || [];
            connTypeMap[ct].push(p);
        }

        const avgPing = pingCount > 0 ? Math.round(totalPing / pingCount) : null;

        let html = '';

        // ── Peers section (Overview) ──
        html += '<div class="modal-section-title">Peers</div>';
        html += pnStaticRow('Total', netPeers.length);
        html += pnStaticRow('Inbound', inbound);
        html += pnStaticRow('Outbound', outbound);

        // ── Performance ──
        html += '<div class="modal-section-title">Performance</div>';
        if (avgPing !== null) html += pnStaticRow('Avg Ping', avgPing + ' ms');
        html += pnStaticRow('Bytes Sent', fmtBytesShort(totalBytesSent));
        html += pnStaticRow('Bytes Recv', fmtBytesShort(totalBytesRecv));

        // ── Connection Types (interactive) ──
        const ctEntries = Object.entries(connTypeMap).sort((a, b) => b[1].length - a[1].length);
        if (ctEntries.length > 0) {
            html += '<div class="modal-section-title">Connection Types</div>';
            for (const [ct, peers] of ctEntries) {
                const PN_CT_LABELS = {
                    'outbound-full-relay': 'Full Relay',
                    'block-relay-only': 'Block Relay',
                    'manual': 'Manual',
                    'addr-fetch': 'Addr Fetch',
                    'feeler': 'Feeler',
                    'inbound': 'Inbound',
                };
                const ctLabel = PN_CT_LABELS[ct] || ct;
                const peerIds = JSON.stringify(peers.map(p => p.id));
                html += pnInteractiveRow(ctLabel, peers.length, peerIds, 'conntype');
            }
        }

        // ── Software (interactive) ──
        const swEntries = Object.entries(softwareMap).sort((a, b) => b[1].length - a[1].length);
        if (swEntries.length > 0) {
            html += '<div class="modal-section-title">Software</div>';
            for (const [sw, peers] of swEntries) {
                const peerIds = JSON.stringify(peers.map(p => p.id));
                html += pnInteractiveRow(pnEsc(sw), peers.length, peerIds, 'software');
            }
        }

        // ── Services (interactive) ──
        const svcEntries = Object.entries(servicesMap).sort((a, b) => b[1].length - a[1].length);
        if (svcEntries.length > 0) {
            html += '<div class="modal-section-title">Services</div>';
            for (const [svc, peers] of svcEntries) {
                const peerIds = JSON.stringify(peers.map(p => p.id));
                html += pnInteractiveRow(pnEsc(svc), peers.length, peerIds, 'services');
            }
        }

        pnDetailBodyEl.innerHTML = html;

        // Attach interactive row handlers
        attachPnInteractiveRowHandlers(pnDetailBodyEl, netPeers);
    }

    /** Build a static (non-interactive) row */
    function pnStaticRow(label, value) {
        return '<div class="modal-row"><span class="modal-label">' + label + '</span><span class="modal-val">' + value + '</span></div>';
    }

    /** Build an interactive row (hover + click for sub-tooltip) */
    function pnInteractiveRow(label, count, peerIdsJson, category) {
        return '<div class="as-detail-sub-row pn-interactive-row" data-peer-ids=\'' + peerIdsJson + '\' data-category="' + category + '">'
             + '<span class="as-detail-sub-label">' + label + '</span>'
             + '<span class="as-detail-sub-val">' + count + '</span>'
             + '</div>';
    }

    // ── Overview Panel (all private networks combined — insights + search + tabs) ──

    /** Build and show the overview panel when user clicks the donut center (no specific net) */
    function openPnOverviewPanel() {
        cachePnElements();
        if (!pnDetailPanelEl || !pnDetailBodyEl) return;

        pnSelectedNet = null; // overview = no specific net
        document.body.classList.add('pn-panel-open');
        pnDetailPanelEl.classList.remove('hidden');
        requestAnimationFrame(() => pnDetailPanelEl.classList.add('visible'));

        updatePnOverviewPanel();
    }

    /** Populate the overview panel with insights, search, and category tabs */
    function updatePnOverviewPanel() {
        cachePnElements();
        if (!pnDetailBodyEl) return;

        // Hide back button in overview
        const backBtn = document.getElementById('pn-detail-back');
        if (backBtn) backBtn.classList.add('hidden');

        const ASD = window.ASDistribution;
        const rawPeers = ASD ? ASD.getLastPeersRaw() : lastPeers;
        const allPrivate = rawPeers.filter(p => PRIVATE_NETS.has(p.network));

        // Header
        if (pnDetailNetNameEl) {
            pnDetailNetNameEl.innerHTML = '<span style="color:var(--logo-primary, #f0883e)">Private</span> Networks';
        }
        if (pnDetailMetaEl) {
            pnDetailMetaEl.textContent = allPrivate.length + ' peer' + (allPrivate.length !== 1 ? 's' : '') + ' across ' + pnSegments.length + ' network' + (pnSegments.length !== 1 ? 's' : '');
        }

        if (allPrivate.length === 0) {
            pnDetailBodyEl.innerHTML = '<div class="pn-panel-empty">No private peers connected</div>';
            return;
        }

        let html = '';

        // ── Search bar ──
        html += '<div class="pn-search-wrap"><input type="text" class="pn-search-input" id="pn-overview-search" placeholder="Search peers..." autocomplete="off" spellcheck="false"></div>';

        // ── Insights section ──
        html += '<div class="modal-section-title">Scores and Insights</div>';
        const nowSec = Math.floor(Date.now() / 1000);

        // Most Stable — longest average connection
        let bestStablePeer = null, bestStableDur = 0;
        for (const p of allPrivate) {
            if (p.conntime > 0) {
                const dur = nowSec - p.conntime;
                if (dur > bestStableDur) { bestStableDur = dur; bestStablePeer = p; }
            }
        }
        if (bestStablePeer) {
            html += '<div class="pn-insight-row" data-peer-id="' + bestStablePeer.id + '" data-insight-type="stable" data-peer-net="' + (bestStablePeer.network || 'onion') + '">';
            html += '<span class="pn-insight-icon">\u23f3</span>';
            html += '<span class="pn-insight-label">Most Stable</span>';
            html += '<span class="pn-insight-val">#' + bestStablePeer.id + ' \u2014 ' + pnFmtDuration(bestStableDur) + '</span>';
            html += '</div>';
        }

        // Fastest — lowest ping
        let bestPingPeer = null, bestPing = Infinity;
        for (const p of allPrivate) {
            if (p.ping_ms > 0 && p.ping_ms < bestPing) {
                bestPing = p.ping_ms; bestPingPeer = p;
            }
        }
        if (bestPingPeer) {
            html += '<div class="pn-insight-row" data-peer-id="' + bestPingPeer.id + '" data-insight-type="fastest" data-peer-net="' + (bestPingPeer.network || 'onion') + '">';
            html += '<span class="pn-insight-icon">\u26a1</span>';
            html += '<span class="pn-insight-label">Fastest</span>';
            html += '<span class="pn-insight-val">#' + bestPingPeer.id + ' \u2014 ' + bestPing.toFixed(1) + ' ms</span>';
            html += '</div>';
        }

        // Most Bytes Sent
        let bestSentPeer = null, bestSent = 0;
        for (const p of allPrivate) {
            if ((p.bytessent || 0) > bestSent) {
                bestSent = p.bytessent; bestSentPeer = p;
            }
        }
        if (bestSentPeer) {
            html += '<div class="pn-insight-row" data-peer-id="' + bestSentPeer.id + '" data-insight-type="data-bytessent" data-peer-net="' + (bestSentPeer.network || 'onion') + '">';
            html += '<span class="pn-insight-icon">\u2b06</span>';
            html += '<span class="pn-insight-label">Most Bytes Sent</span>';
            html += '<span class="pn-insight-val">#' + bestSentPeer.id + ' \u2014 ' + fmtBytesShort(bestSent) + '</span>';
            html += '</div>';
        }

        // Most Bytes Received
        let bestRecvPeer = null, bestRecv = 0;
        for (const p of allPrivate) {
            if ((p.bytesrecv || 0) > bestRecv) {
                bestRecv = p.bytesrecv; bestRecvPeer = p;
            }
        }
        if (bestRecvPeer) {
            html += '<div class="pn-insight-row" data-peer-id="' + bestRecvPeer.id + '" data-insight-type="data-bytesrecv" data-peer-net="' + (bestRecvPeer.network || 'onion') + '">';
            html += '<span class="pn-insight-icon">\u2b07</span>';
            html += '<span class="pn-insight-label">Most Bytes Recv</span>';
            html += '<span class="pn-insight-val">#' + bestRecvPeer.id + ' \u2014 ' + fmtBytesShort(bestRecv) + '</span>';
            html += '</div>';
        }

        // ── Networks breakdown (clickable to go to per-network panel) ──
        html += '<div class="modal-section-title">Networks</div>';
        for (const seg of pnSegments) {
            const peerIds = JSON.stringify(allPrivate.filter(p => p.network === seg.net).map(p => p.id));
            html += '<div class="pn-interactive-row pn-net-link-row" data-net="' + seg.net + '" data-peer-ids=\'' + peerIds + '\' data-category="network">';
            html += '<span class="as-detail-sub-label">' + seg.label + '</span>';
            html += '<span class="as-detail-sub-val">' + seg.count + '</span>';
            html += '</div>';
        }

        // ── Software (combined across all private peers) ──
        const softwareMap = {};
        for (const p of allPrivate) {
            const sw = p.subver || 'Unknown';
            softwareMap[sw] = softwareMap[sw] || [];
            softwareMap[sw].push(p);
        }
        const swEntries = Object.entries(softwareMap).sort((a, b) => b[1].length - a[1].length);
        if (swEntries.length > 0) {
            html += '<div class="modal-section-title">Software</div>';
            for (const [sw, peers] of swEntries) {
                const peerIds = JSON.stringify(peers.map(p => p.id));
                html += pnInteractiveRow(pnEsc(sw), peers.length, peerIds, 'software');
            }
        }

        // ── Services ──
        const servicesMap = {};
        for (const p of allPrivate) {
            const svc = p.services_abbrev || '\u2014';
            servicesMap[svc] = servicesMap[svc] || [];
            servicesMap[svc].push(p);
        }
        const svcEntries = Object.entries(servicesMap).sort((a, b) => b[1].length - a[1].length);
        if (svcEntries.length > 0) {
            html += '<div class="modal-section-title">Services</div>';
            for (const [svc, peers] of svcEntries) {
                const peerIds = JSON.stringify(peers.map(p => p.id));
                html += pnInteractiveRow(pnEsc(svc), peers.length, peerIds, 'services');
            }
        }

        pnDetailBodyEl.innerHTML = html;

        // Attach interactive row handlers
        attachPnInteractiveRowHandlers(pnDetailBodyEl, allPrivate);

        // Network link rows — click to navigate to per-network panel
        // Network link rows: handled by generic pn-interactive-row handler
        // (shows submenu with peers in that network on hover/click)

        // Insight rows — hover to preview in rectangle, click to select/pin
        pnDetailBodyEl.querySelectorAll('.pn-insight-row').forEach(row => {
            row.addEventListener('mouseenter', () => {
                if (pnInsightActiveType) return; // Don't override a pinned selection
                if (pnSubTooltipPinned) return;  // Don't preview when sub-tooltip is open
                const peerId = parseInt(row.dataset.peerId);
                const insightType = row.dataset.insightType;
                if (!peerId || !insightType) return;

                // Find the peer in current data
                const allPN = nodes.filter(n => n.alive && PRIVATE_NETS.has(n.net));
                const rawPeers = allPN.map(n => lastPeers.find(p => p.id === n.peerId)).filter(Boolean);
                const peer = rawPeers.find(p => p.id === peerId);
                if (!peer) return;

                row.classList.add('pn-insight-hover');

                // Preview: show rectangle, draw line to this peer
                var data = buildPnInsightData(peer, insightType);
                showPnInsightRect(insightType, data);
                pnPreviewPeerIds = [peerId];
                privateNetLinePeer = peerId;
            });

            row.addEventListener('mouseleave', () => {
                if (pnInsightActiveType) return; // Don't dismiss if pinned
                if (pnSubTooltipPinned) return;  // Was suppressed on enter
                row.classList.remove('pn-insight-hover');
                hidePnInsightRect();
                pnPreviewPeerIds = null;
                privateNetLinePeer = null;
            });

            row.addEventListener('click', (e) => {
                e.stopPropagation();
                const peerId = parseInt(row.dataset.peerId);
                const insightType = row.dataset.insightType;
                if (!peerId || !insightType) return;

                // If clicking the already-active insight, deselect
                if (pnInsightActiveType === insightType && pnInsightActivePeerId === peerId) {
                    hidePnInsightRect();
                    clearPnInsightState();
                    return;
                }

                // Find the peer in current data
                const allPN = nodes.filter(n => n.alive && PRIVATE_NETS.has(n.net));
                const rawPeers = allPN.map(n => lastPeers.find(p => p.id === n.peerId)).filter(Boolean);
                const peer = rawPeers.find(p => p.id === peerId);
                if (!peer) return;

                // Clear any previous active
                pnDetailBodyEl.querySelectorAll('.pn-insight-row').forEach(r => {
                    r.classList.remove('pn-insight-active', 'pn-insight-hover');
                });

                // Pin this insight
                pnInsightActiveType = insightType;
                pnInsightActivePeerId = peerId;
                pnInsightActiveData = buildPnInsightData(peer, insightType);
                row.classList.add('pn-insight-active');

                // Show rectangle and set line
                showPnInsightRect(insightType, pnInsightActiveData);
                privateNetLinePeer = peerId;
                pnPreviewPeerIds = [peerId];

                // Select the peer (zoom to it, etc.)
                selectPrivatePeer(peerId);
            });
        });

        // Search — filter all rows as user types
        const searchInput = document.getElementById('pn-overview-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                const q = searchInput.value.toLowerCase().trim();
                pnDetailBodyEl.querySelectorAll('.pn-interactive-row, .pn-insight-row, .pn-net-link-row').forEach(row => {
                    if (!q) {
                        row.style.display = '';
                    } else {
                        const text = row.textContent.toLowerCase();
                        row.style.display = text.includes(q) ? '' : 'none';
                    }
                });
            });
        }

    }

    // ── Sub-Tooltip System (cascading from the panel, like AS distribution) ──

    /** Safely parse peer IDs from a row's data attribute */
    function parsePnPeerIds(rowEl) {
        try { return JSON.parse(rowEl.dataset.peerIds); }
        catch (_) { return []; }
    }

    /** Attach hover/click to interactive rows in the detail panel */
    function attachPnInteractiveRowHandlers(bodyEl, allNetPeers) {
        bodyEl.querySelectorAll('.pn-interactive-row').forEach(rowEl => {
            rowEl.addEventListener('mouseenter', (e) => {
                if (pnSubTooltipPinned) return;
                if (pnInsightActiveType) return; // Don't preview when insight is selected
                const peerIds = parsePnPeerIds(rowEl);
                const category = rowEl.dataset.category;
                const label = rowEl.querySelector('.as-detail-sub-label').textContent;
                const html = buildPnPeerListHtml(peerIds, allNetPeers, category, label);
                showPnSubTooltip(html, e);
                // Preview lines to these peers
                pnPreviewPeerIds = peerIds;
                // Preview category info in PN donut center
                previewPnCenterText(peerIds, label, allNetPeers.length);
            });
            rowEl.addEventListener('mousemove', (e) => {
                if (!pnSubTooltipPinned) positionPnSubTooltip(e);
            });
            rowEl.addEventListener('mouseleave', () => {
                if (pnSubTooltipPinned) return;
                if (pnInsightActiveType) return; // Was suppressed on enter
                hidePnSubTooltip();
                pnPreviewPeerIds = null;
                // Restore PN donut center to its previous state
                restorePnCenterText();
            });
            rowEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const peerIds = parsePnPeerIds(rowEl);
                const category = rowEl.dataset.category;
                const label = rowEl.querySelector('.as-detail-sub-label').textContent;

                // Dismiss insight rect if switching to a non-insight selection
                if (pnInsightRectVisible) {
                    hidePnInsightRect();
                    clearPnInsightState();
                }

                // Toggle: clicking same row unpins
                if (pnSubTooltipPinned && pnPinnedSubSrc === rowEl) {
                    hidePnSubTooltip();
                    rowEl.classList.remove('pn-sub-filter-active');
                    pnPreviewPeerIds = null;  // Unlock lines
                    // Restore PN donut center
                    restorePnCenterText();
                    return;
                }

                // Remove active from previous
                bodyEl.querySelectorAll('.pn-sub-filter-active').forEach(r => r.classList.remove('pn-sub-filter-active'));
                rowEl.classList.add('pn-sub-filter-active');

                const html = buildPnPeerListHtml(peerIds, allNetPeers, category, label);
                showPnSubTooltip(html, e);
                pinPnSubTooltip(html, rowEl);
                // Lock preview lines to this row's peers
                pnPreviewPeerIds = peerIds;
                // Show category info in PN donut center (stays while pinned)
                previewPnCenterText(peerIds, label, allNetPeers.length);
            });
        });
    }

    /** Preview category info in the PN donut center (label, count, percentage) */
    function previewPnCenterText(peerIds, label, totalNetPeers) {
        cachePnElements();
        if (!pnCenterLabel || !pnCenterCount || !pnCenterSub) return;
        pnCenterPreviewLabel = label;
        pnCenterPreviewPeerIds = peerIds;
        var cnt = peerIds.length;
        pnCenterLabel.textContent = cnt + ' PEER' + (cnt !== 1 ? 'S' : '');
        pnCenterLabel.style.color = 'var(--logo-accent, #7ec8e3)';
        pnCenterCount.textContent = label.toUpperCase();
        pnCenterCount.style.fontSize = '17px';
        pnCenterCount.style.fontFamily = 'var(--font-display, Cinzel, serif)';
        pnCenterCount.style.color = '';
        var pct = totalNetPeers > 0 ? Math.round((cnt / totalNetPeers) * 100) : 0;
        pnCenterSub.innerHTML = pct + '% of anonymous<br>peers';
    }

    /** Restore the PN donut center to its current state (selected net, selected peer, or default) */
    function restorePnCenterText() {
        cachePnElements();
        pnCenterPreviewLabel = null;
        pnCenterPreviewPeerIds = null;
        if (!pnCenterLabel || !pnCenterCount || !pnCenterSub) return;
        if (privateNetSelectedPeer) {
            pnCenterLabel.textContent = PN_NET_LABELS[privateNetSelectedPeer.net] || 'PEER';
            pnCenterLabel.style.color = '';
            pnCenterCount.textContent = '#' + privateNetSelectedPeer.peerId;
            pnCenterCount.style.fontSize = '22px';
            pnCenterCount.style.fontFamily = '';
            pnCenterCount.style.color = '';
            pnCenterSub.textContent = privateNetSelectedPeer.direction === 'IN' ? 'inbound' : 'outbound';
        } else if (pnSelectedNet) {
            var seg = pnSegments.find(function (s) { return s.net === pnSelectedNet; });
            var netCount = seg ? seg.count : 0;
            var totalAll = pnSegments.reduce(function (s, sg) { return s + sg.count; }, 0);
            var netPct = totalAll > 0 ? Math.round((netCount / totalAll) * 100) : 0;
            pnCenterLabel.textContent = netCount + ' PEER' + (netCount !== 1 ? 'S' : '');
            pnCenterLabel.style.color = 'var(--logo-accent, #7ec8e3)';
            pnCenterCount.textContent = (PN_NET_LABELS[pnSelectedNet] || pnSelectedNet).toUpperCase();
            pnCenterCount.style.fontSize = '22px';
            pnCenterCount.style.fontFamily = 'var(--font-display, Cinzel, serif)';
            pnCenterCount.style.color = seg ? seg.color : '';
            pnCenterSub.innerHTML = netPct + '% of anonymous<br>peers';
        } else {
            var total = pnSegments.reduce(function (s, seg) { return s + seg.count; }, 0);
            var totalAllPeers = lastPeers.length || total;
            var pnPct = totalAllPeers > 0 ? Math.round((total / totalAllPeers) * 100) : 0;
            pnCenterLabel.textContent = total + ' PEER' + (total !== 1 ? 'S' : '');
            pnCenterLabel.style.color = 'var(--logo-accent, #7ec8e3)';
            pnCenterCount.textContent = 'PRIVATE NETWORKS';
            pnCenterCount.style.fontSize = '13px';
            pnCenterCount.style.fontFamily = 'var(--font-display, Cinzel, serif)';
            pnCenterCount.style.color = '';
            pnCenterSub.innerHTML = pnPct + '% of total<br>connections';
        }
    }

    // ═══════════════════════════════════════════════════════════
    // PRIVATE NET INSIGHT RECTANGLE — replaces donut for Scores & Insights selections
    // ═══════════════════════════════════════════════════════════

    /** Show the PN insight rectangle overlay, hiding the donut SVG and center text.
     *  @param {string} type — 'stable' | 'fastest' | 'data-bytessent' | 'data-bytesrecv'
     *  @param {Object} data — { peerId, peerNet, icon, title, statText, network label } */
    function showPnInsightRect(type, data) {
        cachePnElements();
        if (!pnInsightRectEl) return;

        var netColor = getPnNetColor(data.peerNet || 'onion');

        var icon = '', title = '';
        if (type === 'stable') {
            icon = '\u23f3';
            title = 'Most Stable Connection';
        } else if (type === 'fastest') {
            icon = '\u26a1';
            title = 'Fastest Connection';
        } else if (type === 'data-bytessent') {
            icon = '\u2b06\ufe0f';
            title = 'Most Data Sent To';
        } else if (type === 'data-bytesrecv') {
            icon = '\u2b07\ufe0f';
            title = 'Most Data Recv By';
        }

        var networkLabel = PN_NET_LABELS[data.peerNet] || data.peerNet || 'Unknown';

        var html = '';
        html += '<div class="pn-insight-rect-inner">';
        html += '<div class="pn-insight-rect-badge">Scores &amp; Insights</div>';
        html += '<button class="pn-insight-rect-close" title="Back">\u2190</button>';
        html += '<div class="pn-insight-rect-content">';
        html += '<div class="pn-insight-rect-icon">' + icon + '</div>';
        html += '<div class="pn-insight-rect-title">' + pnEsc(title) + '</div>';
        html += '<div class="pn-insight-rect-rank" style="color:' + netColor + '">Rank #1</div>';
        html += '<div class="pn-insight-rect-network" style="color:' + netColor + '">' + pnEsc(networkLabel) + '</div>';
        html += '<div class="pn-insight-rect-meta">Peer #' + data.peerId + '</div>';
        if (data.statText) {
            html += '<div class="pn-insight-rect-stat" style="color:' + netColor + '">' + pnEsc(data.statText) + '</div>';
        }
        html += '</div>';
        html += '<div class="pn-insight-rect-origin" style="background:' + netColor + '; border-color:' + netColor + '; box-shadow: 0 0 8px ' + netColor + '80, 0 0 16px ' + netColor + '33"></div>';
        html += '</div>';

        pnInsightRectEl.innerHTML = html;

        // Hide donut SVG and center, show rectangle
        if (pnDonutSvg) pnDonutSvg.style.opacity = '0';
        var pnDonutCenter = document.getElementById('pn-donut-center');
        if (pnDonutCenter) pnDonutCenter.style.opacity = '0';
        pnInsightRectEl.classList.add('visible');
        pnInsightRectVisible = true;
        document.body.classList.add('pn-insight-rect-active');

        // Bind close button
        var closeBtn = pnInsightRectEl.querySelector('.pn-insight-rect-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                hidePnInsightRect();
                clearPnInsightState();
            });
        }
    }

    /** Hide the PN insight rectangle and restore the donut SVG + center text */
    function hidePnInsightRect() {
        cachePnElements();
        if (!pnInsightRectEl) return;
        pnInsightRectEl.classList.remove('visible');
        pnInsightRectVisible = false;
        document.body.classList.remove('pn-insight-rect-active');
        // Show donut SVG and center
        if (pnDonutSvg) pnDonutSvg.style.opacity = '';
        var pnDonutCenter = document.getElementById('pn-donut-center');
        if (pnDonutCenter) pnDonutCenter.style.opacity = '';
    }

    /** Clear all insight selection state */
    function clearPnInsightState() {
        pnInsightActiveType = null;
        pnInsightActivePeerId = null;
        pnInsightActiveData = null;
        privateNetLinePeer = null;
        privateNetSelectedPeer = null;
        pnPreviewPeerIds = null;
        // Remove active class from insight rows
        if (pnDetailBodyEl) {
            pnDetailBodyEl.querySelectorAll('.pn-insight-row').forEach(function(r) {
                r.classList.remove('pn-insight-active', 'pn-insight-hover');
            });
        }
        renderPnDonut();
    }

    /** Get the position of the PN insight rect origin circle (bottom center dot).
     *  Returns {x, y} in page coordinates, or null. */
    function getPnInsightRectOrigin() {
        if (!pnInsightRectEl || !pnInsightRectVisible) return null;
        var originDot = pnInsightRectEl.querySelector('.pn-insight-rect-origin');
        if (originDot) {
            var rect = originDot.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }
        }
        return null;
    }

    /** Build the insight data object for a given peer and type */
    function buildPnInsightData(peer, type) {
        var nowSec = Math.floor(Date.now() / 1000);
        var data = {
            peerId: peer.id,
            peerNet: peer.network || 'onion'
        };
        if (type === 'stable') {
            var dur = peer.conntime > 0 ? (nowSec - peer.conntime) : 0;
            data.statText = pnFmtDuration(dur);
        } else if (type === 'fastest') {
            data.statText = peer.ping_ms > 0 ? peer.ping_ms.toFixed(1) + ' ms' : '\u2014';
        } else if (type === 'data-bytessent') {
            data.statText = fmtBytesShort(peer.bytessent || 0) + ' sent';
        } else if (type === 'data-bytesrecv') {
            data.statText = fmtBytesShort(peer.bytesrecv || 0) + ' recv';
        }
        return data;
    }

    /** Build peer list HTML for the sub-tooltip */
    function buildPnPeerListHtml(peerIds, allNetPeers, category, label) {
        const idSet = new Set(peerIds);
        const matched = allNetPeers.filter(p => idSet.has(p.id));

        let html = '';
        // Title
        html += '<div class="pn-sub-tt-title">' + pnEsc(label) + '</div>';

        // Service flag expansion for services category
        if (category === 'services' && label && label !== '\u2014') {
            html += '<div class="as-sub-tt-section">';
            const parts = label.split(/[\s\/]+/);
            for (const p of parts) {
                const flag = serviceFlagFromAbbr(p.trim());
                if (flag) html += '<div class="as-sub-tt-flag">' + pnEsc(p.trim()) + ' = ' + pnEsc(serviceFlagDescription(flag)) + '</div>';
            }
            html += '</div>';
        }

        const initialShow = 6;
        html += '<div class="as-sub-tt-scroll">';
        for (let i = 0; i < matched.length; i++) {
            const p = matched[i];
            const dir = p.direction === 'IN' ? 'Inbound' : 'Outbound';
            let addr = p.addr || '';
            if (addr.length > 20) addr = addr.substring(0, 17) + '\u2026';
            const extraCls = i >= initialShow ? ' as-sub-tt-peer-extra' : '';
            const extraStyle = i >= initialShow ? ' style="display:none"' : '';
            html += '<div class="as-sub-tt-peer' + extraCls + '" data-peer-id="' + p.id + '"' + extraStyle + '>';
            html += '<span class="as-sub-tt-id pn-sub-tt-id-link" data-peer-id="' + p.id + '">ID\u00a0' + p.id + '</span>';
            html += '<span class="as-sub-tt-type">' + dir + '</span>';
            if (addr) html += '<span class="as-sub-tt-loc">' + pnEsc(addr) + '</span>';
            html += '</div>';
        }
        html += '</div>';
        if (matched.length > initialShow) {
            const remaining = matched.length - initialShow;
            html += '<div class="as-sub-tt-more pn-sub-tt-show-more">+' + remaining + ' more <span class="as-sub-tt-toggle">(show)</span></div>';
            html += '<div class="as-sub-tt-more pn-sub-tt-show-less" style="display:none"><span class="as-sub-tt-toggle">(less)</span></div>';
        }
        return html;
    }

    /** Show the sub-tooltip (positioned to the left of the detail panel) */
    function showPnSubTooltip(html, event) {
        hidePnSubSubTooltip();
        let tip = document.getElementById('pn-sub-tooltip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'pn-sub-tooltip';
            tip.className = 'as-sub-tooltip pn-sub-tooltip';
            document.body.appendChild(tip);
        }
        tip.innerHTML = html;
        tip.classList.remove('hidden');
        tip.style.display = '';
        positionPnSubTooltip(event);
        attachPnSubTooltipHandlers(tip);
    }

    function positionPnSubTooltip(event) {
        const tip = document.getElementById('pn-sub-tooltip');
        if (!tip) return;
        const rect = tip.getBoundingClientRect();
        const pad = 12;
        const panelRect = pnDetailPanelEl ? pnDetailPanelEl.getBoundingClientRect() : { left: window.innerWidth };
        let x = panelRect.left - rect.width - pad;
        if (x < pad) x = pad;
        let y = event.clientY - rect.height / 2;
        if (y < pad) y = pad;
        if (y + rect.height > window.innerHeight - pad) y = window.innerHeight - rect.height - pad;
        tip.style.left = x + 'px';
        tip.style.top = y + 'px';
    }

    function hidePnSubTooltip() {
        const tip = document.getElementById('pn-sub-tooltip');
        if (tip) {
            // Clear saved preview state BEFORE hiding, so deferred mouseleave
            // events (triggered by display:none) can't restore stale peer IDs
            // or stale donut center text (category label/peerIds)
            tip._savedPreviewPeerIds = null;
            tip._savedCenterLabel = null;
            tip._savedCenterPeerIds = null;
            tip.classList.add('hidden');
            tip.style.display = 'none';
            tip.style.pointerEvents = 'none';
        }
        pnSubTooltipPinned = false;
        pnPinnedSubSrc = null;
        pnPreviewPeerIds = null;
        // Clear PN center preview state so stale category text doesn't persist
        // across refreshes when the tooltip is dismissed without restorePnCenterText()
        pnCenterPreviewLabel = null;
        pnCenterPreviewPeerIds = null;
        hidePnSubSubTooltip();
    }

    function pinPnSubTooltip(html, srcEl) {
        pnSubTooltipPinned = true;
        pnPinnedSubSrc = srcEl || null;
        const tip = document.getElementById('pn-sub-tooltip');
        if (tip) tip.style.pointerEvents = 'auto';
    }

    /** Attach handlers to peer rows inside the sub-tooltip */
    function attachPnSubTooltipHandlers(tip) {
        // Peer ID click → select that peer on the map
        tip.querySelectorAll('.pn-sub-tt-id-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.stopPropagation();
                const peerId = parseInt(link.dataset.peerId);
                if (isNaN(peerId)) return;
                selectPrivatePeer(peerId);
            });
        });

        // Peer row hover → preview individual peer line + donut center
        tip.querySelectorAll('.as-sub-tt-peer[data-peer-id]').forEach(row => {
            row.addEventListener('mouseenter', () => {
                const peerId = parseInt(row.dataset.peerId);
                if (!isNaN(peerId)) {
                    highlightedPeerId = peerId;
                    // Save current preview (from parent row hover) and show single peer
                    if (!tip._savedPreviewPeerIds) tip._savedPreviewPeerIds = pnPreviewPeerIds;
                    if (!tip._savedCenterLabel) tip._savedCenterLabel = pnCenterPreviewLabel;
                    if (!tip._savedCenterPeerIds) tip._savedCenterPeerIds = pnCenterPreviewPeerIds;
                    pnPreviewPeerIds = [peerId];
                    // Preview this peer's info in the PN donut center
                    const peer = lastPeers.find(p => p.id === peerId);
                    if (peer && pnCenterLabel && pnCenterCount && pnCenterSub) {
                        const netLabel = PN_NET_LABELS[peer.network] || peer.network || 'PEER';
                        const netColor = getPnNetColor(peer.network);
                        pnCenterLabel.textContent = netLabel.toUpperCase();
                        pnCenterLabel.style.color = netColor;
                        pnCenterCount.textContent = '#' + peerId;
                        pnCenterCount.style.fontSize = '22px';
                        pnCenterCount.style.fontFamily = '';
                        pnCenterCount.style.color = netColor;
                        pnCenterSub.textContent = peer.direction === 'IN' ? 'inbound' : 'outbound';
                    }
                }
            });
            row.addEventListener('mouseleave', () => {
                // Preserve highlight if a peer is actively selected
                highlightedPeerId = privateNetSelectedPeer ? privateNetSelectedPeer.peerId : null;
                // Restore parent row preview (unless already cleared by hidePnSubTooltip)
                pnPreviewPeerIds = tip._savedPreviewPeerIds || null;
                tip._savedPreviewPeerIds = null;
                // Restore parent donut center text
                if (tip._savedCenterLabel && tip._savedCenterPeerIds) {
                    const allPN = nodes.filter(n => n.alive && PRIVATE_NETS.has(n.net));
                    previewPnCenterText(tip._savedCenterPeerIds, tip._savedCenterLabel, allPN.length);
                } else {
                    restorePnCenterText();
                }
                tip._savedCenterLabel = null;
                tip._savedCenterPeerIds = null;
            });
        });

        // Expand/collapse
        const showMore = tip.querySelector('.pn-sub-tt-show-more');
        const showLess = tip.querySelector('.pn-sub-tt-show-less');
        if (showMore && showLess) {
            showMore.addEventListener('click', (e) => {
                e.stopPropagation();
                tip.querySelectorAll('.as-sub-tt-peer-extra').forEach(el => el.style.display = '');
                showMore.style.display = 'none';
                showLess.style.display = '';
                const scroll = tip.querySelector('.as-sub-tt-scroll');
                if (scroll) scroll.classList.add('as-sub-tt-expanded');
            });
            showLess.addEventListener('click', (e) => {
                e.stopPropagation();
                tip.querySelectorAll('.as-sub-tt-peer-extra').forEach(el => el.style.display = 'none');
                showLess.style.display = 'none';
                showMore.style.display = '';
                const scroll = tip.querySelector('.as-sub-tt-scroll');
                if (scroll) scroll.classList.remove('as-sub-tt-expanded');
            });
        }
    }

    function hidePnSubSubTooltip() {
        const tip = document.getElementById('pn-sub-sub-tooltip');
        if (tip) {
            // Clear saved preview state BEFORE hiding (same deferred mouseleave fix)
            // Also clear saved center label/peerIds so deferred mouseleave can't
            // restore stale category text over the selected peer's donut info
            tip._savedPreviewPeerIds = null;
            tip._savedCenterLabel = null;
            tip._savedCenterPeerIds = null;
            tip.classList.add('hidden');
            tip.style.display = 'none';
            tip.style.pointerEvents = 'none';
        }
    }

    // ── Utility helpers ──

    function fmtBytesShort(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0, v = bytes;
        while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
        return v.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
    }

    /** Update all private network UI (donut + panel if open).
     *  Preserves donut visual state (selected/hovered segment, center text)
     *  so the 10-second poll refresh doesn't reset the UI. */
    function updatePrivateNetUI() {
        if (!privateNetMode) return;

        // Save donut state before rebuild
        const savedSelectedNet = pnSelectedNet;
        const savedHoveredNet = pnHoveredNet;
        // Save insight rect state before rebuild
        const savedInsightType = pnInsightActiveType;
        const savedInsightPeerId = pnInsightActivePeerId;
        const savedInsightData = pnInsightActiveData;
        const savedInsightRectVisible = pnInsightRectVisible;

        renderPnDonut();

        // Restore donut visual state after SVG rebuild
        // (renderPnDonut resets innerHTML, losing DOM classes)
        if (savedSelectedNet && pnDonutSvg) {
            pnDonutSvg.querySelectorAll('.pn-donut-segment').forEach(el => {
                if (el.dataset.net === savedSelectedNet) el.classList.add('selected');
                else el.classList.add('dimmed');
            });
        } else if (savedHoveredNet && pnDonutSvg) {
            pnDonutSvg.querySelectorAll('.pn-donut-segment').forEach(el => {
                if (el.dataset.net !== savedHoveredNet) el.classList.add('dimmed');
            });
        }

        // If insight rect was visible, re-hide the donut SVG/center (renderPnDonut restores them)
        if (savedInsightRectVisible && savedInsightType) {
            if (pnDonutSvg) pnDonutSvg.style.opacity = '0';
            var pnDonutCenter = document.getElementById('pn-donut-center');
            if (pnDonutCenter) pnDonutCenter.style.opacity = '0';
        }

        // Only update detail panel content — do NOT close/reopen it
        if (pnDetailPanelEl && pnDetailPanelEl.classList.contains('visible')) {
            if (pnSelectedNet) {
                updatePnDetailPanel(pnSelectedNet);
            } else {
                updatePnOverviewPanel();
            }
        }

        // Restore insight rect state after panel rebuild (updatePnOverviewPanel rebuilds HTML)
        if (savedInsightType && savedInsightPeerId) {
            pnInsightActiveType = savedInsightType;
            pnInsightActivePeerId = savedInsightPeerId;
            privateNetLinePeer = savedInsightPeerId;
            pnPreviewPeerIds = [savedInsightPeerId];

            // Try to find the updated peer data for a fresh stat
            const allPN = nodes.filter(n => n.alive && PRIVATE_NETS.has(n.net));
            const rawPeers = allPN.map(n => lastPeers.find(p => p.id === n.peerId)).filter(Boolean);
            const updatedPeer = rawPeers.find(p => p.id === savedInsightPeerId);
            if (updatedPeer) {
                pnInsightActiveData = buildPnInsightData(updatedPeer, savedInsightType);
                showPnInsightRect(savedInsightType, pnInsightActiveData);
            } else if (savedInsightData) {
                pnInsightActiveData = savedInsightData;
                showPnInsightRect(savedInsightType, savedInsightData);
            }

            // Re-highlight the active insight row in the rebuilt panel
            if (pnDetailBodyEl) {
                pnDetailBodyEl.querySelectorAll('.pn-insight-row').forEach(r => {
                    if (r.dataset.insightType === savedInsightType &&
                        parseInt(r.dataset.peerId) === savedInsightPeerId) {
                        r.classList.add('pn-insight-active');
                    }
                });
            }
        }

        renderPeerTable();
    }

    function applyDonutStackFitScale(container, scale, immediate) {
        if (!immediate) {
            container.style.setProperty('--as-donut-fit-scale', scale);
            return;
        }

        const previousTransition = container.style.transition;
        container.style.transition = 'none';
        container.style.setProperty('--as-donut-fit-scale', scale);
        container.offsetHeight;
        requestAnimationFrame(() => {
            container.style.transition = previousTransition;
        });
    }

    function fitDonutStackForPanelTop(panelTop, immediate) {
        const container = document.getElementById('as-distribution-container');
        if (!container) return;

        if (privateNetMode || document.body.classList.contains('donut-focused')) {
            applyDonutStackFitScale(container, '1', immediate);
            return;
        }

        const containerRect = container.getBoundingClientRect();
        const unscaledHeight = container.offsetHeight || containerRect.height;
        const top = parseFloat(getComputedStyle(container).top) || containerRect.top;
        const availableHeight = panelTop - top - 18;

        const minScale = 0.45;

        if (unscaledHeight <= 0 || availableHeight <= 0) {
            applyDonutStackFitScale(container, String(minScale), immediate);
            return;
        }

        const nextScale = Math.max(minScale, Math.min(1, availableHeight / unscaledHeight));
        applyDonutStackFitScale(container, nextScale.toFixed(3), immediate);
    }

    function fitDonutStackToViewport() {
        const container = document.getElementById('as-distribution-container');
        if (!container) return;

        const panel = document.getElementById('peer-panel');
        if (!panel || panel.classList.contains('collapsed')) {
            applyDonutStackFitScale(container, '1', false);
            return;
        }

        fitDonutStackForPanelTop(panel.getBoundingClientRect().top, false);
    }

    function scheduleDonutStackFit() {
        requestAnimationFrame(() => {
            fitDonutStackToViewport();
            requestAnimationFrame(fitDonutStackToViewport);
        });
        setTimeout(fitDonutStackToViewport, 480);
    }


    /** Render the mini private donut below the public AS donut (when private peers exist) */
    function renderPnMiniDonut() {
        const miniWrap = document.getElementById('pn-mini-donut');
        const miniSvg = document.getElementById('pn-mini-svg');
        const miniCount = document.getElementById('pn-mini-count');
        if (!miniWrap || !miniSvg) return;

        // Count private peers
        const privateNodes = nodes.filter(n => n.alive && PRIVATE_NETS.has(n.net));
        const total = privateNodes.length;

        if (total === 0 || privateNetMode) {
            miniWrap.classList.remove('visible');
            if (!miniWrap.classList.contains('hidden')) miniWrap.classList.add('hidden');
            scheduleDonutStackFit();
            return;
        }

        // Show mini donut
        miniWrap.classList.remove('hidden');
        requestAnimationFrame(() => {
            miniWrap.classList.add('visible');
            scheduleDonutStackFit();
        });

        // Build mini segments
        const counts = { onion: 0, i2p: 0, cjdns: 0 };
        for (const n of privateNodes) {
            if (counts.hasOwnProperty(n.net)) counts[n.net]++;
        }

        // Mini center count (matches the big donut's "Private / count / Peers" layout)
        if (miniCount) miniCount.textContent = total;
        const segs = [];
        for (const net of ['onion', 'i2p', 'cjdns']) {
            if (counts[net] > 0) segs.push({ net, count: counts[net], color: getPnNetColor(net) });
        }

        const cx = PN_DONUT_SIZE / 2;
        const cy = PN_DONUT_SIZE / 2;
        const outerR = PN_DONUT_RADIUS;
        const innerR = PN_INNER_RADIUS;
        let html = '';
        if (segs.length === 1) {
            html += '<circle cx="' + cx + '" cy="' + cy + '" r="' + ((outerR + innerR) / 2) + '" fill="none" stroke="' + segs[0].color + '" stroke-width="' + (outerR - innerR) + '" class="pn-mini-segment" data-net="' + segs[0].net + '" style="cursor:pointer" />';
        } else if (segs.length > 1) {
            const gap = 0.03;
            const totalGap = gap * segs.length;
            const totalAngle = 2 * Math.PI - totalGap;
            let angle = -Math.PI / 2;
            for (const seg of segs) {
                const sweep = (seg.count / total) * totalAngle;
                const endA = angle + sweep;
                const d = pnDescribeArc(cx, cy, outerR, innerR, angle, endA);
                html += '<path d="' + d + '" fill="' + seg.color + '" class="pn-mini-segment" data-net="' + seg.net + '" style="cursor:pointer" />';
                angle = endA + gap;
            }
        }
        miniSvg.innerHTML = html;

        // Attach hover/click to mini donut segments
        miniSvg.querySelectorAll('.pn-mini-segment').forEach(el => {
            el.addEventListener('mouseenter', (e) => {
                e.stopPropagation();
                const net = el.dataset.net;
                pnMiniHoverNet = net;
                pnMiniHover = true;
                // Dim other segments
                miniSvg.querySelectorAll('.pn-mini-segment').forEach(s => {
                    if (s.dataset.net !== net) s.style.opacity = '0.3';
                    else s.style.opacity = '1';
                });
                // Dim other legend items
                const miniLegendEl = document.getElementById('pn-mini-legend');
                if (miniLegendEl) {
                    miniLegendEl.querySelectorAll('.pn-mini-legend-item').forEach(item => {
                        if (item.dataset.net !== net) item.classList.add('dimmed');
                        else { item.classList.remove('dimmed'); item.classList.add('highlighted'); }
                    });
                }
                // When legends hidden, show network info in mini donut center
                if (!advSettings.showDonutLegends) {
                    const seg = segs.find(s => s.net === net);
                    const label = PN_NET_LABELS[net] || net.toUpperCase();
                    const miniCenter = document.getElementById('pn-mini-center');
                    if (miniCenter) {
                        const labelEl = miniCenter.querySelector('.pn-mini-center-label');
                        const countEl = miniCenter.querySelector('.pn-mini-center-count');
                        const subEl = miniCenter.querySelector('.pn-mini-center-sub');
                        if (labelEl) labelEl.textContent = label;
                        if (countEl) {
                            countEl.textContent = seg ? seg.count : '';
                            countEl.style.color = seg ? seg.color : '';
                        }
                        if (subEl) subEl.textContent = 'peers';
                    }
                }
            });
            el.addEventListener('mouseleave', () => {
                pnMiniHoverNet = null;
                // Undim all segments
                miniSvg.querySelectorAll('.pn-mini-segment').forEach(s => s.style.opacity = '');
                const miniLegendEl = document.getElementById('pn-mini-legend');
                if (miniLegendEl) {
                    miniLegendEl.querySelectorAll('.pn-mini-legend-item').forEach(item => {
                        item.classList.remove('dimmed', 'highlighted');
                    });
                }
                // When legends hidden, restore default mini donut center text
                if (!advSettings.showDonutLegends) {
                    const miniCenter = document.getElementById('pn-mini-center');
                    if (miniCenter) {
                        const labelEl = miniCenter.querySelector('.pn-mini-center-label');
                        const countEl = miniCenter.querySelector('.pn-mini-center-count');
                        const subEl = miniCenter.querySelector('.pn-mini-center-sub');
                        if (labelEl) labelEl.textContent = 'Private';
                        if (countEl) {
                            countEl.textContent = total;
                            countEl.style.color = '';
                        }
                        if (subEl) subEl.textContent = 'Peers';
                    }
                }
            });
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const net = el.dataset.net;
                pnMiniHover = false;
                pnMiniHoverNet = null;
                enterPrivateNetMode(null, net);
            });
        });

        // Build mini legend (network breakdown list, sorted by count descending)
        const miniLegendEl = document.getElementById('pn-mini-legend');
        if (miniLegendEl) {
            const sorted = segs.slice().sort((a, b) => b.count - a.count);
            let legendHtml = '';
            for (const seg of sorted) {
                const label = PN_NET_LABELS[seg.net] || seg.net.toUpperCase();
                legendHtml += '<div class="pn-mini-legend-item" data-net="' + seg.net + '">';
                legendHtml += '<span class="pn-mini-legend-dot" style="background:' + seg.color + '"></span>';
                legendHtml += '<span class="pn-mini-legend-name">' + label + '</span>';
                legendHtml += '<span class="pn-mini-legend-count">' + seg.count + '</span>';
                legendHtml += '</div>';
            }
            miniLegendEl.innerHTML = legendHtml;

            // Attach hover/click to mini legend items (same behavior as segment hover)
            miniLegendEl.querySelectorAll('.pn-mini-legend-item').forEach(item => {
                item.addEventListener('mouseenter', () => {
                    const net = item.dataset.net;
                    pnMiniHoverNet = net;
                    pnMiniHover = true;
                    // Dim other segments
                    miniSvg.querySelectorAll('.pn-mini-segment').forEach(s => {
                        s.style.opacity = s.dataset.net !== net ? '0.3' : '1';
                    });
                    // Dim other legend items
                    miniLegendEl.querySelectorAll('.pn-mini-legend-item').forEach(li => {
                        if (li.dataset.net !== net) li.classList.add('dimmed');
                        else { li.classList.remove('dimmed'); li.classList.add('highlighted'); }
                    });
                });
                item.addEventListener('mouseleave', () => {
                    pnMiniHoverNet = null;
                    miniSvg.querySelectorAll('.pn-mini-segment').forEach(s => s.style.opacity = '');
                    miniLegendEl.querySelectorAll('.pn-mini-legend-item').forEach(li => {
                        li.classList.remove('dimmed', 'highlighted');
                    });
                });
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const net = item.dataset.net;
                    pnMiniHover = false;
                    pnMiniHoverNet = null;
                    enterPrivateNetMode(null, net);
                });
            });
        }
        scheduleDonutStackFit();
    }

    /** Draw "PRIVATE NETWORKS" text tiled across Antarctica on the canvas */
    function drawPrivateNetworksText() {
        if (!privateNetMode) return;

        const fontSize1 = Math.max(12, Math.min(48, 18 * view.zoom));
        const fontSize2 = Math.max(10, Math.min(40, 15 * view.zoom));
        const fontSize3 = Math.max(6, Math.min(14, 5 * view.zoom));

        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Tile "PRIVATE NETWORKS" at repeating positions across Antarctica
        const tileLons = [-160, -100, -40, 30, 90, 150];
        const tileRows = [
            { lat1: -72, lat2: -77, sub: -80 },
            { lat1: -78, lat2: -83, sub: -86 },
        ];

        for (let ri = 0; ri < tileRows.length; ri++) {
            const row = tileRows[ri];
            for (let ci = 0; ci < tileLons.length; ci++) {
                const lon = tileLons[ci];
                // Stagger odd rows
                const lonOff = (ri % 2 === 1) ? 30 : 0;
                const sLon = lon + lonOff;

                // Fade outer tiles for softer edges
                const distFromCenter = Math.abs(sLon) / 180;
                const alphaFade = 1 - distFromCenter * 0.5;

                const s1 = worldToScreen(sLon, row.lat1);
                const s2 = worldToScreen(sLon, row.lat2);

                // Skip if off screen
                if (s1.x < -200 || s1.x > W + 200) continue;
                if (s1.y < -200 || s1.y > H + 200) continue;

                // Big "PRIVATE" text
                ctx.font = `900 ${fontSize1}px 'Cinzel', serif`;
                ctx.fillStyle = `rgba(240, 136, 62, ${(0.22 * alphaFade).toFixed(3)})`;
                ctx.shadowColor = `rgba(240, 136, 62, ${(0.12 * alphaFade).toFixed(3)})`;
                ctx.shadowBlur = 20;
                ctx.fillText('P R I V A T E', s1.x, s1.y);

                // "NETWORKS" below
                ctx.font = `700 ${fontSize2}px 'Cinzel', serif`;
                ctx.fillStyle = `rgba(240, 136, 62, ${(0.16 * alphaFade).toFixed(3)})`;
                ctx.shadowBlur = 15;
                ctx.fillText('N E T W O R K S', s2.x, s2.y);

                // Subtitle on first row only
                if (ri === 0 && (ci === 2 || ci === 3)) {
                    const s3 = worldToScreen(sLon, row.sub);
                    ctx.font = `600 ${fontSize3}px 'JetBrains Mono', monospace`;
                    ctx.fillStyle = `rgba(240, 136, 62, ${(0.10 * alphaFade).toFixed(3)})`;
                    ctx.shadowBlur = 8;
                    ctx.fillText('NOT REAL LOCATIONS', s3.x, s3.y);
                }
            }
        }

        ctx.restore();
    }

    /** Network type → RGB color for private-net lines (must match PN_NET_COLORS_HEX) */
    const PN_LINE_COLORS = {
        onion: { r: 21, g: 101, b: 192 },
        i2p:   { r: 210, g: 153, b: 34 },
        cjdns: { r: 188, g: 140, b: 255 }
    };

    /** Get the page-coords origin for a private network's legend dot in the mini donut.
     *  Returns {x, y} or null. */
    function getPnMiniLegendDotPos(net) {
        const legendEl = document.getElementById('pn-mini-legend');
        if (!legendEl) return null;
        const items = legendEl.querySelectorAll('.pn-mini-legend-item');
        for (const item of items) {
            if (item.dataset.net === net) {
                const dot = item.querySelector('.pn-mini-legend-dot');
                if (dot) {
                    const r = dot.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) {
                        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
                    }
                }
            }
        }
        return null;
    }

    /** Draw lines from the donut to private peers.
     *  Priority chain (first match wins):
     *  1. pnPreviewPeerIds set (panel row hover) → lines to those specific peers
     *  2. privateNetLinePeer set (selected peer) → line to that one peer
     *  3. pnHoveredNet set (donut segment hover) → lines to that net's peers
     *  4. pnSelectedNet set (donut segment selected) → lines to that net's peers
     *  5. privateNetMode with nothing selected → lines to ALL private peers
     *  6. pnMiniHover (default view) → lines from mini legend dots to private peers
     *  7. pnMiniHoverNet (default view segment hover) → lines from that legend dot */
    function drawPrivateNetLines(wrapOffsets) {
        if (!privateNetMode && !pnMiniHover) return;

        const canvasRect = canvas.getBoundingClientRect();

        // Determine a fallback donut center origin
        const originElId = privateNetMode ? 'pn-donut-wrap' : 'pn-mini-donut';
        const originEl = document.getElementById(originElId);
        if (!originEl) return;
        const fallbackRect = originEl.getBoundingClientRect();
        const fallbackOriginX = (fallbackRect.left + fallbackRect.width / 2 - canvasRect.left) * (W / canvasRect.width);
        const fallbackOriginY = (fallbackRect.top + fallbackRect.height / 2 - canvasRect.top) * (H / canvasRect.height);

        // Determine which nodes to draw lines to (priority chain)
        let privateNodes;
        const selectedId = privateNetLinePeer;

        if (privateNetMode && pnPreviewPeerIds && pnPreviewPeerIds.length > 0) {
            // Panel row hover preview → specific peer IDs
            const idSet = new Set(pnPreviewPeerIds);
            privateNodes = nodes.filter(n => n.alive && idSet.has(n.peerId));
        } else if (privateNetMode && selectedId) {
            // Selected peer → only that peer
            const selectedNode = nodes.find(n => n.peerId === selectedId && n.alive);
            privateNodes = selectedNode ? [selectedNode] : [];
        } else if (privateNetMode && pnHoveredNet) {
            // Hovered donut segment → that network's peers
            privateNodes = nodes.filter(n => n.alive && n.net === pnHoveredNet);
        } else if (privateNetMode && pnSelectedNet) {
            // Selected donut segment → that network's peers
            privateNodes = nodes.filter(n => n.alive && n.net === pnSelectedNet);
        } else if (privateNetMode) {
            // No selection/hover → ALL private peers
            privateNodes = nodes.filter(n => n.alive && PRIVATE_NETS.has(n.net));
        } else if (pnMiniHover && pnMiniHoverNet) {
            // Mini donut segment hover → that network's peers
            privateNodes = nodes.filter(n => n.alive && n.net === pnMiniHoverNet);
        } else if (pnMiniHover) {
            // Mini donut hover → all private peers
            privateNodes = nodes.filter(n => n.alive && PRIVATE_NETS.has(n.net));
        } else {
            return;
        }
        if (privateNodes.length === 0) return;

        ctx.save();
        const lineW = Math.max(1.2, 1.5 * Math.min(view.zoom / 1.5, 3));
        ctx.lineWidth = lineW;

        for (const node of privateNodes) {
            // Determine origin: insight rect, mini legend dot, or donut center.
            let originX = fallbackOriginX;
            let originY = fallbackOriginY;
            if (pnInsightRectVisible && privateNetMode) {
                // When insight rect is visible, lines come from the origin circle at the bottom
                const iro = getPnInsightRectOrigin();
                if (iro) {
                    originX = (iro.x - canvasRect.left) * (W / canvasRect.width);
                    originY = (iro.y - canvasRect.top) * (H / canvasRect.height);
                }
            } else if (pnMiniHover && !privateNetMode) {
                const dotPos = getPnMiniLegendDotPos(node.net);
                if (dotPos) {
                    originX = (dotPos.x - canvasRect.left) * (W / canvasRect.width);
                    originY = (dotPos.y - canvasRect.top) * (H / canvasRect.height);
                }
            }

            // Find best screen position
            let bestS = null;
            let bestDist = Infinity;
            for (const off of wrapOffsets) {
                const s = worldToScreen(node.lon + off, node.lat);
                const dx = s.x - W / 2;
                const dy = s.y - H / 2;
                const d = dx * dx + dy * dy;
                if (d < bestDist) { bestDist = d; bestS = s; }
            }
            if (!bestS) continue;

            const c = PN_LINE_COLORS[node.net] || { r: 240, g: 136, b: 62 };
            const dist = Math.sqrt((originX - bestS.x) ** 2 + (originY - bestS.y) ** 2);
            const isSelected = node.peerId === selectedId;
            const baseAlpha = isSelected ? 0.6 : 0.25;
            const alpha = Math.min(baseAlpha, 0.1 + (baseAlpha - 0.05) * (1 - dist / Math.max(W, H)));

            ctx.globalAlpha = 1;
            ctx.strokeStyle = `rgba(${c.r},${c.g},${c.b},${alpha.toFixed(3)})`;
            ctx.lineWidth = isSelected ? lineW * 1.5 : lineW;

            ctx.beginPath();
            ctx.moveTo(originX, originY);
            ctx.lineTo(bestS.x, bestS.y);
            ctx.stroke();

            // Small dot at the peer position
            ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${isSelected ? 0.8 : 0.5})`;
            ctx.beginPath();
            ctx.arc(bestS.x, bestS.y, isSelected ? 5 : 3, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }

    // ═══════════════════════════════════════════════════════════
    // PRIVATE-NET GROUP SELECTION — multi-peer dot click list
    // ═══════════════════════════════════════════════════════════

    /** Show a pinned selection list for multiple private peers at one map dot */
    function showPnGroupSelectionList(group, mx, my) {
        let html = '';
        html += `<div class="tt-header"><span class="tt-peer-id" style="text-align:center;flex:1">${group.length} peers at this location</span><span class="tt-group-close" title="Close">\u2715</span></div>`;
        html += `<div class="tt-section tt-group-list">`;
        group.forEach((node, i) => {
            const netLabel = NET_DISPLAY[node.net] || node.net.toUpperCase();
            const netColor = rgba(node.color, 0.9);
            const addr = shortenAddr(node);
            html += `<div class="tt-row tt-group-row tt-group-clickable" data-peer-id="${node.peerId}">`;
            html += `<span class="tt-label" style="min-width:16px">${i + 1}.</span>`;
            html += `<span class="tt-net" style="color:${netColor};min-width:36px">${netLabel}</span>`;
            html += `<span class="tt-val" style="flex:1">${addr}</span>`;
            html += `</div>`;
        });
        html += `</div>`;

        tooltipEl.innerHTML = html;
        tooltipEl.classList.remove('hidden');
        tooltipEl.classList.add('pinned');
        tooltipEl.style.pointerEvents = 'auto';
        positionTooltip(mx, my);

        // Close button
        const closeBtn = tooltipEl.querySelector('.tt-group-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                pinnedNode = null;
                groupedNodes = null;
                highlightedPeerId = null;
                hideTooltip();
                highlightTableRow(null);
                clearMapDotFilter();
            });
        }

        // Click a row to select that private peer
        tooltipEl.querySelectorAll('.tt-group-clickable').forEach(row => {
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                const peerId = parseInt(row.dataset.peerId);
                hideTooltip();
                groupedNodes = group; // preserve for back navigation
                selectPrivatePeer(peerId);
            });
        });
    }

    // ═══════════════════════════════════════════════════════════
    // PRIVATE-NET BIG POPUP — full peer detail for private peers
    // ═══════════════════════════════════════════════════════════

    const PN_CONN_TYPE_FULL = {
        'outbound-full-relay': 'Outbound Full Relay',
        'block-relay-only': 'Block Relay Only',
        'manual': 'Manual',
        'addr-fetch': 'Address Fetch',
        'feeler': 'Feeler',
        'inbound': 'Inbound',
    };

    function pnEsc(s) {
        if (!s) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function pnFmtBytes(b) {
        if (b == null || isNaN(b)) return '\u2014';
        if (b < 1024) return b + ' B';
        if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
        if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
        return (b / 1073741824).toFixed(2) + ' GB';
    }

    function pnFmtDuration(secs) {
        if (!secs || secs <= 0) return '\u2014';
        const d = Math.floor(secs / 86400);
        const h = Math.floor((secs % 86400) / 3600);
        const m = Math.floor((secs % 3600) / 60);
        if (d > 0) return d + 'd ' + h + 'h';
        if (h > 0) return h + 'h ' + m + 'm';
        return m + 'm';
    }

    function pnDetailRow(label, value) {
        return '<div class="as-detail-sub-row"><span class="as-detail-sub-label">' + pnEsc(label) + '</span><span class="as-detail-sub-val">' + value + '</span></div>';
    }

    /** Close any existing private peer big popup (with fade-out animation) */
    function closePnBigPopup() {
        if (pnPopupTimer) { clearTimeout(pnPopupTimer); pnPopupTimer = null; }
        if (pnBigPopupEl && pnBigPopupEl.parentNode) {
            pnBigPopupEl.classList.remove('visible');
            const el = pnBigPopupEl;
            pnBigPopupEl = null;
            setTimeout(() => {
                if (el && el.parentNode) el.parentNode.removeChild(el);
            }, 250);
        } else {
            pnBigPopupEl = null;
        }
    }

    /** Close popup immediately (no animation) — used before opening a new one */
    function closePnBigPopupSync() {
        if (pnBigPopupEl && pnBigPopupEl.parentNode) {
            pnBigPopupEl.parentNode.removeChild(pnBigPopupEl);
        }
        pnBigPopupEl = null;
    }

    /** Show full peer detail popup for a private network peer */
    function showPnBigPopup(node) {
        // Remove any existing popup immediately (no animation delay)
        closePnBigPopupSync();

        // Find raw peer data for full details
        const peer = lastPeers.find(p => p.id === node.peerId);
        if (!peer) return;

        // Network display
        const netColorMap = {
            onion: 'var(--net-tor, #1565c0)',
            i2p:   'var(--net-i2p, #d29922)',
            cjdns: 'var(--net-cjdns, #bc8cff)',
        };
        const netLabelMap = { onion: 'Tor', i2p: 'I2P', cjdns: 'CJDNS' };
        const netKey = (peer.network || 'onion').toLowerCase();
        const netColor = netColorMap[netKey] || 'var(--accent, #58a6ff)';
        const netLabel = netLabelMap[netKey] || netKey.toUpperCase();

        const nowSec = Math.floor(Date.now() / 1000);

        // Build popup HTML — same structure as AS distribution peer-detail-popup
        let html = '';
        html += `<div class="peer-popup-badge" style="border-color:${netColor};color:${netColor}">${netLabel}</div>`;
        html += '<div class="peer-popup-header">';
        html += `<div class="peer-popup-circle" style="background:${netColor}"></div>`;
        html += '<div class="peer-popup-title">';
        html += `<div class="peer-popup-name" style="color:${netColor}">Peer #${peer.id}</div>`;
        html += `<div class="peer-popup-addr">${pnEsc(peer.addr || '')}</div>`;
        html += `<div class="peer-popup-meta">${netLabel} \u00b7 ${peer.direction === 'IN' ? 'Inbound' : 'Outbound'}</div>`;
        html += '</div>';
        html += '</div>';

        html += '<div class="peer-popup-scroll">';

        // Identity
        html += '<div class="peer-popup-section">';
        html += '<div class="peer-popup-section-title">Identity</div>';
        html += pnDetailRow('Peer ID', '#' + peer.id);
        html += pnDetailRow('Address', pnEsc(peer.addr || '\u2014'));
        html += pnDetailRow('Network', netLabel);
        html += pnDetailRow('Direction', peer.direction === 'IN' ? 'Inbound' : 'Outbound');
        html += pnDetailRow('Conn Type', PN_CONN_TYPE_FULL[peer.connection_type] || peer.connection_type || '\u2014');
        if (peer.addrlocal) html += pnDetailRow('Your Addr', pnEsc(peer.addrlocal));
        html += '</div>';

        // Performance
        html += '<div class="peer-popup-section">';
        html += '<div class="peer-popup-section-title">Performance</div>';
        html += pnDetailRow('Ping', peer.ping_ms ? peer.ping_ms + ' ms' : '\u2014');
        html += pnDetailRow('Min Ping', peer.minping ? (peer.minping * 1000).toFixed(1) + ' ms' : '\u2014');
        html += pnDetailRow('Connected', peer.conntime_fmt || pnFmtDuration(peer.conntime ? (nowSec - peer.conntime) : 0));
        html += pnDetailRow('Last Send', peer.lastsend ? pnFmtDuration(nowSec - peer.lastsend) + ' ago' : '\u2014');
        html += pnDetailRow('Last Recv', peer.lastrecv ? pnFmtDuration(nowSec - peer.lastrecv) + ' ago' : '\u2014');
        html += pnDetailRow('Last Block', peer.last_block ? pnFmtDuration(nowSec - peer.last_block) + ' ago' : '\u2014');
        html += pnDetailRow('Last Tx', peer.last_transaction ? pnFmtDuration(nowSec - peer.last_transaction) + ' ago' : '\u2014');
        html += pnDetailRow('Bytes Sent', peer.bytessent_fmt || pnFmtBytes(peer.bytessent));
        html += pnDetailRow('Bytes Recv', peer.bytesrecv_fmt || pnFmtBytes(peer.bytesrecv));
        html += pnDetailRow('Time Offset', peer.timeoffset != null ? (peer.timeoffset === 0 ? '0s (synced)' : peer.timeoffset + 's') : '\u2014');
        html += '</div>';

        // Software
        html += '<div class="peer-popup-section">';
        html += '<div class="peer-popup-section-title">Software</div>';
        html += pnDetailRow('Version', pnEsc(peer.subver || '\u2014'));
        html += pnDetailRow('Protocol', peer.version || '\u2014');
        html += pnDetailRow('Services', renderServiceFlagList(peer.services_abbrev || ''));
        html += pnDetailRow('Start Height', peer.startingheight || '\u2014');
        html += pnDetailRow('Synced Hdrs', peer.synced_headers || '\u2014');
        html += pnDetailRow('Synced Blks', peer.synced_blocks || '\u2014');
        if (peer.transport_protocol_type) html += pnDetailRow('Transport', peer.transport_protocol_type === 'v2' ? 'v2 (BIP324 encrypted)' : peer.transport_protocol_type);
        if (peer.session_id) html += pnDetailRow('Session ID', '<span style="font-size:9px;word-break:break-all">' + pnEsc(peer.session_id) + '</span>');
        if (peer.minfeefilter != null) html += pnDetailRow('Min Fee Filter', peer.minfeefilter > 0 ? (peer.minfeefilter * 100000000).toFixed(0) + ' sat/kvB' : 'None');
        html += '</div>';

        // Privacy / Status
        html += '<div class="peer-popup-section">';
        html += '<div class="peer-popup-section-title">Privacy & Status</div>';
        html += pnDetailRow('Location', '<span style="color:var(--text-muted)">Private Network</span>');
        html += pnDetailRow('Relay Txs', peer.relaytxes != null ? (peer.relaytxes ? 'Yes' : 'No') : '\u2014');
        html += pnDetailRow('Addrman', peer.in_addrman ? 'Yes' : 'No');
        html += pnDetailRow('Addr Relay', peer.addr_relay_enabled != null ? (peer.addr_relay_enabled ? 'Yes' : 'No') : '\u2014');
        if (peer.addr_processed || peer.addr_rate_limited) html += pnDetailRow('Addr Stats', (peer.addr_processed || 0) + ' processed, ' + (peer.addr_rate_limited || 0) + ' limited');
        const hbParts = [];
        if (peer.bip152_hb_from) hbParts.push('From: Yes');
        if (peer.bip152_hb_to) hbParts.push('To: Yes');
        html += pnDetailRow('BIP152 HB', hbParts.length > 0 ? hbParts.join(', ') : 'No');
        if (peer.permissions && peer.permissions.length > 0) html += pnDetailRow('Permissions', peer.permissions.join(', '));
        html += '</div>';

        html += '</div>'; // end peer-popup-scroll

        // Footer buttons
        html += '<div class="peer-popup-footer">';
        html += `<button class="peer-popup-disconnect" data-peer-id="${peer.id}">\u2716 Disconnect</button>`;
        html += '<button class="peer-popup-close">Close</button>';
        html += '</div>';
        html += '<div class="peer-popup-resize-handle"></div>';

        // Create DOM element
        const popup = document.createElement('div');
        popup.className = 'peer-detail-popup pn-big-popup';
        popup.style.borderColor = netColor;
        popup.innerHTML = html;
        document.body.appendChild(popup);
        pnBigPopupEl = popup;

        // Animate in
        requestAnimationFrame(() => popup.classList.add('visible'));

        // Prevent map clicks
        popup.addEventListener('click', e => e.stopPropagation());

        // Draggable header
        const header = popup.querySelector('.peer-popup-header');
        if (header) {
            header.style.cursor = 'grab';
            let isDragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
            header.addEventListener('mousedown', e => {
                if (e.target.closest('button, a')) return;
                isDragging = true;
                startX = e.clientX;
                startY = e.clientY;
                const rect = popup.getBoundingClientRect();
                startLeft = rect.left;
                startTop = rect.top;
                popup.classList.add('dragging');
                header.style.cursor = 'grabbing';
                e.preventDefault();
            });
            document.addEventListener('mousemove', e => {
                if (!isDragging) return;
                popup.style.left = (startLeft + e.clientX - startX) + 'px';
                popup.style.top = (startTop + e.clientY - startY) + 'px';
                popup.style.transform = 'none';
            });
            document.addEventListener('mouseup', () => {
                if (!isDragging) return;
                isDragging = false;
                popup.classList.remove('dragging');
                header.style.cursor = 'grab';
            });
        }

        // Resizable
        const handle = popup.querySelector('.peer-popup-resize-handle');
        if (handle) {
            let isResizing = false, rStartX, rStartY, rStartW, rStartH;
            handle.addEventListener('mousedown', e => {
                isResizing = true;
                rStartX = e.clientX;
                rStartY = e.clientY;
                const r = popup.getBoundingClientRect();
                rStartW = r.width;
                rStartH = r.height;
                popup.classList.add('resizing');
                e.preventDefault();
                e.stopPropagation();
            });
            document.addEventListener('mousemove', e => {
                if (!isResizing) return;
                popup.style.width = Math.max(260, rStartW + (e.clientX - rStartX)) + 'px';
                popup.style.maxHeight = 'none';
                popup.style.height = Math.max(200, rStartH + (e.clientY - rStartY)) + 'px';
            });
            document.addEventListener('mouseup', () => {
                if (!isResizing) return;
                isResizing = false;
                popup.classList.remove('resizing');
            });
        }

        // Close button
        const closeBtn = popup.querySelector('.peer-popup-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                closePnBigPopup();
                privateNetSelectedPeer = null;
                privateNetLinePeer = null;
                highlightedPeerId = null;
                pinnedNode = null;
                // In private mode, donut stays centered; otherwise return to corner
                if (!privateNetMode && !pnSelectedNet) {
                    cachePnElements();
                    if (pnContainerEl) pnContainerEl.classList.remove('pn-focused');
                }
                updatePrivateNetUI();
            });
        }

        // Disconnect button
        const disconnBtn = popup.querySelector('.peer-popup-disconnect');
        if (disconnBtn) {
            disconnBtn.addEventListener('click', e => {
                e.stopPropagation();
                const peerId = parseInt(disconnBtn.dataset.peerId);
                if (isNaN(peerId)) return;
                showDisconnectDialog(peerId, netKey);
            });
        }
    }

    // ═══════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════

    /** Mercator projection: lon/lat -> normalised 0..1 coordinates */
    function project(lon, lat) {
        const x = (lon + 180) / 360;
        const latRad = lat * Math.PI / 180;
        const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
        const y = 0.5 - mercN / (2 * Math.PI);
        return { x, y };
    }

    /** Convert lon/lat to screen pixel coordinates using current view */
    function worldToScreen(lon, lat) {
        const p = project(lon, lat);
        const sx = (p.x - 0.5) * W * view.zoom + W / 2 - view.x * view.zoom;
        const sy = (p.y - 0.5) * H * view.zoom + H / 2 - view.y * view.zoom;
        return { x: sx, y: sy };
    }

    /** Convert screen pixel coordinates back to lon/lat */
    function screenToWorld(sx, sy) {
        const px = ((sx - W / 2 + view.x * view.zoom) / (W * view.zoom)) + 0.5;
        const py = ((sy - H / 2 + view.y * view.zoom) / (H * view.zoom)) + 0.5;
        const lon = px * 360 - 180;
        const mercN = (0.5 - py) * 2 * Math.PI;
        const lat = (2 * Math.atan(Math.exp(mercN)) - Math.PI / 2) * 180 / Math.PI;
        return { lon, lat };
    }

    function rgba(c, a) {
        return `rgba(${c.r},${c.g},${c.b},${a})`;
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function clamp(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    /** Simple deterministic hash for stable Antarctica placement */
    function hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;  // force 32-bit integer
        }
        return hash;
    }

    // ═══════════════════════════════════════════════════════════
    // ANTARCTICA PLACEMENT
    // Peers with location_status "private" or "unavailable" (or
    // overlay networks like Tor/I2P/CJDNS) are placed near
    // Antarctic research stations with a deterministic offset
    // so they don't jump around between refreshes.
    // ═══════════════════════════════════════════════════════════

    function getAntarcticaPosition(addr) {
        if (antarcticaCache[addr]) return antarcticaCache[addr];

        const h1 = hashString(addr);
        const h2 = hashString(addr + '_offset');

        // Pick a station deterministically
        const idx = Math.abs(h1) % ANTARCTICA_STATIONS.length;
        const station = ANTARCTICA_STATIONS[idx];

        // Small offset (±0.5 deg) so peers near same station don't stack
        const latOff = ((Math.abs(h2) % 100) / 100 - 0.5) * 1.0;
        const lonOff = ((Math.abs(h2 >> 8) % 100) / 100 - 0.5) * 1.0;

        const pos = { lat: station.lat + latOff, lon: station.lon + lonOff };
        antarcticaCache[addr] = pos;
        return pos;
    }

    // ═══════════════════════════════════════════════════════════
    // WORLD MAP GEOMETRY — Real Natural Earth 50m landmasses
    // Loaded from /static/assets/world-50m.json on startup.
    // Format: array of polygons, each polygon is an array of
    // rings (outer + holes), each ring is [[lon,lat], ...].
    // Source: Natural Earth (public domain), stripped to coords only.
    // 50m gives much better coastline detail than 110m (~1410 polygons
    // vs 127), while still being fast to load and render on canvas.
    // ═══════════════════════════════════════════════════════════

    async function loadWorldGeometry() {
        try {
            const polygons = await fetchStaticJson('world-50m.json');

            // Convert to our internal format: each entry is { rings: [[[lon,lat],...], ...] }
            // The first ring is the outer boundary, subsequent rings are holes (lakes etc)
            worldPolygons = polygons;
            worldReady = true;
            classifyPolarPolygons();
            rebuildWorldPaths();
            markBasemapDirty();
            console.log(`[Bitcoin Peer Map] Loaded ${polygons.length} land polygons (${polarPolygons.length} polar)`);
        } catch (err) {
            console.error('[Bitcoin Peer Map] Failed to load world geometry, using fallback:', err);
            // Fallback: minimal hand-traced outlines so the map isn't blank
            worldPolygons = [
                [[[-130,50],[-125,60],[-115,68],[-95,72],[-80,72],[-65,62],[-55,50],[-60,45],[-68,44],[-75,38],[-82,30],[-90,28],[-97,26],[-105,30],[-118,34],[-125,42],[-130,50]]],
                [[[-80,10],[-75,12],[-63,10],[-52,4],[-42,0],[-35,-5],[-35,-12],[-38,-18],[-42,-22],[-48,-28],[-52,-33],[-58,-38],[-65,-45],[-68,-53],[-72,-48],[-75,-42],[-72,-35],[-68,-28],[-70,-18],[-75,-10],[-80,0],[-80,10]]],
                [[[-10,36],[0,38],[3,42],[5,44],[2,48],[-5,48],[-8,54],[-5,58],[5,62],[12,58],[18,55],[24,58],[30,60],[35,58],[42,55],[45,50],[40,45],[35,40],[28,36],[20,36],[12,38],[5,38],[0,36],[-10,36]]],
                [[[-15,12],[-17,15],[-12,25],[-5,35],[0,36],[10,37],[12,32],[20,32],[25,30],[32,32],[35,30],[42,12],[50,2],[42,-5],[40,-12],[35,-22],[30,-30],[22,-34],[18,-34],[15,-28],[12,-18],[8,-5],[5,5],[0,6],[-8,5],[-15,12]]],
                [[[28,36],[35,40],[42,48],[50,50],[55,55],[60,60],[65,68],[75,72],[90,72],[100,68],[115,65],[125,60],[130,55],[140,55],[145,50],[142,44],[135,38],[128,34],[122,30],[115,24],[108,18],[105,12],[100,5],[98,8],[95,15],[88,22],[80,28],[72,32],[60,38],[50,40],[42,45],[35,40],[28,36]]],
                [[[115,-15],[120,-14],[130,-12],[135,-14],[140,-16],[148,-20],[152,-25],[153,-28],[150,-33],[145,-38],[137,-35],[130,-32],[122,-33],[116,-32],[114,-28],[114,-22],[118,-20],[120,-18],[115,-15]]],
            ];
            worldReady = true;
            classifyPolarPolygons();
            rebuildWorldPaths();
            markBasemapDirty();
        }
    }

    // ═══════════════════════════════════════════════════════════
    // LAKES GEOMETRY — Natural Earth 50m major lakes
    // Loaded from /static/assets/lakes-50m.json on startup.
    // Rendered on top of land using the ocean background colour
    // to "carve out" Great Lakes, Caspian Sea, Lake Victoria, etc.
    // ═══════════════════════════════════════════════════════════

    async function loadLakeGeometry() {
        try {
            lakePolygons = await fetchStaticJson('lakes-50m.json');
            lakesReady = true;
            rebuildLakePath();
            markBasemapDirty();
            console.log(`[Bitcoin Peer Map] Loaded ${lakePolygons.length} lake polygons`);
        } catch (err) {
            // Lakes are non-critical — map still works without them
            console.warn('[Bitcoin Peer Map] Failed to load lake geometry:', err);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // COUNTRY BORDERS — Natural Earth 50m admin-0 boundary lines
    // Subtle dashed lines between countries, visible at medium zoom.
    // ═══════════════════════════════════════════════════════════

    async function loadBorderGeometry() {
        try {
            borderLines = await fetchStaticJson('borders-50m.json');
            bordersReady = true;
            rebuildBorderPath();
            markBasemapDirty();
            console.log(`[Bitcoin Peer Map] Loaded ${borderLines.length} country border lines`);
        } catch (err) {
            console.warn('[Bitcoin Peer Map] Failed to load country borders:', err);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // STATE/PROVINCE BORDERS — Natural Earth 50m admin-1 lines
    // Even subtler lines, visible only at higher zoom.
    // ═══════════════════════════════════════════════════════════

    async function loadStateGeometry() {
        if (!stateGeometryPromise) {
            stateGeometryPromise = (async () => {
                try {
                    stateLines = await fetchStaticJson('states-50m.json');
                    statesReady = true;
                    rebuildStatePath();
                    markBasemapDirty();
                    console.log(`[Bitcoin Peer Map] Loaded ${stateLines.length} state/province border lines`);
                } catch (err) {
                    console.warn('[Bitcoin Peer Map] Failed to load state borders:', err);
                }
            })();
        }
        return stateGeometryPromise;
    }

    // ═══════════════════════════════════════════════════════════
    // CITIES — Natural Earth 50m populated places
    // Point data with name and population, shown at high zoom.
    // ═══════════════════════════════════════════════════════════

    async function loadCityData() {
        if (!cityDataPromise) {
            cityDataPromise = (async () => {
                try {
                    cityPoints = await fetchStaticJson('cities-50m.json');
                    citiesReady = true;
                    projectBasemapPoints(cityPoints);
                    markBasemapDirty();
                    console.log(`[Bitcoin Peer Map] Loaded ${cityPoints.length} cities`);
                } catch (err) {
                    console.warn('[Bitcoin Peer Map] Failed to load city data:', err);
                }
            })();
        }
        return cityDataPromise;
    }

    // ═══════════════════════════════════════════════════════════
    // COUNTRY LABELS — Natural Earth 50m admin-0 (English names)
    // Appear at medium zoom, before state labels.
    // ═══════════════════════════════════════════════════════════

    async function loadCountryLabels() {
        try {
            countryLabels = await fetchStaticJson('country-labels-50m.json');
            countryLabelsReady = true;
            projectBasemapPoints(countryLabels);
            markBasemapDirty();
            console.log(`[Bitcoin Peer Map] Loaded ${countryLabels.length} country labels`);
        } catch (err) {
            console.warn('[Bitcoin Peer Map] Failed to load country labels:', err);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // STATE/PROVINCE LABELS — Natural Earth 50m admin-1 (English)
    // Rendered after country labels are already visible.
    // ═══════════════════════════════════════════════════════════

    async function loadStateLabels() {
        if (!stateLabelsPromise) {
            stateLabelsPromise = (async () => {
                try {
                    stateLabels = await fetchStaticJson('state-labels-50m.json');
                    stateLabelsReady = true;
                    projectBasemapPoints(stateLabels);
                    markBasemapDirty();
                    console.log(`[Bitcoin Peer Map] Loaded ${stateLabels.length} state/province labels`);
                } catch (err) {
                    console.warn('[Bitcoin Peer Map] Failed to load state labels:', err);
                }
            })();
        }
        return stateLabelsPromise;
    }

    function ensureZoomDetailLoaded(zoom) {
        if (zoom >= ZOOM_PREFETCH_STATES) loadStateGeometry();
        if (zoom >= ZOOM_PREFETCH_STATE_LABELS) loadStateLabels();
        if (zoom >= ZOOM_PREFETCH_CITIES) loadCityData();
    }

    // ═══════════════════════════════════════════════════════════
    // DATA FETCHING — Real peers from /api/peers
    // ═══════════════════════════════════════════════════════════

    /**
     * Fetch peers from the backend and transform them into canvas nodes.
     * - Peers with valid lat/lon and location_status "ok" use real coords
     * - Private/unavailable/pending peers go to Antarctica
     * - Existing nodes that are no longer in the response start fading out
     * - New nodes fade in with a spawn animation
     */
    async function fetchPeers() {
        try {
            const resp = await fetch('/api/peers');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const peers = await resp.json();
            lastPeers = peers;

            const now = Date.now();

            // Build a set of peer IDs from this response
            const currentIds = new Set();
            for (const p of peers) currentIds.add(p.id);

            const aliveNodesByPeerId = new Map();
            for (const node of nodes) {
                if (node.alive) aliveNodesByPeerId.set(node.peerId, node);
            }

            // ── Mark departed peers for fade-out ──
            // If a node was alive and is no longer in the response, start its fade-out
            for (const node of nodes) {
                if (node.alive && !currentIds.has(node.peerId)) {
                    node.alive = false;
                    node.fadeOutStart = now;
                }
            }

            // ── Add or update existing peers ──
            for (const peer of peers) {
                const existing = aliveNodesByPeerId.get(peer.id);

                // Determine map coordinates
                let lat, lon;
                const isPrivate = (
                    peer.location_status === 'private' ||
                    peer.location_status === 'unavailable' ||
                    peer.location_status === 'pending'
                );

                if (isPrivate || (peer.lat === 0 && peer.lon === 0)) {
                    // Place in Antarctica with stable position
                    const pos = getAntarcticaPosition(peer.addr || `peer-${peer.id}`);
                    lat = pos.lat;
                    lon = pos.lon;
                } else {
                    lat = peer.lat;
                    lon = peer.lon;
                }

                // Resolve network colour
                const netKey = peer.network || 'ipv4';
                const color = NET_COLORS[netKey] || NET_COLOR_UNKNOWN;

                if (existing) {
                    // ── Update in place (peer still connected) ──
                    existing.lat = lat;
                    existing.lon = lon;
                    existing.net = netKey;      // always use authoritative API value
                    existing.color = color;     // keep colour in sync with network
                    existing.ping = peer.ping_ms || 0;
                    existing.city = peer.city || '';
                    existing.regionName = peer.regionName || '';
                    existing.country = peer.country || peer.countryCode || '';
                    existing.subver = peer.subver || '';
                    existing.direction = peer.direction || '';
                    existing.conntime = peer.conntime || 0;
                    existing.conntime_fmt = peer.conntime_fmt || '';
                    existing.isp = peer.isp || '';
                    existing.connection_type = peer.connection_type || '';
                    existing.in_addrman = peer.in_addrman || false;
                    existing.ip = peer.ip || '';
                    existing.port = peer.port || '';
                    existing.isPrivate = isPrivate;
                    existing.location_status = peer.location_status;
                } else {
                    // ── New peer — create node with spawn animation ──
                    const newNode = {
                        peerId: peer.id,
                        lat,
                        lon,
                        net: netKey,
                        color,
                        city: peer.city || '',
                        regionName: peer.regionName || '',
                        country: peer.country || peer.countryCode || '',
                        subver: peer.subver || '',
                        direction: peer.direction || '',
                        ping: peer.ping_ms || 0,
                        conntime: peer.conntime || 0,
                        conntime_fmt: peer.conntime_fmt || '',
                        isp: peer.isp || '',
                        connection_type: peer.connection_type || '',
                        in_addrman: peer.in_addrman || false,
                        isPrivate,
                        location_status: peer.location_status,
                        addr: peer.addr || '',
                        ip: peer.ip || '',
                        port: peer.port || '',
                        // Animation state
                        phase: Math.random() * Math.PI * 2,  // random pulse phase
                        spawnTime: now,                       // triggers fade-in animation
                        alive: true,
                        fadeOutStart: null,
                    };
                    nodes.push(newNode);
                    aliveNodesByPeerId.set(peer.id, newNode);
                }
            }

            // ── Garbage collect fully faded-out nodes ──
            nodes = nodes.filter(n => {
                if (!n.alive && n.fadeOutStart) {
                    return (now - n.fadeOutStart) < CFG.fadeOutDuration;
                }
                return true;
            });

            // Update connection status in the topbar
            updateConnectionStatus(peers.length > 0);

            // Update flight deck network counts
            updateFlightDeck(nodes);
            updateHUD();

            // [AS-DISTRIBUTION] Update AS Distribution donut with latest peer data (always active)
            if (window.ASDistribution) {
                window.ASDistribution.update(lastPeers);
            }

            // Refresh the peer table panel
            renderPeerTable();

            // [PRIVATE-NET] Update private network UI if in that mode
            updatePrivateNetUI();

            // [PRIVATE-NET] Auto-enter private mode if user only has private peers
            if (!privateNetMode && lastPeers.length > 0) {
                const publicPeers = lastPeers.filter(p => !PRIVATE_NETS.has(p.network));
                const privatePeers = lastPeers.filter(p => PRIVATE_NETS.has(p.network));
                if (publicPeers.length === 0 && privatePeers.length > 0) {
                    enterPrivateNetMode();
                }
            }

            // [PRIVATE-NET] Update mini donut below public donut
            renderPnMiniDonut();

            // Reset countdown timer
            lastPeerFetchTime = Date.now();

        } catch (err) {
            console.error('[Bitcoin Peer Map] Failed to fetch peers:', err);
            updateConnectionStatus(false);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // DATA FETCHING — Node info from /api/info (block height)
    // ═══════════════════════════════════════════════════════════

    let lastNodeInfo = null;  // Full /api/info response for Node Info card

    // Track previous internet state for toast notifications
    let _prevInternetState = 'green';
    let _lastRestoredToastTime = 0;

    // ── DB auto-update — once per hour while map is open ──
    const DB_AUTO_UPDATE_INTERVAL = 60 * 60 * 1000; // 1 hour
    let dbAutoUpdateTimer = null;
    const dbStatusEl = document.getElementById('db-update-status');

    /** Show a temporary message in the top bar DB status area. */
    function showDbStatus(text, cls) {
        if (!dbStatusEl) return;
        dbStatusEl.textContent = text;
        dbStatusEl.className = 'db-update-status' + (cls ? ' ' + cls : '');
        dbStatusEl.style.display = '';
    }
    function hideDbStatus() {
        if (!dbStatusEl) return;
        dbStatusEl.style.display = 'none';
        dbStatusEl.textContent = '';
        dbStatusEl.className = 'db-update-status';
    }

    function updateNodeTrafficTotals(traffic) {
        if (!traffic) return;
        const inEl = document.getElementById('mo-p2p-in');
        const outEl = document.getElementById('mo-p2p-out');
        const downloaded = Number(traffic.download_bytes || 0);
        const uploaded = Number(traffic.upload_bytes || 0);
        if (inEl) {
            inEl.textContent = traffic.download_fmt || fmtBytesShort(downloaded);
            inEl.title = `${downloaded.toLocaleString()} bytes downloaded since Bitcoin Peer Map started`;
            pulseOnChange('mo-p2p-in', downloaded, 'white');
        }
        if (outEl) {
            outEl.textContent = traffic.upload_fmt || fmtBytesShort(uploaded);
            outEl.title = `${uploaded.toLocaleString()} bytes uploaded since Bitcoin Peer Map started`;
            pulseOnChange('mo-p2p-out', uploaded, 'white');
        }
    }

    /** Run the DB auto-update sequence: countdown → check → result. */
    async function performDbAutoUpdate() {
        // 3-second countdown
        for (let i = 3; i >= 1; i--) {
            showDbStatus(`Updating DB in ${i}...`);
            await new Promise(r => setTimeout(r, 1000));
        }
        showDbStatus('Checking for DB update...');
        try {
            const resp = await fetch('/api/geodb/update', { method: 'POST' });
            const data = await resp.json();
            if (data.success) {
                const isUpToDate = data.message && data.message.toLowerCase().includes('up to date');
                showDbStatus(isUpToDate ? 'DB already up to date' : 'DB successfully updated', 'success');
            } else {
                showDbStatus('DB update failed', 'error');
            }
        } catch (e) {
            showDbStatus('DB update failed', 'error');
        }
        // Auto-dismiss after 3 seconds
        setTimeout(hideDbStatus, 3000);
    }

    /** Start or stop the hourly DB auto-update timer based on current setting. */
    function syncDbAutoUpdateTimer() {
        const stats = lastNodeInfo && lastNodeInfo.geo_db_stats;
        const autoOn = stats && stats.auto_lookup && stats.auto_update;
        if (autoOn && !dbAutoUpdateTimer) {
            dbAutoUpdateTimer = setInterval(performDbAutoUpdate, DB_AUTO_UPDATE_INTERVAL);
        } else if (!autoOn && dbAutoUpdateTimer) {
            clearInterval(dbAutoUpdateTimer);
            dbAutoUpdateTimer = null;
            hideDbStatus();
        }
    }

    async function fetchInfo() {
        try {
            const resp = await fetch(`/api/info?currency=${btcCurrency}`);
            if (!resp.ok) return;
            const info = await resp.json();

            lastNodeInfo = info;

            // Update internet connectivity indicator
            if (info.internet_state) {
                updateInternetDot(info.internet_state);
                // Show "Connection restored" toast when transitioning to green
                if (info.internet_state === 'green' && _prevInternetState !== 'green') {
                    const now = Date.now();
                    if (now - _lastRestoredToastTime > 60000) {
                        showConnectionRestoredToast();
                        _lastRestoredToastTime = now;
                    }
                }
                _prevInternetState = info.internet_state;
            }

            // Check if we should show the API-down prompt
            if (info.internet_state === 'green' && info.api_available === false && !info.geo_db_only_mode) {
                checkApiDownPrompt();
            }

            // Update BTC price in topbar
            updateBtcPricePanel(info);
            updateNodeTrafficTotals(info.node_traffic);

            // Update right overlay GeoIP DB count
            if (info.geo_db_stats && info.geo_db_stats.entries != null) {
                const geodbCountEl = document.getElementById('ro-geodb-count');
                if (geodbCountEl) geodbCountEl.textContent = info.geo_db_stats.entries.toLocaleString();
            }

            // Store flight deck scores for tooltip display
            if (info.network_scores) {
                fdCachedScores.ipv4 = info.network_scores.ipv4;
                fdCachedScores.ipv6 = info.network_scores.ipv6;
            }
            fdCachedNetworkDetails = info.network_details || {};

            updateHUD();

        } catch (err) {
            console.error('[Bitcoin Peer Map] Failed to fetch info:', err);
        }
    }

    const nodeMonitor = window.BPMNodeMonitor.create({
        getNodeInfo: () => lastNodeInfo,
        getCurrency: () => btcCurrency,
        currencyMeta: CURRENCY_META,
        formatBytes: fmtBytesShort,
    });

    function openRecentBlocksModal() {
        nodeMonitor.openRecentBlocks();
    }

    function openNodeInfoModal() {
        nodeMonitor.openNodeInfo();
    }

    function openChainTipsModal() {
        nodeMonitor.openChainTips();
    }

    /** Update BTC Price in left map overlay + ₿ symbol coloring */
    function updateBtcPricePanel(info) {
        const priceEl = document.getElementById('mo-btc-price');
        const arrowEl = document.getElementById('mo-btc-arrow');
        if (!priceEl) return;

        // Remove any existing asterisks
        let existingAst = priceEl.parentElement && priceEl.parentElement.querySelector('.price-offline-ast');
        if (existingAst) existingAst.remove();

        if (info.btc_price) {
            const price = parseFloat(info.btc_price);
            priceEl.textContent = formatCurrencyPrice(price, btcCurrency);
            priceEl.style.color = '';
            priceEl.title = '';

            // Persistent coloring on price element (red/green on change)
            const dir = pulseOnChange('mo-btc-price', price, 'persistent');

            // ₿ symbol stays gold normally — price text gets red/green
            // Arrow indicator shows direction
            if (arrowEl && dir) {
                arrowEl.textContent = dir > 0 ? '\u25B2' : '\u25BC';
                arrowEl.className = 'mo-btc-arrow ' + (dir > 0 ? 'arrow-up' : 'arrow-down');
            }
        } else if (info.last_known_price) {
            // Offline but have a cached price — show grey with red asterisks
            const price = parseFloat(info.last_known_price);
            const curr = info.last_price_currency || btcCurrency;
            priceEl.textContent = formatCurrencyPrice(price, curr);
            priceEl.style.color = 'var(--text-muted)';
            priceEl.title = 'OFFLINE... Waiting for connection';
            if (arrowEl) { arrowEl.textContent = ''; arrowEl.className = 'mo-btc-arrow'; }
            // Add red asterisks
            const ast = document.createElement('span');
            ast.className = 'price-offline-ast';
            ast.textContent = '**';
            ast.style.cssText = 'color:var(--err);font-weight:700;margin-left:3px;font-size:11px';
            priceEl.parentElement.appendChild(ast);
        } else {
            // No price at all — show dashes
            priceEl.textContent = '- - -';
            priceEl.style.color = 'var(--text-muted)';
            priceEl.title = 'OFFLINE... Waiting for connection';
            if (arrowEl) { arrowEl.textContent = ''; arrowEl.className = 'mo-btc-arrow'; }
            // Add red asterisks
            const ast = document.createElement('span');
            ast.className = 'price-offline-ast';
            ast.textContent = '**';
            ast.style.cssText = 'color:var(--err);font-weight:700;margin-left:3px;font-size:11px';
            priceEl.parentElement.appendChild(ast);
        }

        // Currency code display
        const codeEl = document.getElementById('mo-btc-currency');
        if (codeEl) codeEl.textContent = btcCurrency;
    }

    // ═══════════════════════════════════════════════════════════
    // CONNECTION STATUS (topbar dot + text)
    // ═══════════════════════════════════════════════════════════

    function updateConnectionStatus(connected) {
        const dot = document.getElementById('status-dot');
        if (!dot) return;
        if (connected) {
            dot.classList.add('online');
            dot.title = 'Bitcoin Peer Map is running and connected';
        } else {
            dot.classList.remove('online');
            dot.title = 'Bitcoin Peer Map service is not responding';
        }
    }

    // ═══════════════════════════════════════════════════════════
    // INTERNET CONNECTIVITY INDICATOR
    // ═══════════════════════════════════════════════════════════

    function updateInternetDot(state) {
        const dot = document.getElementById('internet-dot');
        const txt = document.getElementById('internet-text');
        if (!dot) return;
        dot.classList.remove('green', 'yellow', 'red');
        dot.classList.add(state);
        let tip;
        if (state === 'green') {
            tip = 'Internet connection is active';
        } else if (state === 'yellow') {
            tip = 'Detecting connection issues, retrying...';
        } else {
            tip = 'No internet connection detected';
        }
        dot.title = tip;
        if (txt) txt.title = tip;
    }

    function showConnectionRestoredToast() {
        // Remove any existing toast
        const existing = document.getElementById('conn-restored-toast');
        if (existing) existing.remove();

        const el = document.createElement('div');
        el.id = 'conn-restored-toast';
        el.textContent = 'Connection restored';
        el.style.cssText = `
            position:fixed;top:50px;left:50%;transform:translateX(-50%);z-index:400;
            padding:8px 16px;border-radius:6px;font-size:11px;font-weight:600;
            backdrop-filter:blur(12px);border:1px solid rgba(63,185,80,0.4);
            color:var(--ok);background:rgba(10,14,20,0.92);
            transition:opacity 1s;pointer-events:auto;cursor:pointer;
        `;
        document.body.appendChild(el);

        // Click anywhere to dismiss immediately
        const dismiss = () => {
            el.remove();
            document.removeEventListener('click', dismiss);
        };
        setTimeout(() => document.addEventListener('click', dismiss), 100);

        // Auto-fade after 5 seconds
        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => {
                if (el.parentElement) el.remove();
                document.removeEventListener('click', dismiss);
            }, 1000);
        }, 5000);
    }

    // API-down modal: shown when internet is up but geo API is failing
    let _apiDownModalVisible = false;

    async function checkApiDownPrompt() {
        if (_apiDownModalVisible) return;
        try {
            const resp = await fetch('/api/connectivity');
            const data = await resp.json();
            if (data.api_down_prompt && !data.geo_db_only_mode) {
                showApiDownModal();
                // Acknowledge we showed the prompt
                fetch('/api/connectivity/api-prompt-ack', { method: 'POST' });
            }
        } catch (e) { /* ignore */ }
    }

    function showApiDownModal() {
        if (_apiDownModalVisible) return;
        _apiDownModalVisible = true;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'api-down-modal';
        overlay.innerHTML = `
            <div class="modal-box" style="max-width:440px">
                <div class="modal-header">
                    <span class="modal-title">Geolocation API Not Responding</span>
                    <button class="modal-close" id="api-down-close">&times;</button>
                </div>
                <div class="modal-body" style="padding:16px">
                    <p style="color:var(--text-secondary);margin:0 0 12px;font-size:12px">
                        The geolocation API is not responding, but your internet connection appears to be working.
                    </p>
                    <p style="color:var(--text-muted);margin:0 0 16px;font-size:11px">
                        You can switch to database-only mode (uses cached locations only) or keep trying the API.
                    </p>
                    <div style="display:flex;gap:8px;justify-content:center">
                        <button class="geodb-update-btn" id="api-down-dbonly" style="background:rgba(210,153,34,0.15);color:var(--warn);border-color:rgba(210,153,34,0.3)">Database-Only Mode</button>
                        <button class="geodb-update-btn" id="api-down-keep">Keep Trying</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const close = () => {
            overlay.remove();
            _apiDownModalVisible = false;
        };

        document.getElementById('api-down-close').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

        document.getElementById('api-down-dbonly').addEventListener('click', async () => {
            try {
                await fetch('/api/geodb/toggle-db-only', { method: 'POST' });
            } catch (e) { /* ignore */ }
            close();
        });

        document.getElementById('api-down-keep').addEventListener('click', close);
    }

    // ═══════════════════════════════════════════════════════════
    // CANVAS RESIZE
    // Handles high-DPI displays via devicePixelRatio scaling.
    // ═══════════════════════════════════════════════════════════

    function sizeCanvas(targetCanvas, targetCtx, dpr) {
        const pixelWidth = Math.max(1, Math.round(W * dpr));
        const pixelHeight = Math.max(1, Math.round(H * dpr));
        if (targetCanvas.width !== pixelWidth || targetCanvas.height !== pixelHeight) {
            targetCanvas.width = pixelWidth;
            targetCanvas.height = pixelHeight;
        }
        targetCanvas.style.width = W + 'px';
        targetCanvas.style.height = H + 'px';
        targetCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function resizePeerLayer(interacting) {
        const nativeDpr = window.devicePixelRatio || 1;
        const nextDpr = Math.min(nativeDpr, interacting ? INTERACTION_DPR_CAP : BASEMAP_DPR_CAP);
        if (nextDpr === peerDpr && canvas.width && canvas.height) return;
        peerDpr = nextDpr;
        sizeCanvas(canvas, ctx, peerDpr);
    }

    function resize() {
        W = window.innerWidth;
        H = window.innerHeight;
        basemapDpr = Math.min(window.devicePixelRatio || 1, BASEMAP_DPR_CAP);
        const peerCap = document.body.classList.contains('map-interacting') ? INTERACTION_DPR_CAP : BASEMAP_DPR_CAP;
        peerDpr = Math.min(window.devicePixelRatio || 1, peerCap);
        sizeCanvas(basemapCanvas, baseCtx, basemapDpr);
        sizeCanvas(canvas, ctx, peerDpr);
        rebuildBasemapPaths();
        basemapView = null;
        basemapCanvas.style.transform = 'none';
        lastBasemapTransform = 'none';
        markBasemapDirty();
        fitDonutStackToViewport();
    }

    function setMapInteraction(active) {
        document.body.classList.toggle('map-interacting', active);
        resizePeerLayer(active);
        if (!active && !basemapMatchesView()) markBasemapDirty();
    }

    function markBasemapDirty() {
        basemapDirty = true;
    }

    function basePoint(lon, lat) {
        const p = project(lon, lat);
        return { x: (p.x - 0.5) * W, y: (p.y - 0.5) * H };
    }

    function projectBasemapPoints(points) {
        if (!W || !H) return;
        for (const point of points) {
            const p = basePoint(point.c[0], point.c[1]);
            point.mapX = p.x;
            point.mapY = p.y;
        }
    }

    function buildPolygonPath(polygons) {
        if (!W || !H || polygons.length === 0) return null;
        const path = new Path2D();
        for (const polygon of polygons) {
            for (const ring of polygon) {
                for (let i = 0; i < ring.length; i++) {
                    const p = basePoint(ring[i][0], ring[i][1]);
                    if (i === 0) path.moveTo(p.x, p.y);
                    else path.lineTo(p.x, p.y);
                }
                path.closePath();
            }
        }
        return path;
    }

    function buildLinePath(lines) {
        if (!W || !H || lines.length === 0) return null;
        const path = new Path2D();
        for (const line of lines) {
            for (let i = 0; i < line.length; i++) {
                const p = basePoint(line[i][0], line[i][1]);
                if (i === 0) path.moveTo(p.x, p.y);
                else path.lineTo(p.x, p.y);
            }
        }
        return path;
    }

    function rebuildGridPath() {
        if (!W || !H) return;
        const path = new Path2D();
        for (let lon = -180; lon <= 180; lon += CFG.gridSpacing) {
            for (let lat = -85; lat <= 85; lat += 2) {
                const p = basePoint(lon, lat);
                if (lat === -85) path.moveTo(p.x, p.y);
                else path.lineTo(p.x, p.y);
            }
        }
        for (let lat = -60; lat <= 80; lat += CFG.gridSpacing) {
            for (let lon = -180; lon <= 180; lon += 2) {
                const p = basePoint(lon, lat);
                if (lon === -180) path.moveTo(p.x, p.y);
                else path.lineTo(p.x, p.y);
            }
        }
        basemapPaths.grid = path;
    }

    function rebuildWorldPaths() {
        basemapPaths.land = buildPolygonPath(worldPolygons);
        basemapPaths.polar = buildPolygonPath(polarPolygons);
    }

    function rebuildLakePath() {
        basemapPaths.lakes = buildPolygonPath(lakePolygons);
    }

    function rebuildBorderPath() {
        basemapPaths.borders = buildLinePath(borderLines);
    }

    function rebuildStatePath() {
        basemapPaths.states = buildLinePath(stateLines);
    }

    function rebuildBasemapPaths() {
        rebuildGridPath();
        rebuildWorldPaths();
        rebuildLakePath();
        rebuildBorderPath();
        rebuildStatePath();
        projectBasemapPoints(countryLabels);
        projectBasemapPoints(stateLabels);
        projectBasemapPoints(cityPoints);
    }

    // ═══════════════════════════════════════════════════════════
    // DRAWING — Grid, landmasses, lakes, borders, cities, nodes
    // Horizontal world wrapping: the map repeats seamlessly.
    // ═══════════════════════════════════════════════════════════

    /**
     * Returns longitude offsets for world rendering.
     * Computes which copies of the 360° world are visible on screen
     * so the map repeats seamlessly when panning horizontally.
     * Always runs — even at zoom 1, the user can pan horizontally
     * so we need to fill any exposed edges with adjacent copies.
     */
    function getWrapOffsetsFor(viewState, margin) {
        const worldWidthPx = W * viewState.zoom;
        const copiesNeeded = Math.ceil(W / worldWidthPx) + 2;
        const centerX = W / 2 - viewState.x * viewState.zoom;
        const offsets = [];
        for (let i = -copiesNeeded; i <= copiesNeeded; i++) {
            const leftPx = centerX - worldWidthPx / 2 + i * worldWidthPx;
            const rightPx = leftPx + worldWidthPx;
            if (rightPx > -margin && leftPx < W + margin) {
                offsets.push(i * 360);
            }
        }
        return offsets.length > 0 ? offsets : [0];
    }

    function getWrapOffsets() {
        return getWrapOffsetsFor(view, 200);
    }

    function getBasemapWrapOffsets() {
        return getWrapOffsetsFor(view, 0);
    }

    /** Draw subtle lat/lon grid lines (with wrap) */
    function drawGrid() {
        if (!advSettings.gridVisible || !basemapPaths.grid) return;
        drawLinePathCopies(basemapPaths.grid, advColors.gridColor, advColors.gridWidth);
    }

    /**
     * Draw a set of polygons (land or lakes) at a given longitude offset.
     * Each polygon has one or more rings: ring[0] = outer boundary,
     * ring[1+] = holes. Uses evenodd fill rule to cut out holes.
     */
    function setBasemapWorldTransform(lonOffset) {
        const zoom = view.zoom;
        const wrapX = W * lonOffset / 360;
        baseCtx.setTransform(
            basemapDpr * zoom, 0, 0, basemapDpr * zoom,
            basemapDpr * (W / 2 - view.x * zoom + wrapX * zoom),
            basemapDpr * (H / 2 - view.y * zoom)
        );
    }

    function drawPolygonSet(path, fillStyle, strokeStyle) {
        if (!path) return;
        baseCtx.fillStyle = fillStyle;
        baseCtx.strokeStyle = strokeStyle;
        baseCtx.lineWidth = CFG.coastlineWidth / view.zoom;
        for (const off of getBasemapWrapOffsets()) {
            setBasemapWorldTransform(off);
            baseCtx.fill(path, 'evenodd');
            baseCtx.stroke(path);
        }
    }

    /** Draw landmasses at all visible wrap positions */
    function drawLandmasses() {
        if (!worldReady) return;
        drawPolygonSet(basemapPaths.land, advColors.landFill, advColors.landStroke);
        // Overdraw polar regions with ice at snowPoles opacity (0-100 slider → 0-1 alpha)
        if (advSettings.snowPoles > 0 && basemapPaths.polar) {
            baseCtx.globalAlpha = advSettings.snowPoles / 100;
            drawPolygonSet(basemapPaths.polar, advColors.iceFill, advColors.iceStroke);
            baseCtx.globalAlpha = 1;
        }
    }

    /** Draw lakes on top of land using ocean colour to "carve" them out */
    function drawLakes() {
        if (!lakesReady) return;
        drawPolygonSet(basemapPaths.lakes, advColors.lakeFill, advColors.lakeStroke);
    }

    /**
     * Draw line strings (borders) at a given longitude offset.
     * Used for both country and state borders.
     */
    function drawLinePathCopies(path, strokeStyle, lineWidth) {
        if (!path) return;
        baseCtx.strokeStyle = strokeStyle;
        baseCtx.lineWidth = lineWidth / view.zoom;
        for (const off of getBasemapWrapOffsets()) {
            setBasemapWorldTransform(off);
            baseCtx.stroke(path);
        }
    }

    /** Draw country borders at all zoom levels — always visible, zoom-aware strokes */
    function drawCountryBorders() {
        if (!bordersReady) return;
        const bScale = advSettings.borderScale / 50;   // 0→0, 50→1 (default), 100→2
        if (bScale < 0.01) return;                      // slider at 0 = hidden
        const alpha = (0.25 + clamp((view.zoom - 1) / 3, 0, 1) * 0.15) * bScale;
        const strokeW = Math.max(0.5, 0.8 * view.zoom * bScale);
        const rgb = advColors.borderRGB;
        drawLinePathCopies(basemapPaths.borders, `rgba(${rgb},${alpha})`, strokeW);
    }

    function basemapPointToScreen(point, lonOffset) {
        if (point.mapX === undefined || point.mapY === undefined) {
            const p = basePoint(point.c[0], point.c[1]);
            point.mapX = p.x;
            point.mapY = p.y;
        }
        return {
            x: (point.mapX + W * lonOffset / 360) * view.zoom + W / 2 - view.x * view.zoom,
            y: point.mapY * view.zoom + H / 2 - view.y * view.zoom,
        };
    }

    /**
     * Draw country name labels (admin-0, English).
     * Appears at medium zoom, before state labels — this is the first text
     * layer so every continent has named countries as geographic context.
     * Font size scales with zoom; larger countries get bigger text.
     */
    function drawCountryLabels() {
        if (!countryLabelsReady || view.zoom < ZOOM_SHOW_COUNTRY_LABELS) return;

        // Fade in gradually over a zoom range
        const alpha = clamp((view.zoom - ZOOM_SHOW_COUNTRY_LABELS) / 0.8, 0, 1) * 0.55;

        // Font size scales with zoom, starts readable and grows
        const fontSize = clamp(8 + (view.zoom - ZOOM_SHOW_COUNTRY_LABELS) * 1.2, 8, 18);

        baseCtx.setTransform(basemapDpr, 0, 0, basemapDpr, 0, 0);
        baseCtx.font = `600 ${fontSize}px 'SF Mono','Fira Code',Consolas,monospace`;
        baseCtx.textAlign = 'center';
        baseCtx.textBaseline = 'middle';

        const offsets = getBasemapWrapOffsets();

        for (const label of countryLabels) {
            for (const off of offsets) {
                const s = basemapPointToScreen(label, off);
                // Cull off-screen labels
                if (s.x < -150 || s.x > W + 150 || s.y < -30 || s.y > H + 30) continue;

                // Shadow behind text for readability against land
                baseCtx.fillStyle = `rgba(${canvasLabelColors.countryShadow},${alpha * 0.6})`;
                baseCtx.fillText(label.n, s.x + 1, s.y + 1);
                // Country name fill
                baseCtx.fillStyle = `rgba(${canvasLabelColors.countryText},${alpha})`;
                baseCtx.fillText(label.n, s.x, s.y);
            }
        }
    }

    /** Draw state/province borders (zoom >= ZOOM_SHOW_STATES), zoom-aware strokes */
    function drawStateBorders() {
        if (!statesReady || view.zoom < ZOOM_SHOW_STATES) return;
        const bScale = advSettings.borderScale / 50;
        if (bScale < 0.01) return;
        const alpha = clamp((view.zoom - ZOOM_SHOW_STATES) / 1.5, 0, 1) * 0.20 * bScale;
        const strokeW = Math.max(0.5, 0.5 * view.zoom * bScale);
        const rgb = advColors.borderRGB;
        drawLinePathCopies(basemapPaths.states, `rgba(${rgb},${alpha})`, strokeW);
    }

    /**
     * Draw state/province name labels (admin-1, English).
     * Only appears AFTER country labels are already visible.
     * Smaller and more subtle than country labels.
     */
    function drawStateLabels() {
        if (!stateLabelsReady || view.zoom < ZOOM_SHOW_STATE_LABELS) return;

        // Gradual fade-in over a zoom range
        const alpha = clamp((view.zoom - ZOOM_SHOW_STATE_LABELS) / 1.5, 0, 1) * 0.40;

        // Font size: smaller than country labels, scales gently
        const fontSize = clamp(7 + (view.zoom - ZOOM_SHOW_STATE_LABELS) * 0.6, 7, 13);

        baseCtx.setTransform(basemapDpr, 0, 0, basemapDpr, 0, 0);
        baseCtx.font = `${fontSize}px 'SF Mono','Fira Code',Consolas,monospace`;
        baseCtx.textAlign = 'center';
        baseCtx.textBaseline = 'middle';

        const offsets = getBasemapWrapOffsets();

        for (const label of stateLabels) {
            for (const off of offsets) {
                const s = basemapPointToScreen(label, off);
                if (s.x < -100 || s.x > W + 100 || s.y < -20 || s.y > H + 20) continue;

                // Subtle state/province name
                baseCtx.fillStyle = `rgba(${canvasLabelColors.stateText},${alpha})`;
                baseCtx.fillText(label.n, s.x, s.y);
            }
        }
    }

    /**
     * Draw city labels. Cities are the LAST text layer — they only
     * appear at high zoom after countries and states are visible:
     *   zoom 6.0+  → mega-cities (>5M)
     *   zoom 8.0+  → large cities (>1M)
     *   zoom 10.0+ → medium cities (>300K)
     *   zoom 12.0+ → all cities
     */
    function drawCities() {
        if (!citiesReady || view.zoom < ZOOM_SHOW_CITIES_MAJOR) return;

        // Determine population cutoff based on zoom
        let minPop;
        if (view.zoom >= ZOOM_SHOW_CITIES_ALL)        minPop = 0;
        else if (view.zoom >= ZOOM_SHOW_CITIES_MED)    minPop = 300000;
        else if (view.zoom >= ZOOM_SHOW_CITIES_LARGE)  minPop = 1000000;
        else                                            minPop = 5000000;

        // Overall opacity fades in from the first threshold
        const alpha = clamp((view.zoom - ZOOM_SHOW_CITIES_MAJOR) / 0.5, 0, 1) * 0.7;

        const offsets = getBasemapWrapOffsets();
        baseCtx.setTransform(basemapDpr, 0, 0, basemapDpr, 0, 0);
        baseCtx.textAlign = 'left';
        baseCtx.textBaseline = 'middle';

        for (const city of cityPoints) {
            if (city.p < minPop) continue;

            for (const off of offsets) {
                const s = basemapPointToScreen(city, off);
                // Cull off-screen cities
                if (s.x < -50 || s.x > W + 50 || s.y < -20 || s.y > H + 20) continue;

                // Small dot
                baseCtx.fillStyle = `rgba(${canvasLabelColors.cityDot},${alpha * 0.5})`;
                baseCtx.beginPath();
                baseCtx.arc(s.x, s.y, 1.5, 0, Math.PI * 2);
                baseCtx.fill();

                // City name label
                const fontSize = city.p > 5000000 ? 10 : city.p > 1000000 ? 9 : 8;
                baseCtx.font = `${fontSize}px 'SF Mono','Fira Code',Consolas,monospace`;
                baseCtx.fillStyle = `rgba(${canvasLabelColors.cityText},${alpha * 0.6})`;
                baseCtx.fillText(city.n, s.x + 5, s.y);
            }
        }
    }

    function renderBasemap() {
        baseCtx.setTransform(basemapDpr, 0, 0, basemapDpr, 0, 0);
        baseCtx.globalAlpha = 1;
        baseCtx.fillStyle = advColors.oceanFill;
        baseCtx.fillRect(0, 0, W, H);
        document.body.style.backgroundColor = advColors.oceanFill;

        drawGrid();
        drawLandmasses();
        drawLakes();
        drawCountryBorders();
        drawCountryLabels();
        drawStateBorders();
        drawStateLabels();
        drawCities();

        basemapView = { x: view.x, y: view.y, zoom: view.zoom };
        basemapCanvas.style.transform = 'none';
        lastBasemapTransform = 'none';
        basemapDirty = false;
    }

    function transformCachedBasemap() {
        if (!basemapView) return;
        const scale = view.zoom / basemapView.zoom;
        const translateX = W * 0.5 * (1 - scale) + view.zoom * (basemapView.x - view.x);
        const translateY = H * 0.5 * (1 - scale) + view.zoom * (basemapView.y - view.y);
        const transform = `matrix(${scale},0,0,${scale},${translateX},${translateY})`;
        if (transform !== lastBasemapTransform) {
            basemapCanvas.style.transform = transform;
            lastBasemapTransform = transform;
        }
    }

    function cameraSettled() {
        return Math.abs(view.x - targetView.x) < 0.25 &&
            Math.abs(view.y - targetView.y) < 0.25 &&
            Math.abs(view.zoom - targetView.zoom) < 0.001;
    }

    function basemapMatchesView() {
        return basemapView &&
            Math.abs(view.x - basemapView.x) < 0.25 &&
            Math.abs(view.y - basemapView.y) < 0.25 &&
            Math.abs(view.zoom - basemapView.zoom) < 0.001;
    }

    /**
     * Draw a single node at a specific screen position.
     * @param {number} brightness - connection-age brightness (0..1)
     */
    function drawNodeAt(sx, sy, c, r, gr, pulse, opacity, brightness) {
        // Outer glow (radial gradient) — modulated by brightness and pulse
        const grad = ctx.createRadialGradient(sx, sy, r, sx, sy, gr);
        grad.addColorStop(0, rgba(c, 0.55 * pulse * opacity * brightness));
        grad.addColorStop(0.5, rgba(c, 0.18 * pulse * opacity * brightness));
        grad.addColorStop(1, rgba(c, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(sx, sy, gr, 0, Math.PI * 2);
        ctx.fill();

        // Core dot — now subtly modulated by pulse for continuous twinkle
        const coreTwinkle = 0.88 + 0.12 * pulse;
        ctx.fillStyle = rgba(c, (0.5 + 0.4 * brightness) * opacity * coreTwinkle);
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();

        // Centre highlight — white on dark themes, dark on light themes
        ctx.fillStyle = rgba(nodeHighlightColor, 0.65 * pulse * opacity * brightness);
        ctx.beginPath();
        ctx.arc(sx, sy, r * 0.4, 0, Math.PI * 2);
        ctx.fill();
    }

    /**
     * Draw the arrival bloom effect — an expanding ring + brief energetic glow.
     * Runs during the first CFG.arrivalDuration ms after a node spawns.
     * This is visually distinct from the steady-state glow: a one-time event
     * that says "a new peer just appeared here."
     */
    function drawArrivalBloom(sx, sy, c, ageMs, opacity) {
        // ── Expanding ring (first arrivalRingDuration ms) ──
        if (ageMs < CFG.arrivalRingDuration) {
            const t = ageMs / CFG.arrivalRingDuration;
            const ringR = CFG.nodeRadius + (CFG.arrivalRingMaxRadius - CFG.nodeRadius) * t;
            const ringAlpha = (1 - t) * 0.6 * opacity;
            ctx.strokeStyle = rgba(c, ringAlpha);
            ctx.lineWidth = Math.max(0.5, 2 * (1 - t));
            ctx.beginPath();
            ctx.arc(sx, sy, ringR, 0, Math.PI * 2);
            ctx.stroke();
        }

        // ── Soft bloom glow (entire arrival phase, fading out) ──
        const bloomT = ageMs / CFG.arrivalDuration;
        const bloomAlpha = (1 - bloomT) * 0.3 * opacity;
        if (bloomAlpha > 0.005) {
            const bloomR = CFG.glowRadius * 1.8;
            const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, bloomR);
            grad.addColorStop(0, rgba(c, bloomAlpha));
            grad.addColorStop(0.4, rgba(c, bloomAlpha * 0.4));
            grad.addColorStop(1, rgba(c, 0));
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(sx, sy, bloomR, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /**
     * Connection-age brightness.
     * New peers start dim, veteran peers glow fully.
     * Uses the node-reported conntime Unix timestamp to compute real age.
     */
    function getAgeBrightness(node, nowSec) {
        if (!node.conntime || node.conntime <= 0) return CFG.ageBrightnessMax;
        const ageSec = nowSec - node.conntime;
        if (ageSec <= 0) return CFG.ageBrightnessMin;
        const t = clamp(ageSec / CFG.ageRampSeconds, 0, 1);
        const eased = 1 - Math.pow(1 - t, 2);
        return CFG.ageBrightnessMin + (CFG.ageBrightnessMax - CFG.ageBrightnessMin) * eased;
    }

    /**
     * Direction-aware pulse with nervousness decay.
     * - Inbound:  slow, gentle sinusoidal breathing
     * - Outbound: faster pulse with sharper abs-sin shape
     * - Young peers get extra "nervous" speed that decays with age
     */
    function getDirectionPulse(node, ageMs, connAgeSec) {
        const isInbound = node.direction === 'IN';
        const baseSpeed = isInbound ? CFG.pulseSpeedInbound : CFG.pulseSpeedOutbound;
        const depth = isInbound ? CFG.pulseDepthInbound : CFG.pulseDepthOutbound;

        // Nervousness: young peers pulse faster, decays over time
        const nervT = clamp(connAgeSec / CFG.nervousnessRampSec, 0, 1);
        const nervousness = CFG.nervousnessMax * (1 - nervT);
        const speed = baseSpeed + nervousness;

        if (isInbound) {
            return (1 - depth) + depth * (0.5 + 0.5 * Math.sin(node.phase + ageMs * speed));
        } else {
            const raw = Math.abs(Math.sin(node.phase + ageMs * speed));
            return (1 - depth) + depth * raw;
        }
    }

    /**
     * Ambient shimmer — residual twinkle for long-lived peers.
     * Three sine waves at incommensurate frequencies are multiplied
     * together; positive products create brief bright spikes.
     * Returns a value in [0, 1], concentrated near 0 (mostly quiet,
     * occasional sparkles).
     */
    function getAmbientShimmer(phase, ageMs) {
        const w1 = Math.sin(phase * 3.71  + ageMs * CFG.shimmerFreq1);
        const w2 = Math.sin(phase * 7.13  + ageMs * CFG.shimmerFreq2);
        const w3 = Math.sin(phase * 11.07 + ageMs * CFG.shimmerFreq3);
        return Math.max(0, w1 * w2 * w3);
    }

    /**
     * Draw a single node on the canvas at all visible wrap positions.
     * Lifecycle phases:
     *   1. Arrival bloom (first ~5s) — expanding ring + energetic glow
     *   2. Connected state — brightness ramps with age, nervousness decays
     *   3. Fade-out — eased dissolve when peer disconnects
     */
    function drawNode(node, now, wrapOffsets) {
        if (now < node.spawnTime) return;

        // Network filter: skip nodes whose network isn't enabled
        // (but always draw fading-out nodes so they dissolve gracefully)
        if (!passesNetFilter(node.net) && node.alive) return;

        // [AS-DISTRIBUTION] Dim peers not in the selected AS
        let asDimFactor = 1;
        if (asFilterPeerIds && node.alive && !asFilterPeerIds.has(node.peerId)) {
            asDimFactor = 0.15;
        }
        // [PRIVATE-NET] Dim peers not matching selected or hovered network segment
        if (privateNetMode && node.alive && PRIVATE_NETS.has(node.net)) {
            const activeNet = pnSelectedNet || pnHoveredNet;
            if (activeNet && node.net !== activeNet) asDimFactor = 0.15;
        }

        const c = node.color;
        const ageMs = now - node.spawnTime;
        const nowSec = Math.floor(now / 1000);
        const connAgeSec = (node.conntime > 0) ? Math.max(0, nowSec - node.conntime) : 0;
        const inArrival = ageMs < CFG.arrivalDuration;

        // ── Connection-age brightness (dim newcomers, bright veterans) ──
        const brightness = getAgeBrightness(node, nowSec);

        // ── Fade-in: ease-out curve for smooth materialization ──
        let opacity = 1;
        if (ageMs < CFG.fadeInDuration) {
            const t = ageMs / CFG.fadeInDuration;
            opacity = 1 - Math.pow(1 - t, 2);
        }

        // ── Fade-out: eased curve so nodes dissolve gracefully ──
        if (!node.alive && node.fadeOutStart) {
            const fadeAge = now - node.fadeOutStart;
            const t = clamp(fadeAge / CFG.fadeOutDuration, 0, 1);
            opacity = Math.pow(1 - t, CFG.fadeOutEase);
            if (opacity <= 0.001) return;
        }

        // ── Pulse (direction-aware + nervousness for young peers) ──
        let pulse;
        if (inArrival) {
            // During arrival: fast energetic pulse (unchanged)
            pulse = 0.55 + 0.45 * Math.abs(Math.sin(node.phase + ageMs * CFG.arrivalPulseSpeed));
        } else {
            pulse = getDirectionPulse(node, ageMs, connAgeSec);
            // Ambient shimmer: occasional bright twinkle spikes for all peers
            const shimmer = getAmbientShimmer(node.phase, ageMs);
            pulse = Math.min(pulse + CFG.shimmerStrength * shimmer, 1);
        }

        // Spawn "pop" scale effect (first 600ms)
        let scale = 1;
        if (ageMs < 600) {
            const t = ageMs / 600;
            scale = t < 0.6 ? (t / 0.6) * 1.4 : 1.4 - 0.4 * ((t - 0.6) / 0.4);
        }

        const r = CFG.nodeRadius * scale;
        const gr = CFG.glowRadius * scale * pulse;

        // [AS-DISTRIBUTION] Apply dim factor to opacity
        const finalOpacity = opacity * asDimFactor;

        // Draw at each wrap offset
        for (const off of wrapOffsets) {
            const s = worldToScreen(node.lon + off, node.lat);
            // Skip if well off screen (with bloom margin)
            const margin = inArrival ? CFG.arrivalRingMaxRadius : gr;
            if (s.x < -margin || s.x > W + margin || s.y < -margin || s.y > H + margin) continue;

            // Arrival bloom effect (ring + glow) — drawn behind the node
            if (inArrival && node.alive) {
                drawArrivalBloom(s.x, s.y, c, ageMs, finalOpacity);
            }

            drawNodeAt(s.x, s.y, c, r, gr, pulse, finalOpacity, brightness);
        }
    }

    /**
     * Draw subtle connection lines between nearby nodes.
     * Only draws between nodes that are close on screen (< 250px apart)
     * and skips fading-out nodes to avoid visual clutter.
     * Uses wrap offsets so connections work across the date line.
     */
    function drawConnectionLines(now, wrapOffsets) {
        ctx.lineWidth = 0.5;
        let aliveNodes = nodes.filter(n => n.alive);
        // Respect network filter for connection lines too
        if (!isAllNetsEnabled()) {
            aliveNodes = aliveNodes.filter(n => passesNetFilter(n.net));
        }

        for (const off of wrapOffsets) {
            for (let i = 0; i < aliveNodes.length; i++) {
                const j = (i + 1) % aliveNodes.length;
                const a = worldToScreen(aliveNodes[i].lon + off, aliveNodes[i].lat);
                const b = worldToScreen(aliveNodes[j].lon + off, aliveNodes[j].lat);

                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 250 || dist < 20) continue;

                const alpha = 0.08 * (1 - dist / 250);
                ctx.strokeStyle = rgba(aliveNodes[i].color, alpha);
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // [AS-DISTRIBUTION] Resolve which wrap copy of each peer to draw lines to.
    // Prefers the copy visible on the current map view, breaking ties by
    // proximity to viewport center.  Falls back to closest-to-center among
    // all wrap copies when nothing is on-screen.
    // ═══════════════════════════════════════════════════════════

    /**
     * For each node, pick the best wrap-copy screen position to draw a line to.
     * Priority:
     *   1. On-screen copies (within viewport + small margin) → closest to viewport center
     *   2. Near-screen copies (within a wider margin) → closest to viewport center
     *   3. Any copy → closest to viewport center
     * The returned `dist` is to the *line origin* (legend dot), used for alpha fade.
     */
    function resolveAsLinePeers(matchingNodes, wrapOffsets, originX, originY) {
        const resolved = [];
        const vcx = W / 2;  // viewport center x
        const vcy = H / 2;  // viewport center y
        // Scale margins with canvas size so behaviour is resolution-independent
        const MARGIN_ONSCREEN = Math.max(W, H) * 0.05;   // ~5% beyond edges
        const MARGIN_NEAR     = Math.max(W, H) * 0.25;   // ~25% beyond edges

        for (const node of matchingNodes) {
            let bestS = null;
            let bestCenterDist = Infinity;
            let bestTier = 3;   // lower = better (1=on-screen, 2=near, 3=any)

            for (const off of wrapOffsets) {
                const s = worldToScreen(node.lon + off, node.lat);

                // Determine which tier this copy falls into
                let tier;
                if (s.x >= -MARGIN_ONSCREEN && s.x <= W + MARGIN_ONSCREEN &&
                    s.y >= -MARGIN_ONSCREEN && s.y <= H + MARGIN_ONSCREEN) {
                    tier = 1;  // on-screen
                } else if (s.x >= -MARGIN_NEAR && s.x <= W + MARGIN_NEAR &&
                           s.y >= -MARGIN_NEAR && s.y <= H + MARGIN_NEAR) {
                    tier = 2;  // near-screen
                } else {
                    tier = 3;  // far off-screen
                }

                // Distance to viewport center (used as tie-breaker within same tier)
                const dcx = s.x - vcx;
                const dcy = s.y - vcy;
                const dc2 = dcx * dcx + dcy * dcy;

                if (tier < bestTier || (tier === bestTier && dc2 < bestCenterDist)) {
                    bestTier = tier;
                    bestCenterDist = dc2;
                    bestS = s;
                }
            }

            if (bestS) {
                // dist to line origin — kept for alpha-fade calculation
                const odx = bestS.x - originX;
                const ody = bestS.y - originY;
                resolved.push({ node, sx: bestS.x, sy: bestS.y, dist: Math.sqrt(odx * odx + ody * ody) });
            }
        }
        return resolved;
    }

    // ═══════════════════════════════════════════════════════════
    // [AS-DISTRIBUTION] Draw lines from LEGEND DOT to peers of a hovered/selected AS
    // Lines always originate from the legend dot, never the donut center.
    // Adapts to map pan/zoom since this runs every frame.
    // ═══════════════════════════════════════════════════════════

    function drawAsLines(wrapOffsets) {
        if (!asLinePeerIds || !asLineColor) return;
        const ASD = window.ASDistribution;
        if (!ASD) return;

        // Lines originate from legend dots (top-8 direct, Others for non-top-8, donut center fallback)
        let lineOrigin = null;
        if (asLineAsNum) {
            lineOrigin = ASD.getLineOriginForAs(asLineAsNum);
        }
        if (!lineOrigin) return;

        const peerIdSet = new Set(asLinePeerIds);
        const matchingNodes = nodes.filter(n => n.alive && peerIdSet.has(n.peerId));
        if (matchingNodes.length === 0) return;

        // Convert legend dot position from page coords to canvas logical coords
        const canvasRect = canvas.getBoundingClientRect();
        const originX = (lineOrigin.x - canvasRect.left) * (W / canvasRect.width);
        const originY = (lineOrigin.y - canvasRect.top) * (H / canvasRect.height);

        // Resolve screen positions: prefer on-screen copies, break ties by viewport center
        const resolved = resolveAsLinePeers(matchingNodes, wrapOffsets, originX, originY);
        if (resolved.length === 0) return;

        // Group by approximate screen position (within 8px = same dot)
        const SNAP = 8;
        const groups = [];
        for (const r of resolved) {
            let found = false;
            for (const g of groups) {
                if (Math.abs(g.cx - r.sx) < SNAP && Math.abs(g.cy - r.sy) < SNAP) {
                    g.items.push(r);
                    found = true;
                    break;
                }
            }
            if (!found) {
                groups.push({ cx: r.sx, cy: r.sy, items: [r] });
            }
        }

        // Line width from advSettings: slider 0→0.3px, 50→1.2px, 100→4px
        // Boost line width when zoomed in (single-peer zoom makes lines more visible)
        const lwSlider = advSettings.asLineWidth;
        const baseLineW = 0.3 + (lwSlider / 100) * 3.7;
        const zoomBoost = Math.min(view.zoom / 1.5, 3);  // up to 3x thicker when zoomed in
        const lineW = baseLineW * zoomBoost;
        // Fan spread from advSettings: slider 0→0%, 50→35%, 100→70% of line length
        const fanSlider = advSettings.asLineFan;
        const fanPct = (fanSlider / 100) * 0.7;
        const fanMax = 40 + (fanSlider / 100) * 120;  // 40px at 0, 160px at 100

        ctx.save();
        ctx.lineWidth = lineW;
        ctx.strokeStyle = asLineColor;

        for (const g of groups) {
            const count = g.items.length;
            // All lines converge on the same dot position (no dot displacement)
            const destX = g.cx;
            const destY = g.cy;

            for (let i = 0; i < count; i++) {
                const r = g.items[i];
                const dist = r.dist;
                const alpha = Math.min(0.45, 0.15 + 0.3 * (1 - dist / Math.max(W, H)));
                ctx.globalAlpha = alpha;
                ctx.beginPath();
                ctx.moveTo(originX, originY);

                if (count > 1) {
                    // Fan lines via curved paths — all arrive at same destination
                    const midX = (originX + destX) / 2;
                    const midY = (originY + destY) / 2;
                    const dx = destX - originX;
                    const dy = destY - originY;
                    const len = Math.sqrt(dx * dx + dy * dy) || 1;
                    const perpX = -dy / len;
                    const perpY = dx / len;
                    // Spread controlled by fan slider
                    const spread = Math.min(len * fanPct, fanMax);
                    const bulge = (i - (count - 1) / 2) * (spread / Math.max(1, count - 1));
                    ctx.quadraticCurveTo(midX + perpX * bulge, midY + perpY * bulge, destX, destY);
                } else {
                    ctx.lineTo(destX, destY);
                }
                ctx.stroke();
            }
        }

        ctx.restore();
    }

    /** Draw lines for ALL AS groups simultaneously (hover-all mode).
     *  Each group draws from its own legend dot in its own color. */
    function drawAsLinesAll(wrapOffsets) {
        if (!asLineGroups || asLineGroups.length === 0) return;
        const ASD = window.ASDistribution;
        if (!ASD) return;

        const canvasRect = canvas.getBoundingClientRect();
        const lwSlider = advSettings.asLineWidth;
        const baseLineW = 0.3 + (lwSlider / 100) * 3.7;
        const zoomBoost = Math.min(view.zoom / 1.5, 3);
        const lineW = baseLineW * zoomBoost;
        const fanSlider = advSettings.asLineFan;
        const fanPct = (fanSlider / 100) * 0.7;
        const fanMax = 40 + (fanSlider / 100) * 120;

        ctx.save();
        ctx.lineWidth = lineW;

        for (const grp of asLineGroups) {
            // Lines originate from legend dots (top-8 direct, Others for non-top-8, donut center fallback)
            let lineOrigin = ASD.getLineOriginForAs(grp.asNum);
            if (!lineOrigin) continue;

            const originX = (lineOrigin.x - canvasRect.left) * (W / canvasRect.width);
            const originY = (lineOrigin.y - canvasRect.top) * (H / canvasRect.height);

            const peerIdSet = new Set(grp.peerIds);
            const matchingNodes = nodes.filter(n => n.alive && peerIdSet.has(n.peerId));
            if (matchingNodes.length === 0) continue;

            // Resolve screen positions: prefer on-screen copies, break ties by viewport center
            const resolved = resolveAsLinePeers(matchingNodes, wrapOffsets, originX, originY);
            if (resolved.length === 0) continue;

            // Group by approximate screen position (within 8px = same dot)
            const SNAP = 8;
            const groups = [];
            for (const r of resolved) {
                let found = false;
                for (const g of groups) {
                    if (Math.abs(g.cx - r.sx) < SNAP && Math.abs(g.cy - r.sy) < SNAP) {
                        g.items.push(r);
                        found = true;
                        break;
                    }
                }
                if (!found) groups.push({ cx: r.sx, cy: r.sy, items: [r] });
            }

            ctx.strokeStyle = grp.color;

            for (const g of groups) {
                const count = g.items.length;
                const destX = g.cx;
                const destY = g.cy;

                for (let i = 0; i < count; i++) {
                    const r = g.items[i];
                    const dist = r.dist;
                    const alpha = Math.min(0.45, 0.15 + 0.3 * (1 - dist / Math.max(W, H)));
                    ctx.globalAlpha = alpha;
                    ctx.beginPath();
                    ctx.moveTo(originX, originY);

                    if (count > 1) {
                        const midX = (originX + destX) / 2;
                        const midY = (originY + destY) / 2;
                        const dx = destX - originX;
                        const dy = destY - originY;
                        const len = Math.sqrt(dx * dx + dy * dy) || 1;
                        const perpX = -dy / len;
                        const perpY = dx / len;
                        const spread = Math.min(len * fanPct, fanMax);
                        const bulge = (i - (count - 1) / 2) * (spread / Math.max(1, count - 1));
                        ctx.quadraticCurveTo(midX + perpX * bulge, midY + perpY * bulge, destX, destY);
                    } else {
                        ctx.lineTo(destX, destY);
                    }
                    ctx.stroke();
                }
            }
        }

        ctx.restore();
    }

    // ═══════════════════════════════════════════════════════════
    // HUD — Peer count, block height, network badges
    // Updated every frame from current node state.
    // ═══════════════════════════════════════════════════════════

    // Countdown timer state
    let lastPeerFetchTime = 0;
    let countdownInterval = null;
    // Poll timer IDs (stored so they can be restarted when settings change)
    let peerPollTimer = null;

    function startCountdownTimer() {
        if (countdownInterval) clearInterval(countdownInterval);
        countdownInterval = setInterval(() => {
            const cdEl = document.getElementById('mo-countdown');
            if (!cdEl) return;
            const elapsed = Date.now() - lastPeerFetchTime;
            const remaining = Math.max(0, Math.ceil((CFG.pollInterval - elapsed) / 1000));
            cdEl.textContent = remaining + 's';
        }, 1000);
    }

    function updateHUD() {
        // Count alive nodes by network type
        const netCounts = { ipv4: 0, ipv6: 0, onion: 0, i2p: 0, cjdns: 0 };
        let total = 0;
        for (const n of nodes) {
            if (!n.alive) continue;
            total++;
            if (netCounts.hasOwnProperty(n.net)) netCounts[n.net]++;
        }

        // Map overlay — peer count
        const moPeers = document.getElementById('mo-peers');
        if (moPeers) {
            moPeers.textContent = total;
            pulseOnChange('mo-peers', total, 'white');
        }

        // Map overlay — status
        const moStatus = document.getElementById('mo-status');
        if (moStatus && lastNodeInfo) {
            if (lastNodeInfo.blockchain && lastNodeInfo.blockchain.ibd) {
                moStatus.textContent = 'Syncing (IBD)';
                moStatus.style.color = 'var(--warn)';
                moStatus.title = 'Initial Block Download in progress — node is still catching up to the network';
            } else {
                moStatus.textContent = 'Synced';
                moStatus.style.color = 'var(--ok)';
                moStatus.title = 'IBD Completed — node is fully synced with the network';
            }
        }

        // Map overlay — status message (like original: "Map Loaded!" / "Locating X peers...")
        const moMsg = document.getElementById('mo-status-msg');
        if (moMsg) {
            const inetState = lastNodeInfo ? lastNodeInfo.internet_state : 'green';
            const apiAvail = lastNodeInfo ? lastNodeInfo.api_available : true;
            const dbOnly = lastNodeInfo ? lastNodeInfo.geo_db_only_mode : false;

            if (inetState === 'red') {
                moMsg.textContent = 'Offline';
                moMsg.classList.remove('loaded');
                moMsg.style.color = 'var(--err)';
            } else if (inetState === 'yellow') {
                moMsg.textContent = 'Connection issues...';
                moMsg.classList.remove('loaded');
                moMsg.style.color = 'var(--warn)';
            } else if (dbOnly || apiAvail === false) {
                moMsg.textContent = 'Geo service unavailable';
                moMsg.classList.remove('loaded');
                moMsg.style.color = 'var(--warn)';
            } else {
                moMsg.style.color = '';
                // Count pending geolocation peers
                let pendingGeo = 0;
                for (const n of nodes) {
                    if (n.alive && n.location_status === 'pending') pendingGeo++;
                }
                if (pendingGeo > 0) {
                    moMsg.textContent = `Locating ${pendingGeo} peer${pendingGeo > 1 ? 's' : ''}...`;
                    moMsg.classList.remove('loaded');
                } else if (total > 0) {
                    moMsg.textContent = 'Map Loaded!';
                    moMsg.classList.add('loaded');
                }
            }
        }

        // Badge counts (inside the filter badges)
        const bcAll = document.getElementById('bc-all');
        const bcIpv4 = document.getElementById('bc-ipv4');
        const bcIpv6 = document.getElementById('bc-ipv6');
        const bcTor = document.getElementById('bc-tor');
        const bcI2p = document.getElementById('bc-i2p');
        const bcCjdns = document.getElementById('bc-cjdns');
        if (bcAll) { bcAll.textContent = total; pulseOnChange('bc-all', total, 'white'); }
        if (bcIpv4) { bcIpv4.textContent = netCounts.ipv4; pulseOnChange('bc-ipv4', netCounts.ipv4); }
        if (bcIpv6) { bcIpv6.textContent = netCounts.ipv6; pulseOnChange('bc-ipv6', netCounts.ipv6); }
        if (bcTor) { bcTor.textContent = netCounts.onion; pulseOnChange('bc-tor', netCounts.onion); }
        if (bcI2p) { bcI2p.textContent = netCounts.i2p; pulseOnChange('bc-i2p', netCounts.i2p); }
        if (bcCjdns) { bcCjdns.textContent = netCounts.cjdns; pulseOnChange('bc-cjdns', netCounts.cjdns); }
    }

    /** Antarctica modal is now CSS-centered; no per-frame repositioning needed */
    function updateAntarcticaNote() {
        // No-op: modal is centered via CSS flexbox on the overlay
    }

    /** Update the clock display in the topbar */
    function updateClock() {
        const now = new Date();
        const h = String(now.getHours()).padStart(2, '0');
        const m = String(now.getMinutes()).padStart(2, '0');
        const s = String(now.getSeconds()).padStart(2, '0');
        clockEl.textContent = `${h}:${m}:${s}`;
    }

    // ═══════════════════════════════════════════════════════════
    // TOOLTIP — Rich peer inspection on hover
    // ═══════════════════════════════════════════════════════════

    /** Find ALL alive nodes within hit radius of screen coords. */
    function findNodesAtScreen(sx, sy) {
        const hitRadius = 12;
        const offsets = getWrapOffsets();
        const result = [];
        const seen = new Set();
        for (let i = nodes.length - 1; i >= 0; i--) {
            if (!nodes[i].alive) continue;
            if (seen.has(nodes[i].peerId)) continue;
            for (const off of offsets) {
                const s = worldToScreen(nodes[i].lon + off, nodes[i].lat);
                const dx = s.x - sx;
                const dy = s.y - sy;
                if (dx * dx + dy * dy < hitRadius * hitRadius) {
                    result.push(nodes[i]);
                    seen.add(nodes[i].peerId);
                    break;
                }
            }
        }
        return result;
    }

    /** Build a tooltip row: label + value, skipping empty values */
    function ttRow(label, value) {
        if (!value && value !== 0 && value !== false) return '';
        return `<div class="tt-row"><span class="tt-label">${label}</span><span class="tt-val">${value}</span></div>`;
    }

    /** Shorten an address for compact display (e.g. group list) */
    function shortenAddr(node) {
        const full = node.addr || (node.ip && node.port ? `${node.ip}:${node.port}` : '—');
        if (full.length <= 28) return full;
        // Tor/I2P: show first 12 chars + ...
        if (full.includes('.onion') || full.includes('.b32.i2p')) {
            return full.substring(0, 12) + '...' + full.substring(full.lastIndexOf('.'));
        }
        return full.substring(0, 25) + '...';
    }

    /** Position the tooltip near cursor coordinates */
    function positionTooltip(mx, my) {
        const ttWidth = 260;
        const ttPad = 16;
        let tx = mx + ttPad;
        if (tx + ttWidth > W - 10) {
            tx = mx - ttPad - ttWidth;
        }
        let ty = my - 10;
        tooltipEl.style.left = Math.max(10, tx) + 'px';
        tooltipEl.style.top = Math.max(48, ty) + 'px';
    }

    /** Display hover tooltip for a group of nodes at one map dot.
     *  Single node: shows peer details. Multiple: shows compact numbered list. */
    function showGroupHoverTooltip(group, mx, my) {
        let html = '';
        if (group.length === 1) {
            // Single peer: show normal detail tooltip (non-interactive)
            html = buildPeerDetailHtml(group[0], false, false);
        } else {
            // Multi-peer: compact numbered list
            html += `<div class="tt-header"><span class="tt-peer-id" style="text-align:center;flex:1">${group.length} peers at this location</span></div>`;
            html += `<div class="tt-section tt-group-list">`;
            group.forEach((node, i) => {
                const netLabel = NET_DISPLAY[node.net] || node.net.toUpperCase();
                const netColor = rgba(node.color, 0.9);
                const addr = shortenAddr(node);
                html += `<div class="tt-row tt-group-row">`;
                html += `<span class="tt-label" style="min-width:16px">${i + 1}.</span>`;
                html += `<span class="tt-net" style="color:${netColor};min-width:36px">${netLabel}</span>`;
                html += `<span class="tt-val" style="flex:1">${addr}</span>`;
                html += `</div>`;
            });
            html += `</div>`;
        }
        tooltipEl.innerHTML = html;
        tooltipEl.classList.remove('hidden');
        tooltipEl.classList.remove('pinned');
        tooltipEl.style.pointerEvents = 'none';
        positionTooltip(mx, my);
    }

    /** Display pinned selection list for a multi-peer dot (clickable rows). */
    function showGroupSelectionList(group, mx, my) {
        let html = '';
        html += `<div class="tt-header"><span class="tt-peer-id" style="text-align:center;flex:1">${group.length} peers at this location</span><span class="tt-group-close" title="Close">\u2715</span></div>`;
        html += `<div class="tt-section tt-group-list">`;
        group.forEach((node, i) => {
            const netLabel = NET_DISPLAY[node.net] || node.net.toUpperCase();
            const netColor = rgba(node.color, 0.9);
            const addr = shortenAddr(node);
            html += `<div class="tt-row tt-group-row tt-group-clickable" data-peer-id="${node.peerId}">`;
            html += `<span class="tt-label" style="min-width:16px">${i + 1}.</span>`;
            html += `<span class="tt-net" style="color:${netColor};min-width:36px">${netLabel}</span>`;
            html += `<span class="tt-val" style="flex:1">${addr}</span>`;
            html += `</div>`;
        });
        html += `</div>`;

        tooltipEl.innerHTML = html;
        tooltipEl.classList.remove('hidden');
        tooltipEl.classList.add('pinned');
        tooltipEl.style.pointerEvents = 'auto';
        positionTooltip(mx, my);

        // Bind close button
        const closeBtn = tooltipEl.querySelector('.tt-group-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                pinnedNode = null;
                groupedNodes = null;
                highlightedPeerId = null;
                hideTooltip();
                highlightTableRow(null);
                clearMapDotFilter();
            });
        }

        // Bind click on each row to drill into that peer
        tooltipEl.querySelectorAll('.tt-group-clickable').forEach(row => {
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                const peerId = parseInt(row.dataset.peerId);
                const node = group.find(n => n.peerId === peerId);
                if (node) {
                    // Filter table to just this one peer
                    clearMapDotFilter();
                    groupedNodes = null;
                    mapFilterPeerIds = new Set([peerId]);
                    renderPeerTable();
                    hideTooltip(); // close the group list tooltip

                    // [AS-DISTRIBUTION] Open full peer detail FIRST (before zoom)
                    const ASD = window.ASDistribution;
                    if (ASD) {
                        const rawPeers = ASD.getLastPeersRaw();
                        const peerData = rawPeers.find(p => p.id === peerId);
                        if (peerData) {
                            ASD.openPeerDetailPanel(peerData, 'map-group');
                        }
                    }

                    // Zoom to peer (same as table-row and single-dot click)
                    const p = project(node.lon, node.lat);
                    const topbarH2 = 40;
                    const panelH2 = panelEl.classList.contains('collapsed') ? 32 : 340;
                    const visibleH2 = (H - panelH2) - topbarH2;
                    const targetSY = topbarH2 + visibleH2 * 0.35;
                    let z = 3;
                    for (; z <= CFG.maxZoom; z += 0.2) {
                        const ofc2 = (H / 2 - targetSY) / z;
                        const cY = (p.y - 0.5) * H - ofc2;
                        const mnY = (project(0, 85).y - 0.5) * H + H / (2 * z);
                        const mxY = (project(0, -85).y - 0.5) * H - H / (2 * z);
                        if (mnY < mxY && cY >= mnY && cY <= mxY) break;
                    }
                    z = Math.min(z, CFG.maxZoom);
                    const ofc2 = (H / 2 - targetSY) / z;
                    // Nudge peer slightly right of center so it's not behind the donut
                    const xNudge = (W * 0.04) / z;
                    view.x = (p.x - 0.5) * W - xNudge;
                    view.y = 0;
                    view.zoom = 1;
                    targetView.x = (p.x - 0.5) * W - xNudge;
                    targetView.y = (p.y - 0.5) * H - ofc2;
                    targetView.zoom = z;
                    highlightedPeerId = peerId;
                    pinnedNode = node;

                    if (!panelEl.classList.contains('collapsed')) {
                        highlightTableRow(peerId, true);
                    }
                }
            });
        });
    }

    /** Build the HTML for a single peer detail tooltip.
     *  @param {boolean} hasBackNav - show "← List" link in header
     *  @param {boolean} pinned - show disconnect button */
    function buildPeerDetailHtml(node, pinned, hasBackNav) {
        const netLabel = NET_DISPLAY[node.net] || node.net.toUpperCase();
        const netColor = rgba(node.color, 0.9);

        // Direction + connection type
        const dirLabel = node.direction === 'IN' ? 'Inbound' : 'Outbound';
        const typeStr = node.connection_type
            ? `${dirLabel} / ${node.connection_type}`
            : dirLabel;

        // Address display
        const addrDisplay = (node.ip && node.port)
            ? `${node.ip}:${node.port}`
            : node.addr || '—';

        // Location: build from parts, skip empties
        let locationParts = [];
        if (!node.isPrivate) {
            if (node.city) locationParts.push(node.city);
            if (node.regionName) locationParts.push(node.regionName);
            if (node.country) locationParts.push(node.country);
        }
        const locationStr = locationParts.length > 0
            ? locationParts.join(', ')
            : '<span class="tt-muted">Private Network</span>';

        // Addrman
        const addrmanStr = node.isPrivate ? '—' : (node.in_addrman ? 'Yes' : 'No');

        // Build tooltip HTML — grouped sections
        let html = '';

        // ── Header: left action | center #ID | right network ──
        html += `<div class="tt-header">`;
        if (hasBackNav) {
            html += `<a class="tt-back-link" href="#">&#8592; List</a>`;
        } else if (pinned) {
            html += `<a class="tt-back-link tt-exit-link" href="#">Exit</a>`;
        } else {
            html += `<span class="tt-back-link"></span>`;
        }
        html += `<span class="tt-peer-id">#${node.peerId}</span>`;
        html += `<span class="tt-net" style="color:${netColor}">${netLabel}</span>`;
        html += `</div>`;

        // ── Identity / Connection ──
        html += `<div class="tt-section">`;
        html += ttRow('Address', addrDisplay);
        html += ttRow('Type', typeStr);
        if (node.subver) html += ttRow('Software', node.subver);
        html += `</div>`;

        // ── Location ──
        html += `<div class="tt-section">`;
        html += `<div class="tt-row"><span class="tt-label">Location</span><span class="tt-val">${locationStr}</span></div>`;
        if (!node.isPrivate && node.isp) html += ttRow('ISP', node.isp);
        html += ttRow('Addrman', addrmanStr);
        html += `</div>`;

        // ── Performance ──
        html += `<div class="tt-section">`;
        html += ttRow('Ping', node.ping + 'ms');
        if (node.conntime_fmt) html += ttRow('Uptime', node.conntime_fmt);
        html += `</div>`;

        // ── Actions (only when pinned) ──
        if (pinned) {
            html += `<div class="tt-actions">`;
            html += `<button class="tt-action-btn tt-disconnect" data-id="${node.peerId}" data-net="${node.net}">Disconnect</button>`;
            html += `</div>`;
        }

        return html;
    }

    /** Show a pinned single-peer detail tooltip with optional back navigation.
     *  @param {boolean} hasBackNav - if true, header shows "← List" */
    function showPinnedPeerDetail(node, mx, my, hasBackNav) {
        tooltipEl.innerHTML = buildPeerDetailHtml(node, true, hasBackNav);
        tooltipEl.classList.remove('hidden');
        tooltipEl.classList.add('pinned');
        tooltipEl.style.pointerEvents = 'auto';
        positionTooltip(mx, my);

        // Bind disconnect button
        const dcBtn = tooltipEl.querySelector('.tt-disconnect');
        if (dcBtn) {
            dcBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showDisconnectDialog(parseInt(dcBtn.dataset.id), dcBtn.dataset.net);
            });
        }

        // Bind back/exit link
        const backLink = tooltipEl.querySelector('.tt-back-link');
        if (backLink) {
            backLink.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (hasBackNav && groupedNodes && groupedNodes.length > 1) {
                    // Go back to group selection list
                    pinnedNode = null;
                    mapFilterPeerIds = new Set(groupedNodes.map(n => n.peerId));
                    renderPeerTable();
                    showGroupSelectionList(groupedNodes, mx, my);
                } else {
                    // Exit: clear everything
                    pinnedNode = null;
                    highlightedPeerId = null;
                    hoveredNode = null;
                    clearMapDotFilter();
                    hideTooltip();
                    highlightTableRow(null);
                }
            });
        }
    }

    function hideTooltip() {
        tooltipEl.classList.add('hidden');
        tooltipEl.classList.remove('pinned');
        tooltipEl.style.pointerEvents = 'none';
        hoveredNode = null;
        pinnedNode = null;
    }

    /** Clear map dot filter and restore full peer table */
    function clearMapDotFilter() {
        mapFilterPeerIds = null;
        groupedNodes = null;
        renderPeerTable();
    }

    /** Highlight a table row by peer ID (map node hover → table row).
     *  Visual highlight only — never scrolls the table on hover.
     *  Pass scrollIntoView=true for click-driven selection. */
    function highlightTableRow(peerId, scrollIntoView) {
        // Remove previous highlight
        const prev = tbodyEl.querySelector('.row-highlight');
        if (prev) prev.classList.remove('row-highlight');

        if (peerId === null) return;

        const row = tbodyEl.querySelector(`tr[data-id="${peerId}"]`);
        if (row) {
            row.classList.add('row-highlight');
            if (scrollIntoView && !panelEl.classList.contains('collapsed')) {
                row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // BOTTOM PEER PANEL — Full peer table with all columns
    // ═══════════════════════════════════════════════════════════

    // Connection type acronyms: short form + full description for hover
    const CONN_TYPE_SHORT = {
        'outbound-full-relay': 'OFR',
        'block-relay-only': 'BRO',
        'manual': 'MAN',
        'addr-fetch': 'AF',
        'feeler': 'FLR',
        'inbound': 'IN',
    };
    /** Get short type string for a peer and its full description */
    function peerTypeShort(p) {
        const dir = p.direction === 'IN' ? 'IN' : 'OUT';
        if (!p.connection_type) return dir;
        const ct = CONN_TYPE_SHORT[p.connection_type] || p.connection_type;
        return p.direction === 'IN' ? ct : `${dir}/${ct}`;
    }
    function peerTypeFull(p) {
        const dir = p.direction === 'IN' ? 'Inbound' : 'Outbound';
        return p.connection_type ? `${dir} / ${p.connection_type}` : dir;
    }

    // Column definitions: { key, label, get(short), full(hover), vis, width }
    // width: preferred width in px for fixed layout. min is enforced via CSS.
    const COLUMNS = [
        { key: 'id',              label: 'ID',       get: p => p.id,                                      full: null,  vis: true,  w: 40  },
        { key: 'network',         label: 'Net',      get: p => (NET_DISPLAY[p.network] || p.network),     full: null,  vis: true,  w: 45  },
        { key: 'conntime_fmt',    label: 'Duration', get: p => p.conntime_fmt || '—',                     full: null,  vis: true,  w: 75  },
        { key: 'connection_type', label: 'Type',     get: p => peerTypeShort(p),                           full: p => peerTypeFull(p), vis: true, w: 70 },
        { key: 'addr',            label: 'IP:Port',  get: p => p.addr || `${p.ip}:${p.port}`,             full: null,  vis: true,  w: 130 },
        { key: 'subver',          label: 'Software', get: p => p.subver || '—',                            full: null,  vis: true,  w: 90  },
        { key: 'services_abbrev', label: 'Services', get: p => serviceAbbrev(p.services),                    full: p => serviceHover(p.services),  vis: true,  w: 70  },
        { key: 'city',            label: 'City',     get: p => p.city || '—',                              full: null,  vis: true,  w: 60  },
        { key: 'regionName',      label: 'Region',   get: p => p.regionName || '—',                        full: null,  vis: true,  w: 55  },
        { key: 'country',         label: 'Country',  get: p => p.country || '—',                           full: null,  vis: true,  w: 70  },
        { key: 'continent',       label: 'Cont.',    get: p => p.continent || '—',                         full: null,  vis: true,  w: 60  },
        { key: 'isp',             label: 'ISP',      get: p => p.isp || '—',                               full: null,  vis: true,  w: 110 },
        { key: 'ping_ms',         label: 'Ping',     get: p => p.ping_ms != null ? p.ping_ms + 'ms' : '—', full: null, vis: true,  w: 50  },
        { key: 'bytessent_fmt',   label: 'Sent',     get: p => p.bytessent_fmt || '—',                     full: null,  vis: true,  w: 60  },
        { key: 'bytesrecv_fmt',   label: 'Recv',     get: p => p.bytesrecv_fmt || '—',                     full: null,  vis: true,  w: 60  },
        { key: 'in_addrman',      label: 'Addrman',  get: p => p.in_addrman ? 'Yes' : 'No',                full: null,  vis: true,  w: 55  },
        // Advanced columns (hidden by default)
        { key: 'direction',       label: 'Dir',      get: p => p.direction === 'IN' ? 'IN' : 'OUT',        full: p => p.direction === 'IN' ? 'Inbound' : 'Outbound', vis: false, w: 40 },
        { key: 'countryCode',     label: 'CC',       get: p => p.countryCode || '—',                       full: null,  vis: false, w: 35  },
        { key: 'continentCode',   label: 'CntC',     get: p => p.continentCode || '—',                     full: null,  vis: false, w: 40  },
        { key: 'lat',             label: 'Lat',      get: p => p.lat != null ? p.lat.toFixed(2) : '—',     full: null,  vis: false, w: 55  },
        { key: 'lon',             label: 'Lon',      get: p => p.lon != null ? p.lon.toFixed(2) : '—',     full: null,  vis: false, w: 55  },
        { key: 'region',          label: 'Rgn',      get: p => p.region || '—',                             full: null,  vis: false, w: 60  },
        { key: 'as',              label: 'AS',        get: p => p.as || '—',                                full: null,  vis: false, w: 80  },
        { key: 'asname',          label: 'AS Name',   get: p => p.asname || '—',                            full: null,  vis: false, w: 100 },
        { key: 'district',        label: 'District',  get: p => p.district || '—',                          full: null,  vis: false, w: 80  },
        { key: 'mobile',          label: 'Mob',       get: p => p.mobile ? 'Y' : 'N',                       full: p => p.mobile ? 'Yes' : 'No', vis: false, w: 35 },
        { key: 'org',             label: 'Org',       get: p => p.org || '—',                               full: null,  vis: false, w: 100 },
        { key: 'timezone',        label: 'TZ',        get: p => p.timezone || '—',                          full: null,  vis: false, w: 70  },
        { key: 'currency',        label: 'Curr',      get: p => p.currency || '—',                          full: null,  vis: false, w: 45  },
        { key: 'hosting',         label: 'Host',      get: p => p.hosting ? 'Y' : 'N',                      full: p => p.hosting ? 'Yes' : 'No', vis: false, w: 35 },
        { key: 'offset',          label: 'UTC',        get: p => p.offset != null ? p.offset : '—',         full: null,  vis: false, w: 45  },
        { key: 'proxy',           label: 'Proxy',      get: p => p.proxy ? 'Y' : 'N',                       full: p => p.proxy ? 'Yes' : 'No', vis: false, w: 40 },
        { key: 'zip',             label: 'ZIP',        get: p => p.zip || '—',                              full: null,  vis: false, w: 55  },
    ];

    // Visible column keys (start with defaults, can be toggled later)
    const DEFAULT_VISIBLE_COLUMNS = COLUMNS.filter(c => c.vis).map(c => c.key);
    let visibleColumns = [...DEFAULT_VISIBLE_COLUMNS];

    // Sort state
    let sortKey = 'id';
    let sortAsc = true;

    // Auto-fit column state: ON by default, OFF when user resizes
    let autoFitColumns = true;
    let userColumnWidths = {};  // key -> px width (only used when autoFit OFF)
    let panelOpacity = 0;       // 0 = invisible, 100 = opaque
    let maxPeerRows = 10;       // visible rows in peer table
    let showAntarcticaPeers = true;
    const TABLE_COLUMN_KEYS = new Set(COLUMNS.map(c => c.key));

    function normalizeVisibleColumns(columns) {
        if (!Array.isArray(columns)) return [...DEFAULT_VISIBLE_COLUMNS];
        const normalized = [];
        for (const key of columns) {
            if (typeof key === 'string' && TABLE_COLUMN_KEYS.has(key) && !normalized.includes(key)) {
                normalized.push(key);
            }
        }
        return normalized.length > 0 ? normalized : [...DEFAULT_VISIBLE_COLUMNS];
    }

    function normalizeColumnWidths(widths) {
        const normalized = {};
        if (!widths || typeof widths !== 'object' || Array.isArray(widths)) return normalized;
        for (const [key, rawWidth] of Object.entries(widths)) {
            if (!TABLE_COLUMN_KEYS.has(key)) continue;
            const width = Number(rawWidth);
            if (Number.isFinite(width)) normalized[key] = Math.round(clamp(width, 30, 400));
        }
        return normalized;
    }

    function currentTableDisplaySettings() {
        return {
            visibleColumns: [...visibleColumns],
            autoFitColumns,
            userColumnWidths: normalizeColumnWidths(userColumnWidths),
            panelOpacity,
            maxPeerRows,
            showAntarcticaPeers,
        };
    }

    function saveTableDisplaySettings() {
        writeSavedDisplaySettings(Object.assign(
            {},
            readSavedDisplaySettings(),
            currentTableDisplaySettings()
        ));
    }

    function loadTableDisplaySettings() {
        const saved = readSavedDisplaySettings();

        visibleColumns = normalizeVisibleColumns(saved.visibleColumns);

        if (typeof saved.autoFitColumns === 'boolean') {
            autoFitColumns = saved.autoFitColumns;
        }
        userColumnWidths = normalizeColumnWidths(saved.userColumnWidths);
        if (autoFitColumns) userColumnWidths = {};

        if (Number.isFinite(Number(saved.panelOpacity))) {
            panelOpacity = Math.round(clamp(Number(saved.panelOpacity), 0, 100));
        }
        if (Number.isFinite(Number(saved.maxPeerRows))) {
            maxPeerRows = Math.round(clamp(Number(saved.maxPeerRows), 3, 40));
        }
        if (typeof saved.showAntarcticaPeers === 'boolean') {
            showAntarcticaPeers = saved.showAntarcticaPeers;
        }
    }

    // Panel DOM (let because ban list view replaces and restores them)
    const panelEl = document.getElementById('peer-panel');
    let theadEl = document.getElementById('peer-thead');
    let tbodyEl = document.getElementById('peer-tbody');
    const handleCountEl = { textContent: '' };  // peer count now shown in badge only

    // Panel toggle (clicking the title bar)
    document.getElementById('peer-panel-handle').addEventListener('click', () => {
        panelEl.classList.toggle('collapsed');
        // [AS-DISTRIBUTION] When expanding peer list, bring it on top of AS panel
        if (!panelEl.classList.contains('collapsed')) {
            document.body.classList.add('panel-focus-peers');
            document.body.classList.remove('panel-focus-as');
        }
        scheduleDonutStackFit();
    });

    // [AS-DISTRIBUTION] Clicking anywhere in peer panel body → bring peers to front
    const peerPanelBody = document.querySelector('.peer-panel-body');
    if (peerPanelBody) {
        peerPanelBody.addEventListener('click', () => {
            document.body.classList.add('panel-focus-peers');
            document.body.classList.remove('panel-focus-as');
        });
    }

    /** Get sorted copy of lastPeers based on current sort state.
     *  sortKey=null means unsorted (original peer order). */
    function getSortedPeers() {
        if (!sortKey) return [...lastPeers];  // unsorted — original order
        const col = COLUMNS.find(c => c.key === sortKey);
        if (!col) return [...lastPeers];
        return [...lastPeers].sort((a, b) => {
            let va = col.get(a);
            let vb = col.get(b);
            // Numeric-aware sort for known numeric fields
            if (typeof va === 'number' && typeof vb === 'number') {
                return sortAsc ? va - vb : vb - va;
            }
            // Strip 'ms' for ping column
            if (sortKey === 'ping_ms') {
                va = parseInt(va) || 0;
                vb = parseInt(vb) || 0;
                return sortAsc ? va - vb : vb - va;
            }
            // Sort Sent/Recv by raw byte count, not formatted string
            if (sortKey === 'bytessent_fmt') {
                va = a.bytessent || 0;
                vb = b.bytessent || 0;
                return sortAsc ? va - vb : vb - va;
            }
            if (sortKey === 'bytesrecv_fmt') {
                va = a.bytesrecv || 0;
                vb = b.bytesrecv || 0;
                return sortAsc ? va - vb : vb - va;
            }
            // Sort Duration by raw conntime (unix timestamp — lower = connected longer)
            if (sortKey === 'conntime_fmt') {
                va = a.conntime || 0;
                vb = b.conntime || 0;
                // Lower conntime = connected longer = "more" duration
                return sortAsc ? vb - va : va - vb;
            }
            va = String(va);
            vb = String(vb);
            return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
        });
    }

    /** Build colgroup with column widths.
     *  Auto-fit ON: compute widths from data distribution (~95th percentile of value lengths),
     *  then scale proportionally to fill the viewport.
     *  Auto-fit OFF: use reasonable default widths from column definitions. */
    function renderColgroup() {
        const table = document.getElementById('peer-table');
        // Remove old colgroup if present
        const old = table.querySelector('colgroup');
        if (old) old.remove();

        if (autoFitColumns) {
            // ── Auto-fit: size columns to fit viewport based on data ──
            table.style.tableLayout = 'fixed';
            const cg = document.createElement('colgroup');
            const charPx = 7;  // approximate px per character at font-size 11px
            const headerPad = 28; // padding + sort arrow
            const colPad = 16;   // cell padding (8px each side)
            const actionsW = 80; // fixed actions column

            // Measure available width
            const tableWrap = table.closest('.peer-table-wrap');
            const availW = (tableWrap ? tableWrap.clientWidth : W) - actionsW;

            const widths = [];
            for (const key of visibleColumns) {
                const col = COLUMNS.find(c => c.key === key);
                if (!col) { widths.push(60); continue; }

                // Minimum: header label width
                const headerW = col.label.length * charPx + headerPad;

                if (lastPeers.length === 0) {
                    widths.push(Math.max(headerW, col.w));
                    continue;
                }

                // Gather string lengths for all values
                const lens = lastPeers.map(p => String(col.get(p)).length);
                lens.sort((a, b) => a - b);

                // Use ~95th percentile to ignore extreme outliers (e.g. Tor/I2P addresses)
                const p95Idx = Math.min(Math.floor(lens.length * 0.95), lens.length - 1);
                const p95Len = lens[p95Idx];
                const dataW = p95Len * charPx + colPad;

                widths.push(Math.max(headerW, Math.min(dataW, 250)));
            }

            // Scale proportionally to fill available width
            const totalNatural = widths.reduce((s, w) => s + w, 0);
            const scale = totalNatural > 0 ? Math.max(availW / totalNatural, 0.5) : 1;

            for (const w of widths) {
                const colEl = document.createElement('col');
                colEl.style.width = Math.round(w * scale) + 'px';
                cg.appendChild(colEl);
            }
            // Actions column
            const actCol = document.createElement('col');
            actCol.style.width = actionsW + 'px';
            cg.appendChild(actCol);
            table.insertBefore(cg, table.firstChild);
            return;
        }

        // ── Auto-fit OFF: use reasonable default widths from column definitions ──
        table.style.tableLayout = 'fixed';
        const cg = document.createElement('colgroup');
        for (const key of visibleColumns) {
            const col = COLUMNS.find(c => c.key === key);
            const colEl = document.createElement('col');
            const w = userColumnWidths[key] || (col ? col.w : 80);
            colEl.style.width = w + 'px';
            cg.appendChild(colEl);
        }
        // Actions column (single Disconnect button)
        const actCol = document.createElement('col');
        actCol.style.width = '80px';
        cg.appendChild(actCol);
        table.insertBefore(cg, table.firstChild);
    }

    /** Build table header row with resize handles */
    function renderPeerTableHead() {
        let html = '<tr>';
        for (const key of visibleColumns) {
            const col = COLUMNS.find(c => c.key === key);
            if (!col) continue;
            const isActive = sortKey === key;
            // 3-state: no sortKey = unsorted (dim arrow), asc = ▲, desc = ▼
            const arrow = isActive ? (sortAsc ? '&#9650;' : '&#9660;') : '';
            const cls = isActive ? 'sort-arrow active' : 'sort-arrow';
            html += `<th data-sort="${key}"><span class="th-text">${col.label} <span class="${cls}">${arrow}</span></span><span class="th-resize" data-col="${key}"></span></th>`;
        }
        html += '<th>Actions</th>';
        html += '</tr>';
        theadEl.innerHTML = html;
        renderColgroup();
    }

    /** Build table body from lastPeers (filtered by active network filter) */
    function renderPeerTable() {
        if (!tbodyEl) return;
        let sorted = getSortedPeers();

        // [PRIVATE-NET] In private net mode, bypass badge/AS/map filters and only show private peers
        if (privateNetMode) {
            sorted = sorted.filter(p => PRIVATE_NETS.has(p.network));
            if (pnSelectedNet) {
                sorted = sorted.filter(p => p.network === pnSelectedNet);
            }
        } else {
            // Apply network filter to table as well
            if (!isAllNetsEnabled()) {
                sorted = sorted.filter(p => passesNetFilter(p.network || 'ipv4'));
            }

            // [AS-DISTRIBUTION] Apply AS filter when an AS is selected
            if (asFilterPeerIds) {
                sorted = sorted.filter(p => asFilterPeerIds.has(p.id));
            }

            // [MAP DOT FILTER] Apply map dot filter when a dot is clicked
            if (mapFilterPeerIds) {
                sorted = sorted.filter(p => mapFilterPeerIds.has(p.id));
            }
        }

        handleCountEl.textContent = sorted.length;

        let html = '';
        for (const peer of sorted) {
            const isHighlighted = highlightedPeerId === peer.id;
            const cls = isHighlighted ? ' class="row-highlight"' : '';
            const net = peer.network || 'ipv4';
            html += `<tr data-id="${peer.id}" data-net="${net}"${cls}>`;
            for (const key of visibleColumns) {
                const col = COLUMNS.find(c => c.key === key);
                if (!col) continue;
                const val = col.get(peer);
                const hoverVal = col.full ? col.full(peer) : val;
                html += `<td title="${String(hoverVal).replace(/"/g, '&quot;')}">${val}</td>`;
            }
            // Action buttons — single Disconnect button opens confirmation dialog
            html += '<td>';
            html += `<button class="peer-action-btn" data-action="disconnect" data-id="${peer.id}" data-net="${net}">Disconnect</button>`;
            html += '</td>';
            html += '</tr>';
        }
        tbodyEl.innerHTML = html;
    }

    // Initial header render
    renderPeerTableHead();

    // ── Named event handlers (for reattachment after ban list close) ──

    let resizingColumn = false;  // suppress sort click when resize drag occurred
    let draggingColumn = false;  // suppress sort click when column reorder drag occurred

    function handleTheadClick(e) {
        // Suppress sort if this click followed a column resize or reorder drag
        if (resizingColumn) { resizingColumn = false; return; }
        if (draggingColumn) { draggingColumn = false; return; }
        // Ignore clicks on resize handles
        if (e.target.closest('.th-resize')) return;
        const th = e.target.closest('th[data-sort]');
        if (!th) return;
        const key = th.dataset.sort;
        // 3-state sort cycle: unsorted → ascending → descending → unsorted
        if (sortKey === key) {
            if (sortAsc) {
                sortAsc = false;  // asc → desc
            } else {
                sortKey = null;   // desc → unsorted
                sortAsc = true;
            }
        } else {
            sortKey = key;
            sortAsc = true;       // new column → ascending
        }
        renderPeerTableHead();
        renderPeerTable();
    }

    let resizeState = null;
    function handleTheadResize(e) {
        const handle = e.target.closest('.th-resize');
        if (!handle) return;
        e.preventDefault();
        e.stopPropagation();
        const colKey = handle.dataset.col;
        const th = handle.parentElement;
        const startX = e.clientX;
        const startW = th.offsetWidth;

        resizeState = { colKey, th, startX, startW };

        const onMove = (me) => {
            if (!resizeState) return;
            resizingColumn = true;  // flag to suppress subsequent sort click
            const delta = me.clientX - resizeState.startX;
            const newW = Math.max(30, resizeState.startW + delta);
            if (autoFitColumns) {
                autoFitColumns = false;
                const ths = theadEl.querySelectorAll('th[data-sort]');
                ths.forEach(t => {
                    const key = t.dataset.sort;
                    if (key) userColumnWidths[key] = t.offsetWidth;
                });
                updateAutoFitBtn();
            }
            userColumnWidths[resizeState.colKey] = newW;
            renderColgroup();
        };
        const onUp = () => {
            resizeState = null;
            saveTableDisplaySettings();
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }

    // ── Column drag-to-reorder ──
    let colDragIndicator = null;

    function handleTheadDragStart(e) {
        // Only start column drag on th text area (not resize handle)
        if (e.target.closest('.th-resize')) return;
        const th = e.target.closest('th[data-sort]');
        if (!th) return;

        const key = th.dataset.sort;
        const startX = e.clientX;
        const thRect = th.getBoundingClientRect();
        let moved = false;

        const onMove = (me) => {
            const dx = me.clientX - startX;
            // Only activate drag after 10px horizontal movement
            if (!moved && Math.abs(dx) < 10) return;
            if (!moved) {
                moved = true;
                draggingColumn = true;
                // Create floating indicator
                colDragIndicator = document.createElement('div');
                colDragIndicator.className = 'col-drag-indicator';
                colDragIndicator.textContent = th.querySelector('.th-text') ? th.querySelector('.th-text').textContent.trim() : key;
                colDragIndicator.style.width = thRect.width + 'px';
                document.body.appendChild(colDragIndicator);
            }
            if (colDragIndicator) {
                colDragIndicator.style.left = (me.clientX - thRect.width / 2) + 'px';
                colDragIndicator.style.top = (thRect.top - 2) + 'px';
            }
            // Highlight drop target
            const allThs = Array.from(theadEl.querySelectorAll('th[data-sort]'));
            allThs.forEach(t => t.classList.remove('col-drag-over'));
            const targetTh = document.elementFromPoint(me.clientX, thRect.top + thRect.height / 2);
            const dropTh = targetTh ? targetTh.closest('th[data-sort]') : null;
            if (dropTh && dropTh !== th) dropTh.classList.add('col-drag-over');
        };

        const onUp = (me) => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            if (colDragIndicator) { colDragIndicator.remove(); colDragIndicator = null; }
            // Clean up highlight
            theadEl.querySelectorAll('.col-drag-over').forEach(t => t.classList.remove('col-drag-over'));

            if (!moved) return;
            // Find drop target
            const targetEl = document.elementFromPoint(me.clientX, thRect.top + thRect.height / 2);
            const dropTh = targetEl ? targetEl.closest('th[data-sort]') : null;
            if (dropTh && dropTh.dataset.sort !== key) {
                const fromIdx = visibleColumns.indexOf(key);
                const toIdx = visibleColumns.indexOf(dropTh.dataset.sort);
                if (fromIdx !== -1 && toIdx !== -1) {
                    // Move column in visibleColumns array
                    visibleColumns.splice(fromIdx, 1);
                    visibleColumns.splice(toIdx, 0, key);
                    renderColgroup();
                    renderPeerTableHead();
                    renderPeerTable();
                    saveTableDisplaySettings();
                }
            }
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }

    theadEl.addEventListener('mousedown', handleTheadDragStart);

    // Sort on column header click
    theadEl.addEventListener('click', handleTheadClick);
    // Column resize via drag on th-resize handles
    theadEl.addEventListener('mousedown', handleTheadResize);

    // ── Auto-fit toggle button ──
    const autoFitBtn = document.getElementById('btn-autofit');
    function updateAutoFitBtn() {
        autoFitBtn.classList.toggle('active', autoFitColumns);
    }
    updateAutoFitBtn();
    autoFitBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        autoFitColumns = !autoFitColumns;
        if (autoFitColumns) userColumnWidths = {};
        updateAutoFitBtn();
        renderColgroup();
        saveTableDisplaySettings();
    });

    // ── Table Settings gear popup (column toggles + transparency) ──
    const tableSettingsBtn = document.getElementById('btn-table-settings');
    let tableSettingsEl = null;

    if (tableSettingsBtn) {
        tableSettingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (tableSettingsEl) { closeTableSettings(); return; }
            openTableSettings();
        });
    }

    function openTableSettings() {
        closeTableSettings();
        const popup = document.createElement('div');
        popup.className = 'table-settings-popup';
        popup.id = 'table-settings-popup';

        let html = '<div class="tsp-header"><span class="tsp-title">Table Settings</span><button class="tsp-defaults-btn" id="tsp-defaults">Defaults</button></div>';

        // ── Transparency slider ──
        html += '<div class="tsp-section">Transparency</div>';
        html += `<div class="tsp-slider-row"><input type="range" class="tsp-slider" id="tsp-opacity" min="0" max="100" value="${panelOpacity}"><span class="tsp-slider-val" id="tsp-opacity-val">${panelOpacity}%</span></div>`;

        // ── Visible rows ──
        html += '<div class="tsp-section">Visible Rows</div>';
        html += `<div class="tsp-slider-row"><input type="range" class="tsp-slider" id="tsp-rows" min="3" max="40" value="${maxPeerRows}"><span class="tsp-slider-val" id="tsp-rows-val">${maxPeerRows}</span></div>`;

        // ── Column toggles ──
        html += '<div class="tsp-section">Columns</div>';
        html += '<div class="tsp-col-grid">';
        for (const col of COLUMNS) {
            const checked = visibleColumns.includes(col.key) ? 'checked' : '';
            html += `<label class="tsp-col-item"><input type="checkbox" data-col="${col.key}" ${checked}>${col.label}</label>`;
        }
        html += '</div>';

        // ── Antarctica setting ──
        html += '<div class="tsp-section">Private Networks</div>';
        html += `<label class="tsp-col-item"><input type="checkbox" id="tsp-antarctica" ${showAntarcticaPeers ? 'checked' : ''}>Show in Antarctica</label>`;

        popup.innerHTML = html;
        document.body.appendChild(popup);
        tableSettingsEl = popup;

        // Position below the gear button
        if (tableSettingsBtn) {
            const rect = tableSettingsBtn.getBoundingClientRect();
            popup.style.right = (window.innerWidth - rect.right) + 'px';
            popup.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
        }

        // Bind opacity slider
        const opacitySlider = document.getElementById('tsp-opacity');
        const opacityVal = document.getElementById('tsp-opacity-val');
        if (opacitySlider) {
            opacitySlider.addEventListener('input', () => {
                panelOpacity = parseInt(opacitySlider.value);
                opacityVal.textContent = panelOpacity + '%';
                applyPanelOpacity();
                saveTableDisplaySettings();
            });
        }

        // Bind visible rows slider
        const rowsSlider = document.getElementById('tsp-rows');
        const rowsVal = document.getElementById('tsp-rows-val');
        if (rowsSlider) {
            rowsSlider.addEventListener('input', () => {
                maxPeerRows = parseInt(rowsSlider.value);
                if (rowsVal) rowsVal.textContent = maxPeerRows;
                applyMaxPeerRows();
                saveTableDisplaySettings();
            });
        }

        // Bind column toggles
        popup.querySelectorAll('input[data-col]').forEach(cb => {
            cb.addEventListener('change', () => {
                const key = cb.dataset.col;
                if (cb.checked) {
                    if (!visibleColumns.includes(key)) {
                        visibleColumns.push(key);
                    }
                } else {
                    // Don't allow removing all columns
                    const remaining = visibleColumns.filter(k => k !== key);
                    if (remaining.length === 0) { cb.checked = true; return; }
                    visibleColumns = remaining;
                }
                renderColgroup();
                renderPeerTableHead();
                renderPeerTable();
                saveTableDisplaySettings();
            });
        });

        // Bind Antarctica toggle
        const antToggle = document.getElementById('tsp-antarctica');
        if (antToggle) {
            antToggle.addEventListener('change', () => {
                showAntarcticaPeers = antToggle.checked;
                saveTableDisplaySettings();
            });
        }

        // Bind Defaults button
        const defaultsBtn = document.getElementById('tsp-defaults');
        if (defaultsBtn) {
            defaultsBtn.addEventListener('click', () => {
                // Reset columns to defaults
                visibleColumns = [...DEFAULT_VISIBLE_COLUMNS];
                // Reset transparency to 0%
                panelOpacity = 0;
                applyPanelOpacity();
                // Reset Antarctica setting
                showAntarcticaPeers = true;
                // Reset visible rows to default
                maxPeerRows = 10;
                applyMaxPeerRows();
                // Reset auto-fit
                autoFitColumns = true;
                userColumnWidths = {};
                updateAutoFitBtn();
                // Re-render table
                renderColgroup();
                renderPeerTableHead();
                renderPeerTable();
                saveTableDisplaySettings();
                // Refresh the popup to reflect changes
                closeTableSettings();
                openTableSettings();
            });
        }

        setTimeout(() => {
            document.addEventListener('click', closeTableSettingsOnOutside);
        }, 0);
    }

    function applyPanelOpacity() {
        const alpha = panelOpacity / 100;
        const handle = document.querySelector('.peer-panel-handle');
        const body = document.querySelector('.peer-panel-body');
        if (handle) handle.style.background = `rgba(10, 14, 20, ${alpha})`;
        if (body) body.style.background = `rgba(10, 14, 20, ${alpha})`;
    }

    function closeTableSettingsOnOutside(e) {
        if (tableSettingsEl && !tableSettingsEl.contains(e.target) && e.target !== tableSettingsBtn) {
            closeTableSettings();
        }
    }

    function closeTableSettings() {
        if (tableSettingsEl) { tableSettingsEl.remove(); tableSettingsEl = null; }
        document.removeEventListener('click', closeTableSettingsOnOutside);
    }

    // ── Ban list modal (overlay — peer table stays visible underneath) ──
    const bansBtn = document.getElementById('btn-bans');
    const peerActions = window.BPMPeerActions.create({
        refreshPeers: fetchPeers,
    });
    peerActions.init(bansBtn);

    /**
     * Smoothly zoom the map to center on a node and show its pinned tooltip.
     * Used by table row clicks and the selectPeerById hook.
     */
    function zoomToPeer(node) {
        const p = project(node.lon, node.lat);

        // For southern peers (lat < -30), auto-collapse the panel so they're visible
        if (node.lat < -30 && !panelEl.classList.contains('collapsed')) {
            panelEl.classList.add('collapsed');
        }

        // Calculate visible map area
        const topbarH = 40;
        const panelH = panelEl.classList.contains('collapsed') ? 32 : 340;
        const visibleTop = topbarH;
        const visibleBot = H - panelH;
        const visibleH = visibleBot - visibleTop;
        const targetScreenY = visibleTop + visibleH * 0.35;

        // Mercator world bounds for vertical clamping
        const yTop = project(0, 85).y;
        const yBot = project(0, -85).y;

        // Find minimum zoom that allows correct peer positioning
        let z = 3;
        for (; z <= CFG.maxZoom; z += 0.2) {
            const offsetFromCenter = (H / 2 - targetScreenY) / z;
            const candidateY = (p.y - 0.5) * H - offsetFromCenter;
            const minPanY = (yTop - 0.5) * H + H / (2 * z);
            const maxPanY = (yBot - 0.5) * H - H / (2 * z);
            if (minPanY < maxPanY && candidateY >= minPanY && candidateY <= maxPanY) {
                break;
            }
        }
        z = Math.min(z, CFG.maxZoom);

        const offsetFromCenter = (H / 2 - targetScreenY) / z;
        // Nudge peer slightly right of center so it's not behind the donut
        const xNudge = (W * 0.04) / z;
        const finalX = (p.x - 0.5) * W - xNudge;
        const finalY = (p.y - 0.5) * H - offsetFromCenter;

        // Reset view state to world baseline first (zoom 1, centered on peer longitude)
        view.x = finalX;
        view.y = 0;
        view.zoom = 1;
        // Then set the target to animate smoothly into the peer
        targetView.x = finalX;
        targetView.y = finalY;
        targetView.zoom = z;

        // Set selection state
        highlightedPeerId = node.peerId;
        pinnedNode = node;

        // Open pinned tooltip at the node's screen position (once view settles)
        setTimeout(() => {
            const offsets = getWrapOffsets();
            for (const off of offsets) {
                const s = worldToScreen(node.lon + off, node.lat);
                if (s.x > -50 && s.x < W + 50 && s.y > -50 && s.y < H + 50) {
                    showPinnedPeerDetail(node, s.x, s.y, false);
                    hoveredNode = node;
                    break;
                }
            }
        }, 500);
    }

    // Table row click → center map on peer + open tooltip
    function handleTbodyClick(e) {
        const btn = e.target.closest('.peer-action-btn');
        if (btn) {
            e.stopPropagation();
            handlePeerAction(btn.dataset.action, parseInt(btn.dataset.id), btn.dataset.net);
            return;
        }

        const row = e.target.closest('tr[data-id]');
        if (!row) return;
        const peerId = parseInt(row.dataset.id);
        const rowNet = row.dataset.net;

        // Private networks: enter private network mode and zoom to Antarctica
        const isPrivateNet = (rowNet === 'onion' || rowNet === 'i2p' || rowNet === 'cjdns');
        if (isPrivateNet) {
            enterPrivateNetMode(peerId);
            highlightTableRow(peerId, true);
            row.classList.add('row-selected');
            setTimeout(() => row.classList.remove('row-selected'), 1500);
            return;
        }

        const node = nodes.find(n => n.peerId === peerId && n.alive);
        if (node) {
            // Clear any active map dot filter (table row click = direct navigation)
            clearMapDotFilter();
            groupedNodes = null;
            mapFilterPeerIds = new Set([node.peerId]);
            renderPeerTable();

            // [AS-DISTRIBUTION] Open full peer detail in right panel + animate donut
            const ASD = window.ASDistribution;
            let bigPopupOpened = false;
            if (ASD) {
                const rawPeers = ASD.getLastPeersRaw();
                const peerData = rawPeers.find(p => p.id === peerId);
                if (peerData) {
                    ASD.openPeerDetailPanel(peerData, 'peerlist');
                    bigPopupOpened = true;
                }
            }

            if (bigPopupOpened) {
                // Zoom without opening small tooltip — big popup handles peer info
                const p = project(node.lon, node.lat);
                const topbarH2 = 40;
                const panelH2 = panelEl.classList.contains('collapsed') ? 32 : 340;
                const visibleH2 = (H - panelH2) - topbarH2;
                const targetSY = topbarH2 + visibleH2 * 0.35;
                let z2 = 3;
                for (; z2 <= CFG.maxZoom; z2 += 0.2) {
                    const ofc = (H / 2 - targetSY) / z2;
                    const cY = (p.y - 0.5) * H - ofc;
                    const mnY = (project(0, 85).y - 0.5) * H + H / (2 * z2);
                    const mxY = (project(0, -85).y - 0.5) * H - H / (2 * z2);
                    if (mnY < mxY && cY >= mnY && cY <= mxY) break;
                }
                z2 = Math.min(z2, CFG.maxZoom);
                const ofc = (H / 2 - targetSY) / z2;
                // Nudge peer slightly right of center so it's not behind the donut
                const xNudge = (W * 0.04) / z2;
                view.x = (p.x - 0.5) * W - xNudge;
                view.y = 0;
                view.zoom = 1;
                targetView.x = (p.x - 0.5) * W - xNudge;
                targetView.y = (p.y - 0.5) * H - ofc;
                targetView.zoom = z2;
                highlightedPeerId = node.peerId;
                pinnedNode = node;
            } else {
                zoomToPeer(node);
            }
            highlightTableRow(peerId, true);  // scroll into view on click

            row.classList.add('row-selected');
            setTimeout(() => row.classList.remove('row-selected'), 1500);
        }
    }

    function handleTbodyHover(e) {
        const row = e.target.closest('tr[data-id]');
        if (row) {
            highlightedPeerId = parseInt(row.dataset.id);
        }
    }

    function handleTbodyLeave() {
        highlightedPeerId = null;
    }

    tbodyEl.addEventListener('click', handleTbodyClick);
    tbodyEl.addEventListener('mouseover', handleTbodyHover);
    tbodyEl.addEventListener('mouseleave', handleTbodyLeave);

    /** Show a confirmation dialog for disconnect with optional ban */
    function showDisconnectDialog(peerId, net) {
        peerActions.showDisconnectDialog(peerId, net);
    }

    /** Handle disconnect action from table row button */
    function handlePeerAction(action, peerId, net) {
        showDisconnectDialog(peerId, net || 'ipv4');
    }

    /** Show a temporary result notification */
    function showActionResult(msg, success) {
        peerActions.showResult(msg, success);
    }

    // ═══════════════════════════════════════════════════════════
    // NODE HIGHLIGHT RING — Draw highlight for map↔table interaction
    // ═══════════════════════════════════════════════════════════

    /** Draw a highlight ring around a node when it's highlighted via table hover.
     *  When pinned (selected), draws a brighter pulsing halo so it's
     *  unambiguous which peer is selected even in dense clusters. */
    function drawHighlightRing(node, now, wrapOffsets, forcePinned) {
        if (!node.alive) return;
        const isPinned = forcePinned || (pinnedNode && pinnedNode.peerId === node.peerId);
        const pulse = 0.7 + 0.3 * Math.sin(now * 0.005);
        const r = CFG.nodeRadius * 2.5;
        for (const off of wrapOffsets) {
            const s = worldToScreen(node.lon + off, node.lat);
            if (s.x < -r * 3 || s.x > W + r * 3 || s.y < -r * 3 || s.y > H + r * 3) continue;

            if (isPinned) {
                // Outer soft glow halo
                const glowR = r * 2.2;
                const grad = ctx.createRadialGradient(s.x, s.y, r, s.x, s.y, glowR);
                grad.addColorStop(0, rgba(node.color, 0.3 * pulse));
                grad.addColorStop(1, rgba(node.color, 0));
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(s.x, s.y, glowR, 0, Math.PI * 2);
                ctx.fill();

                // Inner bright ring
                ctx.strokeStyle = rgba(node.color, 0.8 * pulse);
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
                ctx.stroke();
            } else {
                // Hover: subtle highlight ring (adapts to theme)
                ctx.strokeStyle = rgba(nodeHighlightColor, 0.5 * pulse);
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // MAIN RENDER LOOP
    // Runs at ~60fps via requestAnimationFrame.
    // ═══════════════════════════════════════════════════════════

    /**
     * Clamp the view to prevent empty space.
     *
     * Horizontal: no clamping — the world wraps seamlessly, so the
     * user can pan left/right forever. getWrapOffsets() ensures we
     * always render enough copies to fill the viewport.
     *
     * Vertical:
     *   - At zoom <= 1: vertical panning is completely locked (centered)
     *   - At zoom > 1: panning is allowed but clamped so the Mercator
     *     world edges (±85°) never retreat inside the viewport.
     */
    function clampView() {
        // ── Horizontal: free (wrapping handles it) ──
        // No clamping on view.x or targetView.x

        // ── Vertical: Mercator bounds at ±85° latitude ──
        const yTop = project(0, 85).y;   // ~0.035
        const yBot = project(0, -85).y;  // ~0.965
        const centerY = ((yTop + yBot) / 2 - 0.5) * H;

        if (view.zoom <= 1.001) {
            // At zoom 1: lock vertical position — no panning at all
            view.y = centerY;
            targetView.y = centerY;
        } else {
            // Zoomed in: allow vertical pan within bounds.
            // World top in screen space = (yTop - 0.5) * H * zoom + H/2 - y * zoom
            // We want that to be <= 0 (world top at or above screen top)
            // => y >= (yTop - 0.5) * H + H / (2 * zoom)
            // Similarly, world bottom must be >= H (at or below screen bottom)
            // => y <= (yBot - 0.5) * H - H / (2 * zoom)
            let minPanY = (yTop - 0.5) * H + H / (2 * view.zoom);
            let maxPanY = (yBot - 0.5) * H - H / (2 * view.zoom);

            // [PRIVATE-NET] In private mode, relax south bound so camera can center
            // on Antarctica, and tighten north bound so user stays near the pole
            if (privateNetMode) {
                // Allow the view to push past the normal south edge (ocean beyond -85°)
                // so Antarctica can actually be centered on screen at moderate zoom
                const extraSouth = H * 0.35;
                maxPanY += extraSouth;
                // Restrict northward panning to ~50°S
                const pnNorthLimit = project(0, -50).y;
                const pnMinPanY = (pnNorthLimit - 0.5) * H;
                minPanY = Math.max(minPanY, pnMinPanY);
            }

            if (minPanY >= maxPanY) {
                // World doesn't fill screen vertically — center it
                view.y = centerY;
                targetView.y = centerY;
            } else {
                view.y = clamp(view.y, minPanY, maxPanY);
                targetView.y = clamp(targetView.y, minPanY, maxPanY);
            }
        }
    }

    let lastPeerFrameTime = 0;

    function frame(timestamp) {
        const now = Date.now();
        const interacting = document.body.classList.contains('map-interacting');

        // Direct tracking keeps pointer-driven movement responsive. Programmatic
        // zoom and focus changes retain the existing eased camera movement.
        if (interacting) {
            view.x = targetView.x;
            view.y = targetView.y;
            view.zoom = targetView.zoom;
        } else {
            view.x = lerp(view.x, targetView.x, CFG.panSmooth);
            view.y = lerp(view.y, targetView.y, CFG.panSmooth);
            view.zoom = lerp(view.zoom, targetView.zoom, CFG.panSmooth);
        }

        // Lock view within world bounds
        clampView();
        ensureZoomDetailLoaded(Math.max(view.zoom, targetView.zoom));

        const settled = cameraSettled();
        document.body.classList.toggle('map-camera-moving', !settled && !interacting);
        if (settled && !interacting) {
            view.x = targetView.x;
            view.y = targetView.y;
            view.zoom = targetView.zoom;
            if (basemapDirty || !basemapMatchesView()) renderBasemap();
        } else if (!basemapView) {
            renderBasemap();
        } else {
            transformCachedBasemap();
        }

        // Peer effects remain animated, but idle rendering is capped at 30fps.
        // Interaction and camera motion use 60fps for direct visual feedback.
        const frameInterval = (interacting || !settled) ? (1000 / 60) : (1000 / 30);
        if (timestamp - lastPeerFrameTime < frameInterval - 1) {
            requestAnimationFrame(frame);
            return;
        }
        lastPeerFrameTime = timestamp;

        ctx.setTransform(peerDpr, 0, 0, peerDpr, 0, 0);
        ctx.clearRect(0, 0, W, H);

        // Compute wrap offsets once per frame
        const wrapOffsets = getWrapOffsets();

        // [PRIVATE-NET] Draw "PRIVATE NETWORKS" text across Antarctica
        if (privateNetMode) {
            drawPrivateNetworksText();
        }

        // 9. Connection mesh lines between nearby peers (skip in private net mode)
        if (!privateNetMode) {
            drawConnectionLines(now, wrapOffsets);
        }

        // [AS-DISTRIBUTION] 9b. Draw lines from map center to AS peers (hover/selection)
        if (!privateNetMode) {
            if (asLineGroups && asLineGroups.length > 0) {
                drawAsLinesAll(wrapOffsets);
            } else if (asLinePeerIds && asLinePeerIds.length > 0 && asLineColor) {
                drawAsLines(wrapOffsets);
            }
        }

        // [PRIVATE-NET] Draw lines from donut to all private peers
        if (privateNetMode || pnMiniHover) {
            drawPrivateNetLines(wrapOffsets);
        }

        // 10. Peer nodes (alive + fading out)
        for (const node of nodes) {
            // In private net mode, only draw private network peers
            if (privateNetMode && !PRIVATE_NETS.has(node.net)) continue;
            drawNode(node, now, wrapOffsets);
        }

        // 11. Highlight ring for map↔table cross-highlighting
        //     Draw for pinned node (selection) and/or hovered node
        if (pinnedNode && pinnedNode.alive) {
            drawHighlightRing(pinnedNode, now, wrapOffsets);
        }
        // Group selection (multi-peer dot): draw glow ring on the shared location
        if (groupedNodes && groupedNodes.length > 1 && !pinnedNode) {
            drawHighlightRing(groupedNodes[0], now, wrapOffsets, true);
        }
        if (highlightedPeerId !== null && (!pinnedNode || highlightedPeerId !== pinnedNode.peerId)) {
            const hlNode = nodes.find(n => n.peerId === highlightedPeerId && n.alive);
            if (hlNode) drawHighlightRing(hlNode, now, wrapOffsets);
        }

        requestAnimationFrame(frame);
    }

    // ═══════════════════════════════════════════════════════════
    // INTERACTION — Pan, zoom, touch, hover
    // ═══════════════════════════════════════════════════════════

    // ── Mouse pan ──
    let dragZoom = 1;  // zoom level when drag started
    let dragMoved = false;  // track if mouse moved during drag (vs click)
    canvas.addEventListener('mousedown', (e) => {
        if (wheelInteractionTimer) {
            clearTimeout(wheelInteractionTimer);
            wheelInteractionTimer = null;
        }
        dragging = true;
        setMapInteraction(true);
        dragMoved = false;
        dragStart.x = e.clientX;
        dragStart.y = e.clientY;
        dragViewStart.x = targetView.x;
        dragViewStart.y = targetView.y;
        dragZoom = view.zoom;  // capture current zoom for consistent drag speed
    });

    window.addEventListener('mousemove', (e) => {
        if (dragging) {
            // Pan the view by drag delta, scaled by zoom so drag feels 1:1 with the map
            const dx = e.clientX - dragStart.x;
            const dy = e.clientY - dragStart.y;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
            targetView.x = dragViewStart.x - dx / dragZoom;
            // At zoom 1, vertical panning is locked (clampView enforces it)
            if (dragZoom > 1.001) {
                targetView.y = dragViewStart.y - dy / dragZoom;
            }
            if (dragMoved && !groupedNodes) hideTooltip();
        } else {
            // Hover detection for tooltip + table highlight (group-aware)
            // Skip if mouse is over a UI panel (not the canvas),
            // but first clear any lingering hover state so tooltip/highlight
            // don't stay stuck when the cursor leaves the canvas.
            if (e.target !== canvas) {
                if (hoveredNode && !pinnedNode && !groupedNodes) {
                    hideTooltip();
                    highlightTableRow(null);
                    canvas.style.cursor = 'grab';
                }
                return;
            }
            // A pinned tooltip (single peer or group selection list) blocks hover
            const hasPinned = pinnedNode || groupedNodes;
            const group = findNodesAtScreen(e.clientX, e.clientY);
            if (group.length > 0) {
                // Don't override a pinned tooltip with hover
                if (!hasPinned) {
                    showGroupHoverTooltip(group, e.clientX, e.clientY);
                }
                hoveredNode = group[0];
                if (!hasPinned) highlightTableRow(group[0].peerId);
                canvas.style.cursor = 'pointer';
            } else if (hoveredNode && !hasPinned) {
                hideTooltip();
                highlightTableRow(null);
                canvas.style.cursor = 'grab';
            } else if (!hasPinned) {
                canvas.style.cursor = 'grab';
            }
        }
    });

    window.addEventListener('mouseup', (e) => {
        setMapInteraction(false);
        if (dragging && !dragMoved) {
            // [PRIVATE-NET] In private net mode, handle clicks on private peers
            if (privateNetMode) {
                const group = findNodesAtScreen(e.clientX, e.clientY);
                const privateGroup = group.filter(n => PRIVATE_NETS.has(n.net));
                if (privateGroup.length > 1) {
                    // Multiple peers at this dot — show selection list
                    pinnedNode = null;
                    groupedNodes = privateGroup;
                    mapFilterPeerIds = new Set(privateGroup.map(n => n.peerId));
                    renderPeerTable();
                    showPnGroupSelectionList(privateGroup, e.clientX, e.clientY);
                } else if (privateGroup.length === 1) {
                    selectPrivatePeer(privateGroup[0].peerId);
                } else {
                    // Clicked empty space in private mode — deselect peer
                    privateNetSelectedPeer = null;
                    privateNetLinePeer = null;
                    pinnedNode = null;
                    highlightedPeerId = null;
                    hideTooltip();
                    closePnBigPopup();
                    hidePnSubTooltip();
                    // Dismiss insight rect if active
                    if (pnInsightRectVisible) {
                        hidePnInsightRect();
                        clearPnInsightState();
                    }
                    // In private mode, donut stays centered; otherwise un-focus if no panel
                    if (!privateNetMode && !pnSelectedNet) {
                        cachePnElements();
                        if (pnContainerEl) pnContainerEl.classList.remove('pn-focused');
                    }
                    updatePrivateNetUI();
                }
                dragging = false;
                return;
            }

            // This was a click, not a drag
            const group = findNodesAtScreen(e.clientX, e.clientY);
            if (group.length > 0) {
                // [PRIVATE-NET] If ALL peers in the group are private, enter private net mode.
                // Mixed groups (private + public) fall through to the normal selection flow
                // so public peers remain selectable from the multi-peer list.
                if (group.every(function(n) { return PRIVATE_NETS.has(n.net); })) {
                    // Find the first private peer in the group and enter private mode with it
                    var privatePeer = group[0];
                    enterPrivateNetMode(privatePeer.peerId);
                    dragging = false;
                    return;
                }

                if (group.length === 1) {
                    const node = group[0];
                    // If clicking the same peer that's already shown in detail, close popup instead
                    const ASD = window.ASDistribution;
                    if (pinnedNode && pinnedNode.peerId === node.peerId && ASD && ASD.isPeerDetailActive()) {
                        pinnedNode = null;
                        highlightedPeerId = null;
                        hoveredNode = null;
                        hideTooltip();
                        highlightTableRow(null);
                        clearMapDotFilter();
                        ASD.closePeerPopup();
                    } else {
                        // Single peer: open peer detail panel first, then zoom
                        // (must match table-row click order so focused-mode CSS
                        //  transitions settle before zoom targets are set)
                        clearMapDotFilter();
                        groupedNodes = null;
                        mapFilterPeerIds = new Set([node.peerId]);
                        renderPeerTable();

                        // [AS-DISTRIBUTION] Open full peer detail in right panel FIRST
                        if (ASD) {
                            const rawPeers = ASD.getLastPeersRaw();
                            const peerData = rawPeers.find(p => p.id === node.peerId);
                            if (peerData) {
                                ASD.openPeerDetailPanel(peerData, 'map');
                            }
                        }

                        // Zoom to peer (same code path as table-row click)
                        const p = project(node.lon, node.lat);
                        const topbarH2 = 40;
                        const panelH2 = panelEl.classList.contains('collapsed') ? 32 : 340;
                        const visibleH2 = (H - panelH2) - topbarH2;
                        const targetSY = topbarH2 + visibleH2 * 0.35;
                        let z = 3;
                        for (; z <= CFG.maxZoom; z += 0.2) {
                            const ofc = (H / 2 - targetSY) / z;
                            const cY = (p.y - 0.5) * H - ofc;
                            const mnY = (project(0, 85).y - 0.5) * H + H / (2 * z);
                            const mxY = (project(0, -85).y - 0.5) * H - H / (2 * z);
                            if (mnY < mxY && cY >= mnY && cY <= mxY) break;
                        }
                        z = Math.min(z, CFG.maxZoom);
                        const ofc = (H / 2 - targetSY) / z;
                        // Nudge peer slightly right of center so it's not behind the donut
                        const xNudge = (W * 0.04) / z;
                        view.x = (p.x - 0.5) * W - xNudge;
                        view.y = 0;
                        view.zoom = 1;
                        targetView.x = (p.x - 0.5) * W - xNudge;
                        targetView.y = (p.y - 0.5) * H - ofc;
                        targetView.zoom = z;
                        highlightedPeerId = node.peerId;
                        pinnedNode = node;

                        if (!panelEl.classList.contains('collapsed')) {
                            highlightTableRow(node.peerId, true);
                        }
                    }
                } else {
                    // Multi-peer dot: show small pinned selection list near the dot
                    // Close any existing peer detail popup first
                    if (window.ASDistribution) {
                        window.ASDistribution.closePeerPopup();
                    }
                    pinnedNode = null;  // no single peer pinned yet
                    groupedNodes = group;
                    mapFilterPeerIds = new Set(group.map(n => n.peerId));
                    renderPeerTable();
                    showGroupSelectionList(group, e.clientX, e.clientY);
                }
            } else {
                // Clicked empty space — unpin tooltip + clear map filter
                if (pinnedNode || mapFilterPeerIds) {
                    pinnedNode = null;
                    highlightedPeerId = null;
                    hoveredNode = null;
                    hideTooltip();
                    highlightTableRow(null);
                    clearMapDotFilter();
                }
                // [PRIVATE-NET] Two-stage deselect: first deselect peer, then deselect segment → overview
                if (privateNetMode) {
                    if (privateNetSelectedPeer || privateNetLinePeer) {
                        // Stage 1: deselect peer, go back to segment/overview view
                        privateNetSelectedPeer = null;
                        privateNetLinePeer = null;
                        closePnBigPopup();
                        highlightedPeerId = null;
                        // Zoom back to Antarctica overview
                        const antCenter = project(40, -75);
                        targetView.x = (antCenter.x - 0.5) * W;
                        targetView.y = (antCenter.y - 0.5) * H;
                        targetView.zoom = 1.8;
                        renderPnDonut();
                    } else if (pnSelectedNet) {
                        // Stage 2: deselect segment → go to overview
                        pnSelectedNet = null;
                        pnHoveredNet = null;
                        hidePnSubTooltip();
                        pnPreviewPeerIds = null;
                        closePnDetailPanel();
                        document.body.classList.remove('pn-panel-open');
                        openPnOverviewPanel();
                        renderPnDonut();
                    }
                }
                // [AS-DISTRIBUTION] Two-stage collapse: first close sub-panels, then main panel
                if (window.ASDistribution) {
                    window.ASDistribution.onMapClick();
                }
            }
        }
        dragging = false;
    });

    // ── Clear hover state when mouse leaves the browser window ──
    document.addEventListener('mouseleave', () => {
        if (dragging) {
            dragging = false;
            setMapInteraction(false);
        }
        if (hoveredNode && !pinnedNode && !groupedNodes) {
            hideTooltip();
            highlightTableRow(null);
            canvas.style.cursor = 'grab';
            hoveredNode = null;
        }
    });

    // ── Mouse wheel zoom (zooms toward cursor position) ──
    let wheelInteractionTimer = null;
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        setMapInteraction(true);
        if (wheelInteractionTimer) clearTimeout(wheelInteractionTimer);
        wheelInteractionTimer = setTimeout(() => {
            wheelInteractionTimer = null;
            setMapInteraction(false);
        }, 140);
        const dir = e.deltaY < 0 ? 1 : -1;
        const factor = dir > 0 ? CFG.zoomStep : 1 / CFG.zoomStep;
        const newZoom = clamp(targetView.zoom * factor, CFG.minZoom, CFG.maxZoom);

        // Remember world point under cursor before zoom
        const mx = e.clientX;
        const my = e.clientY;
        const worldBefore = screenToWorld(mx, my);

        targetView.zoom = newZoom;

        // Adjust pan so the world point stays under the cursor after zoom
        const pBefore = project(worldBefore.lon, worldBefore.lat);
        const sxAfter = (pBefore.x - 0.5) * W * targetView.zoom + W / 2 - targetView.x * targetView.zoom;
        const syAfter = (pBefore.y - 0.5) * H * targetView.zoom + H / 2 - targetView.y * targetView.zoom;
        targetView.x += (sxAfter - mx) / targetView.zoom;
        targetView.y += (syAfter - my) / targetView.zoom;
    }, { passive: false });

    // ── Touch pan (single finger) ──
    let touchStart = null;
    let touchZoom = 1;
    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
            if (wheelInteractionTimer) {
                clearTimeout(wheelInteractionTimer);
                wheelInteractionTimer = null;
            }
            setMapInteraction(true);
            touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            dragViewStart.x = targetView.x;
            dragViewStart.y = targetView.y;
            touchZoom = view.zoom;
        }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
        if (touchStart && e.touches.length === 1) {
            const dx = e.touches[0].clientX - touchStart.x;
            const dy = e.touches[0].clientY - touchStart.y;
            targetView.x = dragViewStart.x - dx / touchZoom;
            // At zoom 1, vertical panning is locked
            if (touchZoom > 1.001) {
                targetView.y = dragViewStart.y - dy / touchZoom;
            }
        }
    }, { passive: true });

    canvas.addEventListener('touchend', () => {
        touchStart = null;
        setMapInteraction(false);
    }, { passive: true });
    canvas.addEventListener('touchcancel', () => {
        touchStart = null;
        setMapInteraction(false);
    }, { passive: true });

    // ── Zoom buttons ──
    document.getElementById('zoom-in').addEventListener('click', () => {
        targetView.zoom = clamp(targetView.zoom * CFG.zoomStep, CFG.minZoom, CFG.maxZoom);
    });
    document.getElementById('zoom-out').addEventListener('click', () => {
        targetView.zoom = clamp(targetView.zoom / CFG.zoomStep, CFG.minZoom, CFG.maxZoom);
    });
    document.getElementById('zoom-reset').addEventListener('click', () => {
        if (privateNetMode) {
            exitPrivateNetMode();
        } else {
            targetView.x = 0;
            targetView.y = 0;
            targetView.zoom = 1;
        }
    });

    // ═══════════════════════════════════════════════════════════
    // NETWORK BADGE CONTROLS — Click to filter, hover for stats
    // ═══════════════════════════════════════════════════════════

    const netBadges = document.querySelectorAll('.handle-nets .net-badge');
    const netPopover = document.getElementById('net-popover');
    const antCloseBtn = document.getElementById('ant-close');

    /** Update badge visual states to reflect the current multi-select filter */
    function updateBadgeStates() {
        const allOn = isAllNetsEnabled();
        netBadges.forEach(badge => {
            const net = badge.dataset.net;
            if (net === 'all') {
                badge.classList.toggle('active', allOn);
                badge.classList.toggle('dimmed', !allOn);
            } else {
                badge.classList.toggle('active', enabledNets.has(net));
                badge.classList.toggle('dimmed', !enabledNets.has(net));
            }
        });

        // Antarctica annotation visibility is controlled by showAntarcticaPeers setting
        // and persistent dismissal — no longer tied to filter toggles
    }

    // Click to toggle network badges (radio-then-additive model)
    // First click from "All" = radio (show only that network)
    // Subsequent clicks = additive toggle
    // Clicking "All" = reset to all
    netBadges.forEach(badge => {
        badge.addEventListener('click', (e) => {
            e.stopPropagation();
            const net = badge.dataset.net;
            if (net === 'all') {
                // "All" → select everything
                enabledNets = new Set(ALL_NETS);
            } else if (isAllNetsEnabled()) {
                // Currently showing All → radio: show only the clicked network
                enabledNets = new Set([net]);
            } else {
                // Specific filter(s) active → additive toggle
                if (enabledNets.has(net)) {
                    enabledNets.delete(net);
                    // Don't allow empty selection — revert to All
                    if (enabledNets.size === 0) {
                        enabledNets = new Set(ALL_NETS);
                    }
                } else {
                    enabledNets.add(net);
                }
            }
            updateBadgeStates();
            renderPeerTable();
        });

        // Hover to show network stats popover (positioned above the badge)
        badge.addEventListener('mouseenter', () => {
            const net = badge.dataset.net;
            const stats = getNetworkStats(net);
            if (!stats) return;
            netPopover.innerHTML = stats;
            netPopover.classList.remove('hidden');
            // Position popover above the hovered badge
            const rect = badge.getBoundingClientRect();
            netPopover.style.left = rect.left + 'px';
            netPopover.style.top = (rect.top - netPopover.offsetHeight - 6) + 'px';
        });
        badge.addEventListener('mouseleave', () => {
            netPopover.classList.add('hidden');
        });
    });

    // Close Antarctica modal ("Got it" button or click outside)
    if (antCloseBtn) {
        antCloseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (antOverlay) antOverlay.classList.add('hidden');
        });
    }
    if (antOverlay) {
        antOverlay.addEventListener('click', (e) => {
            if (e.target === antOverlay) {
                antOverlay.classList.add('hidden');
            }
        });
    }

    function showAntarcticaDisclaimerOnce() {
        if (!showAntarcticaPeers || !antOverlay) return;

        try {
            if (localStorage.getItem(STORAGE_KEYS.antarcticaDisclaimerSeen) === 'true') return;
            localStorage.setItem(STORAGE_KEYS.antarcticaDisclaimerSeen, 'true');
        } catch (e) {
            // Storage may be unavailable in restricted browser contexts.
        }

        antOverlay.classList.remove('hidden');
    }

    /** Build popover HTML for a network type or "all" */
    function getNetworkStats(net) {
        const aliveNodes = nodes.filter(n => n.alive);
        const counts = { ipv4: 0, ipv6: 0, onion: 0, i2p: 0, cjdns: 0 };
        let inbound = 0, outbound = 0, totalPing = 0, pingCount = 0;

        for (const n of aliveNodes) {
            if (counts.hasOwnProperty(n.net)) counts[n.net]++;
            const match = (net === 'all') || (n.net === net);
            if (match) {
                if (n.direction === 'IN') inbound++;
                else outbound++;
                if (n.ping > 0) { totalPing += n.ping; pingCount++; }
            }
        }

        const total = net === 'all'
            ? aliveNodes.length
            : (counts[net] || 0);
        const detailsForNet = net !== 'all' ? fdCachedNetworkDetails[net] : null;

        if (total === 0 && net !== 'all' && !detailsForNet) return null;

        const avgPing = pingCount > 0 ? Math.round(totalPing / pingCount) : '—';
        const label = net === 'all' ? 'All Networks' : (NET_DISPLAY[net] || net.toUpperCase());

        let html = `<div class="pop-title">${label}</div>`;
        html += `<div class="pop-row"><span class="pop-label">Peers</span><span class="pop-val">${total}</span></div>`;
        html += `<div class="pop-row"><span class="pop-label">Inbound</span><span class="pop-val">${inbound}</span></div>`;
        html += `<div class="pop-row"><span class="pop-label">Outbound</span><span class="pop-val">${outbound}</span></div>`;
        html += `<div class="pop-row"><span class="pop-label">Avg Ping</span><span class="pop-val">${avgPing}${avgPing !== '—' ? 'ms' : ''}</span></div>`;
        if (net !== 'all') {
            const details = detailsForNet;
            if (details) {
                html += `<div class="pop-row"><span class="pop-label">Reachable</span><span class="pop-val">${details.reachable ? 'Yes' : 'No'}</span></div>`;
                if (details.proxy) {
                    const proxy = escapeServiceHtml(details.proxy);
                    html += `<div class="pop-row"><span class="pop-label">Proxy</span><span class="pop-val node-address" title="${proxy}">${proxy}</span></div>`;
                }
                const addresses = details.localaddresses || [];
                const labelText = PRIVATE_NETS.has(net) ? 'Service' : 'Advertised';
                if (addresses.length) {
                    for (const address of addresses.slice(0, 3)) {
                        const fullAddress = formatNodeAddress(address);
                        const escapedFull = escapeServiceHtml(fullAddress);
                        const shortAddress = escapeServiceHtml(shortNodeAddress(fullAddress));
                        html += `<div class="pop-row"><span class="pop-label">${labelText}</span><span class="pop-val node-address" title="${escapedFull}">${shortAddress}</span></div>`;
                    }
                } else {
                    html += '<div class="pop-row"><span class="pop-label">Advertised</span><span class="pop-val">None</span></div>';
                }
            }
        }

        if (net === 'all') {
            // Show per-network breakdown
            for (const nk of Object.keys(NET_COLORS)) {
                if (counts[nk] > 0) {
                    html += `<div class="pop-row"><span class="pop-label">${NET_DISPLAY[nk]}</span><span class="pop-val">${counts[nk]}</span></div>`;
                }
            }
        }

        return html;
    }

    // ═══════════════════════════════════════════════════════════
    // SYSTEM INFO — CPU/RAM from /api/stats (data stored for modal)
    // ═══════════════════════════════════════════════════════════

    async function fetchSystemStats() {
        try {
            const resp = await fetch('/api/stats');
            if (!resp.ok) return;
            const data = await resp.json();
            renderSystemInfoCard(data.system_stats || {});
        } catch (err) {
            console.error('[Bitcoin Peer Map] Failed to fetch system stats:', err);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // DISPLAY SETTINGS POPUP — right overlay Update/Status rows
    // ═══════════════════════════════════════════════════════════

    let displaySettingsEl = null;

    function openDisplaySettingsPopup(anchorEl) {
        closeDisplaySettingsPopup();
        const popup = document.createElement('div');
        popup.className = 'display-settings-popup';
        popup.id = 'display-settings-popup';

        const pollSec = Math.round(CFG.pollInterval / 1000);
        const infoSec = Math.round(CFG.infoPollInterval / 1000);

        // Visibility toggle items — the sections on the map
        const visItems = [
            { id: 'as-distribution-container', label: 'Public Donut', visible: true },
            { id: 'pn-mini-donut', label: 'Private Donut', visible: true },
            { id: 'btc-price-bar', label: 'Bitcoin Price', visible: true },
            { id: 'map-overlay', label: 'System Stats', visible: true },
        ];
        // Check actual visibility
        visItems.forEach(item => {
            const el = document.getElementById(item.id);
            if (el) {
                // pn-mini-donut uses 'hidden' class instead of display:none
                if (item.id === 'pn-mini-donut') {
                    item.visible = el.style.display !== 'none';
                } else {
                    item.visible = el.style.display !== 'none';
                }
            }
        });

        let html = '<div class="dsp-title">Map Settings</div>';
        html += '<div class="dsp-section">Update Frequency</div>';
        html += `<div class="dsp-row"><span class="dsp-label" title="How often the peer list is fetched from your node">Peer list</span><div class="dsp-input-wrap"><input type="number" class="dsp-input" id="dsp-poll-sec" value="${pollSec}" min="3" max="120"><span class="dsp-unit">sec</span></div></div>`;
        html += `<div class="dsp-row"><span class="dsp-label" title="How often node info and BTC price are refreshed">Node info &amp; price</span><div class="dsp-input-wrap"><input type="number" class="dsp-input" id="dsp-info-sec" value="${infoSec}" min="5" max="120"><span class="dsp-unit">sec</span></div></div>`;
        html += '<div class="dsp-section">Show / Hide</div>';
        visItems.forEach(item => {
            html += `<div class="dsp-row"><span class="dsp-label">${item.label}</span><label class="dsp-toggle"><input type="checkbox" data-vis-target="${item.id}" ${item.visible ? 'checked' : ''}><span class="dsp-toggle-slider"></span></label></div>`;
        });
        html += `<div class="dsp-row"><span class="dsp-label" title="Animate donuts to display top 8 ISP or anonymous networks on hover">Display Top ISP/Net</span><label class="dsp-toggle"><input type="checkbox" id="dsp-donut-legends" ${advSettings.showDonutLegends ? 'checked' : ''}><span class="dsp-toggle-slider"></span></label></div>`;
        html += '<button class="dsp-advanced-btn" id="dsp-advanced-btn">Advanced &#9881;</button>';
        html += `<a class="dsp-feedback-link" href="${repositoryDiscussionsUrl}" target="_blank" rel="noopener" title="Open the project discussions">Suggestions &amp; Bug Reports &#8599;</a>`;
        popup.innerHTML = html;
        document.body.appendChild(popup);
        displaySettingsEl = popup;

        // Bind Advanced button
        const advBtn = document.getElementById('dsp-advanced-btn');
        if (advBtn) {
            advBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeDisplaySettingsPopup();
                openAdvancedPanel();
            });
        }

        // Position near anchor
        if (anchorEl) {
            const rect = anchorEl.getBoundingClientRect();
            popup.style.right = (window.innerWidth - rect.right) + 'px';
            popup.style.top = (rect.bottom + 6) + 'px';
        }

        // Bind frequency inputs — restart active timers so new interval takes effect
        const pollInput = document.getElementById('dsp-poll-sec');
        if (pollInput) {
            pollInput.addEventListener('change', () => {
                const v = clamp(parseInt(pollInput.value) || 10, 3, 120);
                pollInput.value = v;
                CFG.pollInterval = v * 1000;
                // Restart the peer poll timer at the new interval
                if (peerPollTimer) clearInterval(peerPollTimer);
                peerPollTimer = setInterval(fetchPeers, CFG.pollInterval);
                // Restart countdown display so it uses the new interval
                lastPeerFetchTime = Date.now();
                startCountdownTimer();
            });
        }
        const infoInput = document.getElementById('dsp-info-sec');
        if (infoInput) {
            infoInput.addEventListener('change', () => {
                const v = clamp(parseInt(infoInput.value) || 15, 5, 120);
                infoInput.value = v;
                CFG.infoPollInterval = v * 1000;
                // Restart info poll timer at the new interval
                if (btcPriceTimer) clearInterval(btcPriceTimer);
                btcPriceTimer = setInterval(fetchInfo, CFG.infoPollInterval);
            });
        }

        // Bind show/hide visibility toggles
        popup.querySelectorAll('.dsp-toggle input[data-vis-target]').forEach(cb => {
            cb.addEventListener('change', () => {
                const targetId = cb.dataset.visTarget;
                const target = document.getElementById(targetId);
                if (!target) return;
                if (cb.checked) {
                    target.style.display = '';
                    // For private donut, also re-render if it was hidden
                    if (targetId === 'pn-mini-donut') {
                        renderPnMiniDonut();
                    }
                } else {
                    target.style.display = 'none';
                    // If hiding public donut, deselect any active AS
                    if (targetId === 'as-distribution-container' && window.ASDistribution && window.ASDistribution.getSelectedAs()) {
                        window.ASDistribution.deselect();
                    }
                    // If hiding private donut, exit private mode if active
                    if (targetId === 'pn-mini-donut' && privateNetMode) {
                        exitPrivateNetMode();
                    }
                }
            });
        });

        // Bind Display Top ISP/Net toggle
        const donutLegendsInput = document.getElementById('dsp-donut-legends');
        if (donutLegendsInput) {
            donutLegendsInput.addEventListener('change', () => {
                advSettings.showDonutLegends = donutLegendsInput.checked;
                saveAdvSettings();
                // Toggle legend visibility class on the AS distribution container
                const asCont = document.getElementById('as-distribution-container');
                if (asCont) {
                    if (advSettings.showDonutLegends) {
                        asCont.classList.remove('legends-hidden');
                    } else {
                        asCont.classList.add('legends-hidden');
                    }
                }
                // Toggle legend visibility on the PN mini donut
                const pnMiniLegend = document.getElementById('pn-mini-legend');
                if (pnMiniLegend) {
                    pnMiniLegend.style.display = advSettings.showDonutLegends ? '' : 'none';
                }
                // Notify AS distribution module of the legend visibility state
                if (window.ASDistribution && window.ASDistribution.setLegendsHidden) {
                    window.ASDistribution.setLegendsHidden(!advSettings.showDonutLegends);
                }
            });
        }

        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', closeDisplaySettingsOnOutside);
        }, 0);
    }

    /** Apply max peer rows setting — resizes the peer panel to show N rows.
     *  The handle is ~48px, thead ~22px, each body row ~22px. */
    function applyMaxPeerRows() {
        const panel = document.querySelector('.peer-panel');
        if (!panel) return;
        let prefitForPanelGrowth = false;
        if (maxPeerRows > 0) {
            // handle(48) + thead(22) + rows * 22 + a tiny bit of padding
            const h = 48 + 22 + (maxPeerRows * 22) + 4;
            const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
            const finalPanelTop = viewportHeight - h;
            const currentPanelTop = panel.getBoundingClientRect().top;
            panel.style.maxHeight = h + 'px';
            if (finalPanelTop < currentPanelTop) {
                fitDonutStackForPanelTop(finalPanelTop, true);
                prefitForPanelGrowth = true;
            }
        } else {
            panel.style.maxHeight = '';
        }
        if (prefitForPanelGrowth) {
            setTimeout(fitDonutStackToViewport, 520);
        } else {
            scheduleDonutStackFit();
        }
    }

    function closeDisplaySettingsOnOutside(e) {
        const advPanel = document.getElementById('adv-panel');
        if (advPanel && advPanel.contains(e.target)) return;
        if (displaySettingsEl && !displaySettingsEl.contains(e.target)) {
            closeDisplaySettingsPopup();
        }
    }

    function closeDisplaySettingsPopup() {
        if (displaySettingsEl) {
            displaySettingsEl.remove();
            displaySettingsEl = null;
        }
        document.removeEventListener('click', closeDisplaySettingsOnOutside);
    }

    /** Store latest system stats for modal use */
    let lastSystemStats = null;

    /** SSE stream reference (declared early so renderSystemInfoCard can check it) */
    let sysStreamSource = null;
    let sysStreamRetryDelay = 1000;

    function renderSystemInfoCard(stats) {
        // Merge modal-only fields (uptime, load, disk) into lastSystemStats
        // CPU/RAM/NET are driven by the SSE stream — don't overwrite those here
        if (!lastSystemStats) lastSystemStats = {};
        if (stats.uptime) lastSystemStats.uptime = stats.uptime;
        if (stats.uptime_sec) lastSystemStats.uptime_sec = stats.uptime_sec;
        if (stats.load_1 != null) lastSystemStats.load_1 = stats.load_1;
        if (stats.load_5 != null) lastSystemStats.load_5 = stats.load_5;
        if (stats.load_15 != null) lastSystemStats.load_15 = stats.load_15;
        if (stats.disk_total_gb != null) lastSystemStats.disk_total_gb = stats.disk_total_gb;
        if (stats.disk_used_gb != null) lastSystemStats.disk_used_gb = stats.disk_used_gb;
        if (stats.disk_free_gb != null) lastSystemStats.disk_free_gb = stats.disk_free_gb;
        if (stats.disk_pct != null) lastSystemStats.disk_pct = stats.disk_pct;
        if (stats.cpu_breakdown) lastSystemStats.cpu_breakdown = stats.cpu_breakdown;

        // Only update CPU/RAM display if SSE stream is not active (fallback)
        if (!sysStreamSource) {
            const cpuEl = document.getElementById('ro-cpu');
            const ramEl = document.getElementById('ro-ram');
            if (cpuEl && stats.cpu_pct != null) {
                const cpuPct = Math.round(stats.cpu_pct);
                cpuEl.textContent = cpuPct + '%';
                pulseOnChange('ro-cpu', cpuPct, 'white');
            }
            if (ramEl && stats.mem_pct != null) {
                const memPct = Math.round(stats.mem_pct);
                ramEl.textContent = memPct + '%';
                pulseOnChange('ro-ram', memPct, 'white');
            }
        }

        // Update right overlay GeoIP DB entry count
        const geodbCountEl = document.getElementById('ro-geodb-count');
        if (geodbCountEl && lastNodeInfo && lastNodeInfo.geo_db_stats && lastNodeInfo.geo_db_stats.entries != null) {
            geodbCountEl.textContent = lastNodeInfo.geo_db_stats.entries.toLocaleString();
        }
    }

    /** Open combined System Info modal — system stats + NET bar settings + display toggles + recent changes */
    function openSystemInfoModal() {
        const existing = document.getElementById('system-info-modal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'system-info-modal';
        overlay.innerHTML = `<div class="modal-box" style="max-width:560px"><div class="modal-header"><span class="modal-title">System Info</span><button class="modal-close" id="system-info-close">&times;</button></div><div class="modal-body" id="system-info-body"><div style="color:var(--text-muted);text-align:center;padding:16px">Loading...</div></div></div>`;
        document.body.appendChild(overlay);
        document.getElementById('system-info-close').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        const body = document.getElementById('system-info-body');
        const stats = lastSystemStats || {};
        const cpuPct = stats.cpu_pct != null ? Math.round(stats.cpu_pct) : null;
        const memPct = stats.mem_pct != null ? Math.round(stats.mem_pct) : null;
        const memUsed = stats.mem_used_mb;
        const memTotal = stats.mem_total_mb;
        let html = '';

        // ── Section 1: System Overview ──
        html += '<div class="modal-section-title">System</div>';
        // CPU with bar
        html += '<div class="info-row"><span class="info-label">CPU</span>';
        if (cpuPct != null) {
            html += `<span class="info-val info-bar-wrap"><span class="info-bar" style="width:${cpuPct}%"></span><span class="info-bar-text">${cpuPct}%</span></span>`;
        } else {
            html += '<span class="info-val">\u2014</span>';
        }
        html += '</div>';
        // RAM with bar
        html += '<div class="info-row"><span class="info-label">RAM</span>';
        if (memPct != null) {
            const memStr = (memUsed && memTotal) ? `${memPct}% (${memUsed}/${memTotal} MB)` : `${memPct}%`;
            html += `<span class="info-val info-bar-wrap"><span class="info-bar" style="width:${memPct}%"></span><span class="info-bar-text">${memStr}</span></span>`;
        } else {
            html += '<span class="info-val">\u2014</span>';
        }
        html += '</div>';
        // Uptime
        if (stats.uptime) {
            html += `<div class="info-row"><span class="info-label">Uptime</span><span class="info-val">${stats.uptime}</span></div>`;
        }
        // Load average
        if (stats.load_1 != null) {
            html += `<div class="info-row"><span class="info-label">Load Avg</span><span class="info-val">${stats.load_1.toFixed(2)} / ${stats.load_5.toFixed(2)} / ${stats.load_15.toFixed(2)}</span></div>`;
        }
        // Disk usage
        if (stats.disk_pct != null) {
            const diskStr = `${stats.disk_pct}% (${stats.disk_used_gb} / ${stats.disk_total_gb} GB)`;
            html += `<div class="info-row"><span class="info-label">Disk</span><span class="info-val info-bar-wrap"><span class="info-bar" style="width:${stats.disk_pct}%"></span><span class="info-bar-text">${diskStr}</span></span></div>`;
        }

        // ── Section 2: Network Traffic ──
        html += '<div class="modal-section-title">Network Traffic</div>';
        if (lastNetTraffic) {
            const rx = lastNetTraffic.rx_bps || 0;
            const tx = lastNetTraffic.tx_bps || 0;
            const curMaxIn = netBarMode === 'manual' ? netBarManualMaxIn : getAdaptiveMax(netHistoryIn);
            const curMaxOut = netBarMode === 'manual' ? netBarManualMaxOut : getAdaptiveMax(netHistoryOut);
            const rxPct = Math.min(100, (rx / curMaxIn) * 100);
            const txPct = Math.min(100, (tx / curMaxOut) * 100);
            html += `<div class="info-row"><span class="info-label">IN \u2193</span><span class="info-val net-traffic-bar-wrap"><span class="net-traffic-bar-bg"><span class="net-traffic-bar traffic-in" style="width:${rxPct}%"></span></span><span class="net-traffic-rate">${formatBps(rx)}</span></span></div>`;
            html += `<div class="info-row"><span class="info-label">OUT \u2191</span><span class="info-val net-traffic-bar-wrap"><span class="net-traffic-bar-bg"><span class="net-traffic-bar traffic-out" style="width:${txPct}%"></span></span><span class="net-traffic-rate">${formatBps(tx)}</span></span></div>`;
            html += `<div class="info-row" style="margin-top:2px"><span class="info-label">Current Max</span><span class="info-val" style="font-size:10px">IN: ${formatBps(curMaxIn)} \u00b7 OUT: ${formatBps(curMaxOut)}</span></div>`;
        } else {
            html += '<div style="color:var(--text-muted);padding:4px 0">No traffic data yet</div>';
        }
        if (lastNodeInfo && lastNodeInfo.node_traffic) {
            const traffic = lastNodeInfo.node_traffic;
            html += `<div class="info-row"><span class="info-label">P2P IN \u2193</span><span class="info-val">${traffic.download_fmt || fmtBytesShort(traffic.download_bytes || 0)}</span></div>`;
            html += `<div class="info-row"><span class="info-label">P2P OUT \u2191</span><span class="info-val">${traffic.upload_fmt || fmtBytesShort(traffic.upload_bytes || 0)}</span></div>`;
        }

        // ── Section 3: NET Bar Settings ──
        html += '<div class="modal-section-title">NET Bar Scaling</div>';
        const manualMaxInKB = Math.round(netBarManualMaxIn / 1024);
        const manualMaxOutKB = Math.round(netBarManualMaxOut / 1024);
        html += '<div class="si-net-mode">';
        html += `<label class="si-radio"><input type="radio" name="si-netbar-mode" value="auto" ${netBarMode === 'auto' ? 'checked' : ''}><span class="si-radio-dot"></span><span class="si-radio-text"><span class="si-radio-label">Auto-detect</span><span class="si-radio-desc">Adapts to p90 of recent traffic (recommended)</span></span></label>`;
        html += `<label class="si-radio"><input type="radio" name="si-netbar-mode" value="manual" ${netBarMode === 'manual' ? 'checked' : ''}><span class="si-radio-dot"></span><span class="si-radio-text"><span class="si-radio-label">Manual</span><span class="si-radio-desc">Set fixed max values for bar scaling</span></span></label>`;
        html += '</div>';
        html += `<div class="si-manual-fields" id="si-manual-fields" style="display:${netBarMode === 'manual' ? 'block' : 'none'}">`;
        html += `<div class="info-row"><span class="info-label">Max IN</span><div class="dsp-input-wrap"><input type="number" class="dsp-input" id="si-max-in" value="${manualMaxInKB}" min="1" max="999999"><span class="dsp-unit">KB/s</span></div></div>`;
        html += `<div class="info-row"><span class="info-label">Max OUT</span><div class="dsp-input-wrap"><input type="number" class="dsp-input" id="si-max-out" value="${manualMaxOutKB}" min="1" max="999999"><span class="dsp-unit">KB/s</span></div></div>`;
        html += '</div>';

        // ── Section 4: Dashboard Display ──
        html += '<div class="modal-section-title">Dashboard Display</div>';
        const dashItems = [
            { id: 'mo-row-cpu', label: 'CPU' },
            { id: 'mo-row-ram', label: 'RAM' },
            { id: 'mo-row-netin', label: 'NET \u2193 (Download)' },
            { id: 'mo-row-netout', label: 'NET \u2191 (Upload)' },
        ];
        dashItems.forEach(item => {
            const el = document.getElementById(item.id);
            const vis = el ? el.style.display !== 'none' : true;
            html += `<div class="info-row"><span class="info-label">${item.label}</span><label class="dsp-toggle"><input type="checkbox" class="si-dash-toggle" data-target="${item.id}" ${vis ? 'checked' : ''}><span class="dsp-toggle-slider"></span></label></div>`;
        });

        body.innerHTML = html;

        // ── Bind NET bar mode radios ──
        const modeRadios = body.querySelectorAll('input[name="si-netbar-mode"]');
        const manualFields = document.getElementById('si-manual-fields');
        modeRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                netBarMode = radio.value;
                if (manualFields) manualFields.style.display = netBarMode === 'manual' ? 'block' : 'none';
                updateHandleTrafficBars();
            });
        });

        // ── Bind manual max inputs ──
        const maxInInput = document.getElementById('si-max-in');
        const maxOutInput = document.getElementById('si-max-out');
        if (maxInInput) {
            maxInInput.addEventListener('change', () => {
                const v = clamp(parseInt(maxInInput.value) || 100, 1, 999999);
                maxInInput.value = v;
                netBarManualMaxIn = v * 1024;
                if (netBarMode === 'manual') updateHandleTrafficBars();
            });
        }
        if (maxOutInput) {
            maxOutInput.addEventListener('change', () => {
                const v = clamp(parseInt(maxOutInput.value) || 100, 1, 999999);
                maxOutInput.value = v;
                netBarManualMaxOut = v * 1024;
                if (netBarMode === 'manual') updateHandleTrafficBars();
            });
        }

        // ── Bind dashboard display toggles ──
        body.querySelectorAll('.si-dash-toggle').forEach(cb => {
            cb.addEventListener('change', () => {
                const target = document.getElementById(cb.dataset.target);
                if (target) target.style.display = cb.checked ? '' : 'none';
            });
        });
    }

    // ═══════════════════════════════════════════════════════════
    // NETWORK TRAFFIC + SYSTEM STATS — SSE stream with dual-EMA
    // ═══════════════════════════════════════════════════════════

    let lastNetTraffic = null;

    // NET bar scaling mode: 'auto' uses p90 adaptive, 'manual' uses fixed max values
    let netBarMode = 'auto';
    let netBarManualMaxIn = 1024 * 1024;   // 1 MB/s default manual max for IN
    let netBarManualMaxOut = 1024 * 1024;  // 1 MB/s default manual max for OUT

    // History arrays for adaptive max (from original dashboard)
    const netHistoryIn = [];
    const netHistoryOut = [];
    const NET_HISTORY_SIZE = 30;

    function getAdaptiveMax(history) {
        if (history.length < 3) return 50 * 1024;
        const sorted = [...history].sort((a, b) => a - b);
        const p90Index = Math.floor(sorted.length * 0.9);
        const p90 = sorted[p90Index] || sorted[sorted.length - 1];
        return Math.max(p90 * 1.2, 10 * 1024);
    }

    /** Update the traffic bars in the right overlay */
    function updateHandleTrafficBars() {
        if (!lastNetTraffic) return;
        const rx = lastNetTraffic.rx_bps || 0;
        const tx = lastNetTraffic.tx_bps || 0;

        // Push to history for adaptive scaling
        netHistoryIn.push(rx);
        netHistoryOut.push(tx);
        if (netHistoryIn.length > NET_HISTORY_SIZE) netHistoryIn.shift();
        if (netHistoryOut.length > NET_HISTORY_SIZE) netHistoryOut.shift();

        const maxIn = netBarMode === 'manual' ? netBarManualMaxIn : getAdaptiveMax(netHistoryIn);
        const maxOut = netBarMode === 'manual' ? netBarManualMaxOut : getAdaptiveMax(netHistoryOut);

        const rxPct = Math.min(100, (rx / maxIn) * 100);
        const txPct = Math.min(100, (tx / maxOut) * 100);

        const barIn = document.getElementById('ro-bar-in');
        const barOut = document.getElementById('ro-bar-out');
        const rateIn = document.getElementById('ro-rate-in');
        const rateOut = document.getElementById('ro-rate-out');

        if (barIn) barIn.style.width = rxPct + '%';
        if (barOut) barOut.style.width = txPct + '%';
        if (rateIn) rateIn.textContent = formatBps(rx);
        if (rateOut) rateOut.textContent = formatBps(tx);
    }

    /** Format bytes/sec to human-readable string */
    function formatBps(bps) {
        if (bps < 1024) return `${Math.round(bps)} B/s`;
        if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
        return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
    }

    // ── Number tweening state for smooth CPU/RAM text ──
    let tweenCpu = { current: null, target: null, el: null };
    let tweenRam = { current: null, target: null, el: null };
    let tweenRafId = null;

    function startTweenLoop() {
        if (tweenRafId !== null) return;

        function advanceTween(tween) {
            if (tween.current === null || tween.target === null || !tween.el) return false;

            const diff = tween.target - tween.current;
            if (Math.abs(diff) < 0.15) {
                tween.current = tween.target;
            } else {
                tween.current += diff * 0.06;
            }

            const displayValue = Math.round(tween.current) + '%';
            if (tween.el.textContent !== displayValue) tween.el.textContent = displayValue;
            return tween.current !== tween.target;
        }

        function tick() {
            tweenRafId = null;
            const cpuActive = advanceTween(tweenCpu);
            const ramActive = advanceTween(tweenRam);
            if (cpuActive || ramActive) tweenRafId = requestAnimationFrame(tick);
        }
        tweenRafId = requestAnimationFrame(tick);
    }

    // ── SSE EventSource for real-time system stats ──
    function connectSystemStream() {
        if (sysStreamSource) { sysStreamSource.close(); sysStreamSource = null; }
        sysStreamSource = new EventSource('/api/stream/system');

        sysStreamSource.addEventListener('system', (e) => {
            try {
                const d = JSON.parse(e.data);
                let tweenChanged = false;

                // ── NET traffic (deadband: only update visuals for changes > 2 KB/s) ──
                const newRx = d.rx_bps || 0;
                const newTx = d.tx_bps || 0;
                const prevRx = lastNetTraffic ? lastNetTraffic.rx_bps : 0;
                const prevTx = lastNetTraffic ? lastNetTraffic.tx_bps : 0;
                const firstSample = !lastNetTraffic;
                // Always update cache so future comparisons use current values
                lastNetTraffic = { rx_bps: newRx, tx_bps: newTx };
                // Only trigger visual update when change exceeds deadband
                if (Math.abs(newRx - prevRx) > 2048 || Math.abs(newTx - prevTx) > 2048 || firstSample) {
                    updateHandleTrafficBars();
                }

                // ── CPU with tweening (deadband: ignore changes < 1%) ──
                const cpuEl = document.getElementById('ro-cpu');
                if (cpuEl && d.cpu_pct != null) {
                    tweenCpu.el = cpuEl;
                    if (tweenCpu.current === null) {
                        tweenCpu.current = d.cpu_pct;
                        tweenCpu.target = d.cpu_pct;
                        cpuEl.textContent = Math.round(d.cpu_pct) + '%';
                    } else if (Math.abs(d.cpu_pct - tweenCpu.target) >= 1.0) {
                        tweenCpu.target = d.cpu_pct;
                        tweenChanged = true;
                        pulseOnChange('ro-cpu', Math.round(d.cpu_pct), 'white');
                    }
                }

                // ── RAM with tweening (deadband: ignore changes < 0.5%) ──
                const ramEl = document.getElementById('ro-ram');
                if (ramEl && d.mem_pct != null) {
                    tweenRam.el = ramEl;
                    if (tweenRam.current === null) {
                        tweenRam.current = d.mem_pct;
                        tweenRam.target = d.mem_pct;
                        ramEl.textContent = Math.round(d.mem_pct) + '%';
                    } else if (Math.abs(d.mem_pct - tweenRam.target) >= 0.5) {
                        tweenRam.target = d.mem_pct;
                        tweenChanged = true;
                        pulseOnChange('ro-ram', Math.round(d.mem_pct), 'white');
                    }
                    // Update hover tooltip
                    let hoverParts = [`Memory: ${Math.round(d.mem_pct)}%`];
                    if (d.mem_used_mb && d.mem_total_mb) hoverParts.push(`Used: ${d.mem_used_mb} / ${d.mem_total_mb} MB`);
                    if (d.cpu_pct != null) hoverParts.push(`CPU: ${Math.round(d.cpu_pct)}%`);
                    ramEl.title = hoverParts.join('\n');
                }

                if (tweenChanged) startTweenLoop();

                // Store for modal use (merge with existing lastSystemStats)
                if (!lastSystemStats) lastSystemStats = {};
                lastSystemStats.cpu_pct = d.cpu_pct;
                lastSystemStats.mem_pct = d.mem_pct;
                lastSystemStats.mem_used_mb = d.mem_used_mb;
                lastSystemStats.mem_total_mb = d.mem_total_mb;

                sysStreamRetryDelay = 1000; // reset on success
            } catch (err) {
                console.error('[Bitcoin Peer Map] SSE parse error:', err);
            }
        });

        sysStreamSource.onerror = () => {
            sysStreamSource.close();
            sysStreamSource = null;
            // Reconnect with backoff (max 10s)
            setTimeout(connectSystemStream, sysStreamRetryDelay);
            sysStreamRetryDelay = Math.min(sysStreamRetryDelay * 1.5, 10000);
        };
    }

    // ═══════════════════════════════════════════════════════════
    // ADVANCED DISPLAY SETTINGS — Floating draggable panel
    // ═══════════════════════════════════════════════════════════

    let advPanelEl = null;

    function openAdvancedPanel() {
        if (advPanelEl) { advPanelEl.remove(); advPanelEl = null; }

        const panel = document.createElement('div');
        panel.className = 'adv-panel';
        panel.id = 'adv-panel';

        // ── Build HTML ──
        let h = '';
        // Titlebar
        h += '<div class="adv-titlebar" id="adv-titlebar">';
        h += '<span class="adv-titlebar-text">Advanced Display</span>';
        h += '<button class="adv-close" id="adv-close" title="Close">&times;</button>';
        h += '</div>';

        h += '<div class="adv-body">';

        // ── Theme Selector (custom dropdown) ──
        h += '<div class="adv-theme-section">';
        h += '<div class="adv-section">Theme</div>';
        h += '<div class="adv-theme-wrap" id="adv-theme-wrap">';
        h += '<div class="adv-theme-selected" id="adv-theme-selected">';
        h += '<span id="adv-theme-current">' + (THEMES[currentTheme] ? THEMES[currentTheme].label : 'Dark') + '</span>';
        h += '<span class="adv-theme-arrow">&#9660;</span>';
        h += '</div>';
        h += '<div class="adv-theme-list" id="adv-theme-list">';
        for (const [key, theme] of Object.entries(THEMES)) {
            const active = (key === currentTheme) ? ' active' : '';
            h += '<div class="adv-theme-option' + active + '" data-theme="' + key + '">';
            h += '<span>' + theme.label + '</span>';
            h += '<span class="adv-theme-check">&#10003;</span>';
            // Hover tooltip with color dot + description
            h += '<div class="adv-theme-tip">';
            h += '<div class="adv-theme-tip-head">';
            h += '<span class="adv-theme-tip-dot" style="background:' + (theme.dot || '#888') + '"></span>';
            h += '<span class="adv-theme-tip-name">' + theme.label + '</span>';
            h += '</div>';
            h += '<div class="adv-theme-tip-desc">' + (theme.desc || '') + '</div>';
            h += '</div>';
            h += '</div>';
        }
        h += '</div>'; // end theme-list
        h += '</div>'; // end theme-wrap
        h += '</div>'; // end theme-section

        // ── Service Provider Distribution ──
        h += '<div class="adv-section">Service Provider Distribution</div>';
        h += advSliderHTML('adv-as-linewidth', 'Line Thickness', advSettings.asLineWidth, 0, 100, 1);
        h += advSliderHTML('adv-as-fan', 'Line Fanning', advSettings.asLineFan, 0, 100, 1);

        // ── Peer Effects ──
        h += '<div class="adv-section">Peer Effects</div>';
        h += advSliderHTML('adv-shimmer', 'Shimmer', advSettings.shimmerStrength, 0, 1, 0.01);
        h += advSliderHTML('adv-pdepth-in', 'Pulse Depth In', advSettings.pulseDepthIn, 0, 1, 0.01);
        h += advSliderHTML('adv-pdepth-out', 'Pulse Depth Out', advSettings.pulseDepthOut, 0, 1, 0.01);
        h += advSliderHTML('adv-pspeed-in', 'Pulse Speed In', advSettings.pulseSpeedIn, 0, 100, 1);
        h += advSliderHTML('adv-pspeed-out', 'Pulse Speed Out', advSettings.pulseSpeedOut, 0, 100, 1);

        // ── Land ──
        h += '<div class="adv-section">Land</div>';
        h += advSliderHTML('adv-land-hue', 'Hue', advSettings.landHue, 0, 360, 1, true);
        h += advSliderHTML('adv-land-bright', 'Brightness', advSettings.landBright, 0, 100, 1);
        h += advSliderHTML('adv-snow-poles', 'Snow the Poles', advSettings.snowPoles, 0, 100, 1, false, true);
        h += '<div class="adv-note">*Use Peer table <span style="font-size:11px">&#9881;</span> below to adjust its transparency</div>';

        // ── Ocean ──
        h += '<div class="adv-section">Ocean</div>';
        h += '<div class="adv-preset-row">';
        h += '<span class="adv-preset-label">Preset</span>';
        h += '<span class="adv-preset-chip' + (advSettings.oceanLightBlue ? '' : ' active') + '" id="adv-ocean-original">Original</span>';
        h += '<span class="adv-preset-chip' + (advSettings.oceanLightBlue ? ' active' : '') + '" id="adv-ocean-lightblue">Light Blue</span>';
        h += '</div>';
        // Hue slider range depends on mode: Light Blue = 190-230, Original = 0-360
        if (advSettings.oceanLightBlue) {
            const clampedHue = Math.max(190, Math.min(230, advSettings.oceanHue));
            h += advSliderHTML('adv-ocean-hue', 'Hue', clampedHue, 190, 230, 1, false);
            // Swap class after build — blue-hue-slider applied by syncOceanPresetUI on bind
        } else {
            h += advSliderHTML('adv-ocean-hue', 'Hue', advSettings.oceanHue, 0, 360, 1, true);
        }
        h += advSliderHTML('adv-ocean-bright', 'Brightness', advSettings.oceanBright, 0, 100, 1);

        // ── Lat/Lon Grid ──
        h += '<div class="adv-section">Lat/Lon Grid</div>';
        h += '<div class="adv-toggle-row">';
        h += '<span class="adv-toggle-label adv-reset-link" data-default-key="gridVisible" title="Click to reset">Visible</span>';
        h += '<label class="dsp-toggle"><input type="checkbox" id="adv-grid-visible" ' + (advSettings.gridVisible ? 'checked' : '') + '><span class="dsp-toggle-slider"></span></label>';
        h += '</div>';
        h += advSliderHTML('adv-grid-thick', 'Thickness', advSettings.gridThickness, 0, 100, 1);
        h += advSliderHTML('adv-grid-hue', 'Hue', advSettings.gridHue, 0, 360, 1, true);
        h += advSliderHTML('adv-grid-bright', 'Brightness', advSettings.gridBright, 0, 100, 1);

        // ── Borders ──
        h += '<div class="adv-section">Borders</div>';
        h += advSliderHTML('adv-border-scale', 'Thickness', advSettings.borderScale, 0, 100, 1);
        h += advSliderHTML('adv-border-hue', 'Hue', advSettings.borderHue, 0, 360, 1, true);

        // ── HUD ──
        h += '<div class="adv-section">HUD Overlays</div>';
        h += '<div class="adv-toggle-row">';
        h += '<span class="adv-toggle-label">Solid Backgrounds</span>';
        h += '<label class="dsp-toggle"><input type="checkbox" id="adv-hud-solid" ' + (advSettings.hudSolidBg ? 'checked' : '') + '><span class="dsp-toggle-slider"></span></label>';
        h += '</div>';
        h += '<div class="adv-note">Adds backgrounds behind stats, price &amp; info panels for readability on lighter maps</div>';

        h += '</div>'; // end adv-body

        // Footer buttons + feedback area
        h += '<div class="adv-footer">';
        h += '<button class="adv-btn adv-btn-reset" id="adv-reset">Reset</button>';
        h += '<button class="adv-btn adv-btn-session" id="adv-session-save" title="Keeps settings for this session only — closes menu">Session Save</button>';
        h += '<button class="adv-btn adv-btn-save" id="adv-save" title="Saves settings permanently across sessions">Permanent Save</button>';
        h += '</div>';
        h += '<div class="adv-feedback" id="adv-feedback"></div>';

        panel.innerHTML = h;
        document.body.appendChild(panel);
        advPanelEl = panel;

        // ── Position: top-right, offset from edge ──
        positionAdvPanel();

        // ── Bind close ──
        document.getElementById('adv-close').addEventListener('click', closeAdvancedPanel);

        // ── Bind theme dropdown ──
        const themeWrap = document.getElementById('adv-theme-wrap');
        const themeSelected = document.getElementById('adv-theme-selected');
        const themeList = document.getElementById('adv-theme-list');
        if (themeSelected && themeWrap) {
            themeSelected.addEventListener('click', (e) => {
                e.stopPropagation();
                themeWrap.classList.toggle('open');
            });
            // Close dropdown when clicking outside
            document.addEventListener('click', function themeOutsideClick(e) {
                if (!themeWrap.contains(e.target)) {
                    themeWrap.classList.remove('open');
                }
                // Clean up when panel is removed
                if (!document.body.contains(themeWrap)) {
                    document.removeEventListener('click', themeOutsideClick);
                }
            });
        }
        if (themeList) {
            themeList.querySelectorAll('.adv-theme-option').forEach(opt => {
                opt.addEventListener('click', () => {
                    const t = opt.dataset.theme;
                    if (t && THEMES[t]) {
                        applyTheme(t);
                        // Update dropdown display
                        const label = document.getElementById('adv-theme-current');
                        if (label) label.textContent = THEMES[t].label;
                        // Mark active option
                        themeList.querySelectorAll('.adv-theme-option').forEach(o => o.classList.remove('active'));
                        opt.classList.add('active');
                        // Close dropdown
                        if (themeWrap) themeWrap.classList.remove('open');
                        // Refresh slider values for new theme map defaults
                        refreshAllAdvSliders();
                        const gv = document.getElementById('adv-grid-visible');
                        if (gv) gv.checked = advSettings.gridVisible;
                    }
                });
            });
        }

        // ── Bind drag ──
        initAdvDrag();

        // ── Bind all sliders ──
        bindAdvSlider('adv-shimmer', v => { advSettings.shimmerStrength = v; CFG.shimmerStrength = v; });
        bindAdvSlider('adv-pdepth-in', v => { advSettings.pulseDepthIn = v; CFG.pulseDepthInbound = v; });
        bindAdvSlider('adv-pdepth-out', v => { advSettings.pulseDepthOut = v; CFG.pulseDepthOutbound = v; });
        bindAdvSlider('adv-pspeed-in', v => {
            advSettings.pulseSpeedIn = v;
            CFG.pulseSpeedInbound = 0.0014 * Math.pow(2, (v - 50) / 30);
        });
        bindAdvSlider('adv-pspeed-out', v => {
            advSettings.pulseSpeedOut = v;
            CFG.pulseSpeedOutbound = 0.0026 * Math.pow(2, (v - 50) / 30);
        });
        bindAdvSlider('adv-land-hue', v => { advSettings.landHue = v; updateAdvColors(); });
        bindAdvSlider('adv-land-bright', v => { advSettings.landBright = v; updateAdvColors(); });
        bindAdvSlider('adv-snow-poles', v => { advSettings.snowPoles = v; markBasemapDirty(); });
        bindAdvSlider('adv-ocean-hue', v => { advSettings.oceanHue = v; updateAdvColors(); });
        bindAdvSlider('adv-ocean-bright', v => { advSettings.oceanBright = v; updateAdvColors(); });

        // ── Bind ocean preset chips ──
        const oceanOrigBtn = document.getElementById('adv-ocean-original');
        const oceanLBBtn   = document.getElementById('adv-ocean-lightblue');
        if (oceanOrigBtn) oceanOrigBtn.addEventListener('click', () => {
            advSettings.oceanLightBlue = false;
            advSettings.oceanHue = ADV_DEFAULTS.oceanHue;
            advSettings.oceanBright = ADV_DEFAULTS.oceanBright;
            syncOceanPresetUI();            // restores hue slider to 0-360
            setSliderValue('adv-ocean-hue', advSettings.oceanHue);
            setSliderValue('adv-ocean-bright', advSettings.oceanBright);
            updateAdvColors();
        });
        if (oceanLBBtn) oceanLBBtn.addEventListener('click', () => {
            advSettings.oceanLightBlue = true;
            advSettings.oceanHue = 210;     // center of blue range
            advSettings.oceanBright = 50;   // midpoint — soft sky blue
            syncOceanPresetUI();            // constrains hue slider to 190-230
            setSliderValue('adv-ocean-hue', advSettings.oceanHue);
            setSliderValue('adv-ocean-bright', advSettings.oceanBright);
            updateAdvColors();
        });
        bindAdvSlider('adv-grid-thick', v => { advSettings.gridThickness = v; updateAdvColors(); });
        bindAdvSlider('adv-grid-hue', v => { advSettings.gridHue = v; updateAdvColors(); });
        bindAdvSlider('adv-grid-bright', v => { advSettings.gridBright = v; updateAdvColors(); });
        bindAdvSlider('adv-as-linewidth', v => { advSettings.asLineWidth = v; });
        bindAdvSlider('adv-as-fan', v => { advSettings.asLineFan = v; });
        bindAdvSlider('adv-border-scale', v => { advSettings.borderScale = v; markBasemapDirty(); });
        bindAdvSlider('adv-border-hue', v => { advSettings.borderHue = v; updateAdvColors(); });

        // ── Bind grid visibility toggle ──
        const gridVisCB = document.getElementById('adv-grid-visible');
        if (gridVisCB) gridVisCB.addEventListener('change', () => {
            advSettings.gridVisible = gridVisCB.checked;
            markBasemapDirty();
        });

        // ── Bind HUD solid background toggle ──
        const hudSolidCB = document.getElementById('adv-hud-solid');
        if (hudSolidCB) hudSolidCB.addEventListener('change', () => { advSettings.hudSolidBg = hudSolidCB.checked; applyHudSolidBg(); });

        // ── Apply blue-hue-slider class if Light Blue mode is active ──
        syncOceanPresetUI();

        // ── Bind slider labels as reset-to-default links ──
        bindLabelResets(panel);

        // ── Reset button ──
        document.getElementById('adv-reset').addEventListener('click', () => {
            // Reset theme to Dark
            applyTheme('dark');
            Object.assign(advSettings, ADV_DEFAULTS);
            CFG.shimmerStrength    = ADV_DEFAULTS.shimmerStrength;
            CFG.pulseDepthInbound  = ADV_DEFAULTS.pulseDepthIn;
            CFG.pulseDepthOutbound = ADV_DEFAULTS.pulseDepthOut;
            CFG.pulseSpeedInbound  = 0.0014;
            CFG.pulseSpeedOutbound = 0.0026;
            updateAdvColors();
            syncOceanPresetUI();
            refreshAllAdvSliders();
            const gv = document.getElementById('adv-grid-visible');
            if (gv) gv.checked = ADV_DEFAULTS.gridVisible;
            const hs = document.getElementById('adv-hud-solid');
            if (hs) hs.checked = ADV_DEFAULTS.hudSolidBg;
            applyHudSolidBg();
            showAdvFeedback('All settings reset to defaults');
        });

        // ── Session Save button — just close the panel (settings persist in memory) ──
        document.getElementById('adv-session-save').addEventListener('click', () => {
            showAdvFeedback('Session settings applied');
            setTimeout(closeAdvancedPanel, 400);
        });

        // ── Permanent Save button ──
        document.getElementById('adv-save').addEventListener('click', () => {
            saveAdvSettings();
            saveTheme();
            showAdvFeedback('Settings saved permanently');
        });
    }

    /** Generate HTML for a single slider row — label is a clickable reset link */
    function advSliderHTML(id, label, value, min, max, step, isHue, bold) {
        const cls = isHue ? 'adv-slider hue-slider' : 'adv-slider';
        const display = (step < 1) ? parseFloat(value).toFixed(2) : Math.round(value);
        const bOpen = bold ? '<b>' : '', bClose = bold ? '</b>' : '';
        return '<div class="adv-slider-row">' +
            '<span class="adv-slider-label adv-reset-link" data-slider="' + id + '" title="Click to reset to default">' + bOpen + label + bClose + '</span>' +
            '<input type="range" class="' + cls + '" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '">' +
            '<span class="adv-slider-val" id="' + id + '-val">' + display + '</span>' +
            '</div>';
    }

    /** Bind a slider to a callback, fires on every input event (live) */
    function bindAdvSlider(id, callback) {
        const slider = document.getElementById(id);
        const valEl  = document.getElementById(id + '-val');
        if (!slider) return;
        slider.addEventListener('input', () => {
            const v = parseFloat(slider.value);
            if (valEl) valEl.textContent = (parseFloat(slider.step) < 1) ? v.toFixed(2) : Math.round(v);
            callback(v);
        });
    }

    /** Set a slider value programmatically and update its display */
    function setSliderValue(id, val) {
        const slider = document.getElementById(id);
        const valEl  = document.getElementById(id + '-val');
        if (slider) {
            slider.value = val;
            if (valEl) valEl.textContent = (parseFloat(slider.step) < 1) ? parseFloat(val).toFixed(2) : Math.round(val);
        }
    }

    /** Refresh all slider positions from current advSettings */
    function refreshAllAdvSliders() {
        setSliderValue('adv-as-linewidth', advSettings.asLineWidth);
        setSliderValue('adv-as-fan', advSettings.asLineFan);
        setSliderValue('adv-shimmer', advSettings.shimmerStrength);
        setSliderValue('adv-pdepth-in', advSettings.pulseDepthIn);
        setSliderValue('adv-pdepth-out', advSettings.pulseDepthOut);
        setSliderValue('adv-pspeed-in', advSettings.pulseSpeedIn);
        setSliderValue('adv-pspeed-out', advSettings.pulseSpeedOut);
        setSliderValue('adv-land-hue', advSettings.landHue);
        setSliderValue('adv-land-bright', advSettings.landBright);
        setSliderValue('adv-snow-poles', advSettings.snowPoles);
        setSliderValue('adv-ocean-hue', advSettings.oceanHue);
        setSliderValue('adv-ocean-bright', advSettings.oceanBright);
        setSliderValue('adv-grid-thick', advSettings.gridThickness);
        setSliderValue('adv-grid-hue', advSettings.gridHue);
        setSliderValue('adv-grid-bright', advSettings.gridBright);
        setSliderValue('adv-border-scale', advSettings.borderScale);
        setSliderValue('adv-border-hue', advSettings.borderHue);
    }

    /** Map slider IDs to their advSettings key and default value */
    const SLIDER_DEFAULTS = {
        'adv-as-linewidth':{ key: 'asLineWidth' },
        'adv-as-fan':      { key: 'asLineFan' },
        'adv-shimmer':     { key: 'shimmerStrength', cfg: 'shimmerStrength' },
        'adv-pdepth-in':   { key: 'pulseDepthIn',   cfg: 'pulseDepthInbound' },
        'adv-pdepth-out':  { key: 'pulseDepthOut',   cfg: 'pulseDepthOutbound' },
        'adv-pspeed-in':   { key: 'pulseSpeedIn',    cfgFn: v => { CFG.pulseSpeedInbound = 0.0014 * Math.pow(2, (v - 50) / 30); } },
        'adv-pspeed-out':  { key: 'pulseSpeedOut',   cfgFn: v => { CFG.pulseSpeedOutbound = 0.0026 * Math.pow(2, (v - 50) / 30); } },
        'adv-land-hue':    { key: 'landHue',         recolor: true },
        'adv-land-bright': { key: 'landBright',      recolor: true },
        'adv-snow-poles':  { key: 'snowPoles', redraw: true },
        'adv-ocean-hue':   { key: 'oceanHue',        recolor: true },
        'adv-ocean-bright':{ key: 'oceanBright',     recolor: true },
        'adv-grid-thick':  { key: 'gridThickness',   recolor: true },
        'adv-grid-hue':    { key: 'gridHue',         recolor: true },
        'adv-grid-bright': { key: 'gridBright',      recolor: true },
        'adv-border-scale':{ key: 'borderScale', redraw: true },
        'adv-border-hue':  { key: 'borderHue',      recolor: true },
    };

    /** Bind every .adv-reset-link label to reset its slider/toggle to default on click */
    function bindLabelResets(panel) {
        panel.querySelectorAll('.adv-reset-link').forEach(label => {
            // Slider reset
            const sliderId = label.dataset.slider;
            if (sliderId) {
                label.addEventListener('click', () => {
                    const info = SLIDER_DEFAULTS[sliderId];
                    if (!info) return;
                    const defVal = ADV_DEFAULTS[info.key];
                    advSettings[info.key] = defVal;
                    setSliderValue(sliderId, defVal);
                    if (info.cfg) CFG[info.cfg] = defVal;
                    if (info.cfgFn) info.cfgFn(defVal);
                    if (info.recolor) updateAdvColors();
                    if (info.redraw) markBasemapDirty();
                });
                return;
            }
            // Toggle reset (e.g. grid visibility)
            const defKey = label.dataset.defaultKey;
            if (defKey && ADV_DEFAULTS[defKey] !== undefined) {
                label.addEventListener('click', () => {
                    advSettings[defKey] = ADV_DEFAULTS[defKey];
                    // Sync the checkbox if there's a matching one
                    const cb = panel.querySelector('#adv-grid-visible');
                    if (defKey === 'gridVisible' && cb) cb.checked = ADV_DEFAULTS[defKey];
                    if (defKey === 'gridVisible') markBasemapDirty();
                });
            }
        });
    }

    /** Position advanced panel in viewport, anchored top-right */
    function positionAdvPanel() {
        if (!advPanelEl) return;
        const pad = 12;
        const panelW = 310;
        // Default: top-right area, below topbar
        let left = window.innerWidth - panelW - pad;
        let top = 56;
        // Ensure it stays on screen
        left = Math.max(pad, Math.min(left, window.innerWidth - panelW - pad));
        top = Math.max(pad, top);
        advPanelEl.style.left = left + 'px';
        advPanelEl.style.top = top + 'px';
    }

    /** Make the panel draggable by its titlebar */
    function initAdvDrag() {
        const titlebar = document.getElementById('adv-titlebar');
        if (!titlebar) return;
        let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;

        titlebar.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('adv-close')) return;
            dragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startLeft = parseInt(advPanelEl.style.left) || 0;
            startTop  = parseInt(advPanelEl.style.top) || 0;
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            let nx = startLeft + (e.clientX - startX);
            let ny = startTop  + (e.clientY - startY);
            // Clamp within viewport
            const pw = advPanelEl.offsetWidth;
            const ph = advPanelEl.offsetHeight;
            nx = Math.max(0, Math.min(nx, window.innerWidth - pw));
            ny = Math.max(0, Math.min(ny, window.innerHeight - ph));
            advPanelEl.style.left = nx + 'px';
            advPanelEl.style.top  = ny + 'px';
        });

        window.addEventListener('mouseup', () => { dragging = false; });
    }

    function closeAdvancedPanel() {
        if (advPanelEl) { advPanelEl.remove(); advPanelEl = null; }
    }

    /** Sync ocean preset chip active states + slider range with current advSettings */
    function syncOceanPresetUI() {
        const orig = document.getElementById('adv-ocean-original');
        const lb = document.getElementById('adv-ocean-lightblue');
        if (orig) orig.classList.toggle('active', !advSettings.oceanLightBlue);
        if (lb) lb.classList.toggle('active', !!advSettings.oceanLightBlue);

        // Change hue slider range: Light Blue = 190-230 (blue only), Original = 0-360
        const hueSlider = document.getElementById('adv-ocean-hue');
        if (hueSlider) {
            if (advSettings.oceanLightBlue) {
                hueSlider.min = 190;
                hueSlider.max = 230;
                hueSlider.classList.remove('hue-slider');
                hueSlider.classList.add('blue-hue-slider');
            } else {
                hueSlider.min = 0;
                hueSlider.max = 360;
                hueSlider.classList.remove('blue-hue-slider');
                hueSlider.classList.add('hue-slider');
            }
        }
    }

    function showAdvFeedback(msg) {
        const el = document.getElementById('adv-feedback');
        if (!el) return;
        el.textContent = msg;
        el.style.opacity = '1';
        clearTimeout(el._timer);
        el._timer = setTimeout(() => { el.style.opacity = '0'; }, 2000);
    }

    // ═══════════════════════════════════════════════════════════
    // [AS-DISTRIBUTION] — Module initialization (always-on, no toggle)
    // ═══════════════════════════════════════════════════════════

    function initAsDistribution() {
        if (!window.ASDistribution) return;

        const ASD = window.ASDistribution;
        ASD.init();

        // Apply initial "Display Top ISP/Net" toggle state
        if (!advSettings.showDonutLegends) {
            const asCont = document.getElementById('as-distribution-container');
            if (asCont) asCont.classList.add('legends-hidden');
            const pnMiniLegend = document.getElementById('pn-mini-legend');
            if (pnMiniLegend) pnMiniLegend.style.display = 'none';
            ASD.setLegendsHidden(true);
        }

        // Provide integration hooks
        ASD.setHooks({
            drawLinesForAs: function (asNum, peerIds, color) {
                asLineGroups = null; // clear multi-group mode
                asLinePeerIds = peerIds;
                asLineColor = color;
                asLineAsNum = asNum;
            },
            drawLinesForAllAs: function (groups) {
                // groups = [{asNum, peerIds, color}, ...]
                asLinePeerIds = null;
                asLineColor = null;
                asLineAsNum = null;
                asLineGroups = groups;
            },
            clearAsLines: function () {
                asLinePeerIds = null;
                asLineColor = null;
                asLineAsNum = null;
                asLineGroups = null;
            },
            filterPeerTable: function (peerIds) {
                asFilterPeerIds = peerIds ? new Set(peerIds) : null;
                renderPeerTable();
            },
            dimMapPeers: function (peerIds) {
                asFilterPeerIds = peerIds ? new Set(peerIds) : null;
            },
            zoomToPeerOnly: function (peerId) {
                // Zoom to peer without touching sub-panels or lines — just zoom + highlight
                const node = nodes.find(n => n.peerId === peerId && n.alive);
                if (!node) return;
                // Draw line from the peer's AS legend dot to this peer
                const ASD = window.ASDistribution;
                if (ASD && node.peerId !== undefined) {
                    const peer = lastPeers.find(p => p.id === peerId);
                    if (peer && peer.as) {
                        const asMatch = peer.as.match(/^(AS\d+)/);
                        const peerAsNum = asMatch ? asMatch[1] : peer.as;
                        const color = ASD.getColorForAs(peerAsNum) || '#58a6ff';
                        asLineGroups = null;
                        asLinePeerIds = [peerId];
                        asLineColor = color;
                        asLineAsNum = peerAsNum;
                    }
                }
                // Zoom to peer but suppress the small map tooltip (big popup handles it)
                const p = project(node.lon, node.lat);
                const topbarH2 = 40;
                const panelH2 = panelEl.classList.contains('collapsed') ? 32 : 340;
                const visibleH2 = (H - panelH2) - topbarH2;
                const targetSY = topbarH2 + visibleH2 * 0.35;
                let z = 3;
                for (; z <= CFG.maxZoom; z += 0.2) {
                    const ofc = (H / 2 - targetSY) / z;
                    const cY = (p.y - 0.5) * H - ofc;
                    const mnY = (project(0, 85).y - 0.5) * H + H / (2 * z);
                    const mxY = (project(0, -85).y - 0.5) * H - H / (2 * z);
                    if (mnY < mxY && cY >= mnY && cY <= mxY) break;
                }
                z = Math.min(z, CFG.maxZoom);
                const ofc = (H / 2 - targetSY) / z;
                // Nudge peer slightly right of center so it's not behind the donut
                const xNudge = (W * 0.04) / z;
                view.x = (p.x - 0.5) * W - xNudge;
                view.y = 0;
                view.zoom = 1;
                targetView.x = (p.x - 0.5) * W - xNudge;
                targetView.y = (p.y - 0.5) * H - ofc;
                targetView.zoom = z;
                highlightedPeerId = node.peerId;
                pinnedNode = node;
                // Don't show the small map tooltip — the big peer popup is being used instead
                highlightTableRow(node.peerId);
            },
            resetMapZoom: function () {
                // Smoothly zoom the map back to default view
                targetView.x = 0;
                targetView.y = 0;
                targetView.zoom = 1;
                // Clear pinned node and tooltip
                pinnedNode = null;
                highlightedPeerId = null;
                hideTooltip();
                clearMapDotFilter();
            },
            clearPeerSelection: function () {
                // Clear selection state without resetting zoom
                pinnedNode = null;
                highlightedPeerId = null;
                hoveredNode = null;
                hideTooltip();
                clearMapDotFilter();
            },
            hideMapTooltip: function () {
                // Hide the map peer tooltip without changing zoom
                pinnedNode = null;
                hideTooltip();
            },
            enterPrivateNetMode: function (targetNet) {
                enterPrivateNetMode(null, targetNet || null);
            },
        });

        // Donut is always active — feed it initial data if available
        if (lastPeers.length > 0) {
            ASD.update(lastPeers);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // [AS-DISTRIBUTION] Peer panel + topbar button wiring
    // ═══════════════════════════════════════════════════════════

    function initNewButtons() {
        // NODE-INFO button in peer panel handle
        const nodeInfoPeerBtn = document.getElementById('btn-node-info-peer');
        if (nodeInfoPeerBtn) {
            nodeInfoPeerBtn.addEventListener('click', (e) => { e.stopPropagation(); openNodeInfoModal(); });
        }

        // BLOCKS button in peer panel handle
        const recentBlocksBtn = document.getElementById('btn-recent-blocks');
        if (recentBlocksBtn) {
            recentBlocksBtn.addEventListener('click', (e) => { e.stopPropagation(); openRecentBlocksModal(); });
        }

        // GEOIP-DB button in peer panel handle
        const geoipDbPeerButton = document.getElementById('btn-geoip-db-peer');
        if (geoipDbPeerButton) {
            geoipDbPeerButton.addEventListener('click', (e) => { e.stopPropagation(); openGeoDBDropdown(); });
        }

        // CHAIN-TIPS button in peer panel handle
        const chainTipsButton = document.getElementById('btn-chain-tips');
        if (chainTipsButton) {
            chainTipsButton.addEventListener('click', (e) => { e.stopPropagation(); openChainTipsModal(); });
        }

        // Topbar gear icon → open primary Map Settings popup
        const topbarGear = document.getElementById('topbar-gear');
        if (topbarGear) {
            topbarGear.addEventListener('click', (e) => {
                e.stopPropagation();
                openDisplaySettingsPopup(topbarGear);
            });
        }

        // Topbar countdown → open display settings
        const topbarCountdown = document.getElementById('topbar-countdown');
        if (topbarCountdown) {
            topbarCountdown.addEventListener('click', (e) => {
                e.stopPropagation();
                openDisplaySettingsPopup(topbarCountdown);
            });
        }

        // Topbar status message → open display settings
        const topbarStatusMsg = document.getElementById('mo-status-msg');
        if (topbarStatusMsg) {
            topbarStatusMsg.style.cursor = 'pointer';
            topbarStatusMsg.addEventListener('click', (e) => {
                e.stopPropagation();
                openDisplaySettingsPopup(topbarStatusMsg);
            });
        }

        // [PRIVATE-NET] Mini donut: hover → draw lines to private peers, click → enter private mode
        const pnMiniDonut = document.getElementById('pn-mini-donut');
        if (pnMiniDonut) {
            pnMiniDonut.addEventListener('click', (e) => {
                e.stopPropagation();
                enterPrivateNetMode();
            });
            pnMiniDonut.addEventListener('mouseenter', () => {
                if (!privateNetMode) pnMiniHover = true;
            });
            pnMiniDonut.addEventListener('mouseleave', () => {
                pnMiniHover = false;
                pnMiniHoverNet = null;
            });
        }

        // [PRIVATE-NET] Exit button on donut
        const pnExitBtn = document.getElementById('pn-exit-btn');
        if (pnExitBtn) {
            pnExitBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                exitPrivateNetMode();
            });
        }

        // [PRIVATE-NET] Donut center click → open overview panel
        const pnDonutCenterEl = document.getElementById('pn-donut-center');
        if (pnDonutCenterEl) {
            pnDonutCenterEl.style.pointerEvents = 'auto';
            pnDonutCenterEl.style.cursor = 'pointer';
            pnDonutCenterEl.addEventListener('click', (e) => {
                e.stopPropagation();
                // If a peer is selected, deselect it first
                if (privateNetSelectedPeer) {
                    privateNetSelectedPeer = null;
                    privateNetLinePeer = null;
                    pinnedNode = null;
                    highlightedPeerId = null;
                    closePnBigPopup();
                }
                // Move donut to center and open overview panel
                cachePnElements();
                if (pnContainerEl) pnContainerEl.classList.add('pn-focused');
                openPnOverviewPanel();
                updatePrivateNetUI();
            });
        }

        // [PRIVATE-NET] Detail panel close button → exit private mode entirely
        const pnDetailClose = document.getElementById('pn-detail-close');
        if (pnDetailClose) {
            pnDetailClose.addEventListener('click', (e) => {
                e.stopPropagation();
                exitPrivateNetMode();
            });
        }

        // [PRIVATE-NET] Detail panel back button → go back to overview
        const pnDetailBack = document.getElementById('pn-detail-back');
        if (pnDetailBack) {
            pnDetailBack.addEventListener('click', (e) => {
                e.stopPropagation();
                pnSelectedNet = null;
                hidePnSubTooltip();
                updatePnOverviewPanel();
                updatePrivateNetUI();
                // Show/hide back button
                pnDetailBack.classList.add('hidden');
            });
        }

        // [PRIVATE-NET] Double-click on canvas to exit private net mode
        canvas.addEventListener('dblclick', (e) => {
            if (privateNetMode) {
                e.preventDefault();
                e.stopPropagation();
                exitPrivateNetMode();
            }
        });

    }

    // ═══════════════════════════════════════════════════════════
    // INIT — Start everything
    // ═══════════════════════════════════════════════════════════

    function init() {
        // Capture dark theme CSS defaults before any overrides
        captureDarkDefaults();

        // Load any saved advanced display settings from localStorage
        loadAdvSettings();

        // Load and apply saved theme (or stay on dark default)
        loadTheme();

        // Restore table layout preferences before peer rows render.
        loadTableDisplaySettings();
        applyPanelOpacity();
        updateAutoFitBtn();
        renderPeerTableHead();
        renderPeerTable();

        // Setup canvas size and DPI scaling
        resize();
        window.addEventListener('resize', resize);

        // Load the layers visible at the initial zoom. More detailed geography is
        // fetched shortly before its zoom threshold is reached.
        loadWorldGeometry();
        loadLakeGeometry();
        loadBorderGeometry();
        loadCountryLabels();

        // Fetch real peer data immediately, then poll every 10s
        lastPeerFetchTime = Date.now();
        fetchPeers();
        peerPollTimer = setInterval(fetchPeers, CFG.pollInterval);
        startCountdownTimer();

        // Fetch node info (block height, BTC price, etc) immediately, then poll.
        // Once the first fetch resolves, start the DB auto-update timer if enabled.
        fetchInfo().then(() => syncDbAutoUpdateTimer());
        btcPriceTimer = setInterval(fetchInfo, CFG.infoPollInterval);

        // System stats + NET speed: real-time SSE stream (dual-EMA smoothed, ~250ms updates)
        connectSystemStream();

        // Still fetch full system stats once for modal data (uptime, load, disk)
        fetchSystemStats();
        // Re-fetch full stats every 30s for modal freshness (uptime, load, disk only)
        setInterval(fetchSystemStats, 30000);

        showAntarcticaDisclaimerOnce();

        // Start the render loop (grid + nodes render immediately,
        // landmasses + lakes appear once JSON assets finish loading)
        requestAnimationFrame(frame);

        updateClock();
        setInterval(updateClock, 1000);

        // [AS-DISTRIBUTION] Initialize AS Distribution module (always-on donut)
        initAsDistribution();

        // [AS-DISTRIBUTION] Wire up new peer panel buttons and topbar gear
        initNewButtons();

        // Apply default visible row count to peer panel
        applyMaxPeerRows();
    }

    init();

})();
