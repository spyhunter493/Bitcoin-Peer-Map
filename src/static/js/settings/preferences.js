import { queryAll, required } from '../core/dom.js';
import * as BPMModal from '../core/modal.js';
import * as BPMWorldMap from '../map/geometry.js';
import * as BPMDistribution from '../distribution/controller.js';
import * as BPMDisplaySettings from './advanced.js';
/**
 * @param {{config: import('../types').DashboardConfig; onAction: (type: 'theme' | 'map-style' | 'intervals' | 'peer-interval' | 'private-show' | 'private-hide') => void}} options
 */
function create({ config: CFG, onAction }) {
    const escapeHtml = BPMModal.escapeHtml;
    const clamp = BPMWorldMap.clamp;
    const repositoryDiscussionsUrl = document.body.dataset.repositoryUrl + '/discussions';
    const ADV_DEFAULTS = {
        // Peer effects (defaults = original values before shimmer was added)
        shimmerStrength: 0.09, // subtle ambient twinkle
        pulseDepthIn: 0.4, // inbound pulse amplitude
        pulseDepthOut: 0.48, // outbound pulse amplitude
        pulseSpeedIn: 50, // slider 0-100, 50 = original speed
        pulseSpeedOut: 50, // slider 0-100, 50 = original speed
        // AS Distribution line settings
        asLineWidth: 40, // slider 0-100, 40 = ~1.8px (default — visible)
        asLineFan: 50, // slider 0-100, 50 = 35% spread (default)
        // Land appearance
        landHue: 215, // hue degrees (current dark blue-gray)
        landBright: 50, // slider 0-100, 50 = original L=12%
        snowPoles: 0, // slider 0-100, 0 = off, 100 = full ice
        // Ocean appearance
        oceanHue: 220, // hue degrees (current near-black blue)
        oceanBright: 50, // slider 0-100, 50 = original L=3.5%
        oceanLightBlue: false, // light blue preset active
        // Grid lines
        gridVisible: true,
        gridThickness: 50, // slider 0-100, 50 = default 0.5 lineWidth
        gridHue: 212, // hue degrees (accent blue)
        gridBright: 50, // slider 0-100, 50 = default alpha 0.04
        // Borders
        borderScale: 50, // slider 0-100, 50 = current size; scales country+state borders
        borderHue: 212, // hue degrees (accent blue, matches grid default)
        // HUD overlay backgrounds
        hudSolidBg: false, // when true, HUD overlays get semi-opaque backgrounds
        // Donut legend display
        showDonutLegends: false, // when true, top-8 ISP and network lists animate on donut hover
    };

    /** @type {Record<string, import('../types').Theme>} */
    const THEMES = {
        dark: {
            label: 'Dark',
            dot: '#0a0e14',
            desc: 'The original dark canvas dashboard. Ideal for low-light environments.',
            cssVars: {}, // empty = CSS defaults (the dark theme IS the default)
            advOverrides: {},
            nodeHighlight: { r: 255, g: 255, b: 255 },
            netColors: null, // null = use default NET_COLORS
        },
        light: {
            label: 'Light',
            dot: '#e4e8ec',
            desc: 'Bright, clean interface with green land and blue ocean. Best for well-lit rooms.',
            cssVars: {
                '--bg-void': '#e4e8ec',
                '--bg-deep': '#edf0f4',
                '--bg-surface': '#ffffff',
                '--bg-raised': '#f4f6f8',
                '--surface-overlay-rgb': '240, 242, 248',
                '--bg-surface-rgb': '255, 255, 255',
                '--text-primary': '#1a1f36',
                '--text-secondary': '#4a5568',
                '--text-muted': '#718096',
                '--text-dim': '#a0aec0',
                '--accent': '#2563eb',
                '--accent-dim': '#93b4f5',
                '--accent-glow': 'rgba(37, 99, 235, 0.20)',
                '--net-ipv4': '#a67c00',
                '--net-ipv6': '#c2343f',
                '--net-tor': '#0d47a1',
                '--net-i2p': '#6d28d9',
                '--net-cjdns': '#7e22ce',
                '--net-unknown': '#718096',
                '--ok': '#16a34a',
                '--ok-bright': '#15803d',
                '--warn': '#b45309',
                '--err': '#dc2626',
                '--err-bright': '#b91c1c',
                '--map-land': '#c8d5c0',
                '--map-border': '#8a9bb0',
                '--map-grid': 'rgba(37, 99, 235, 0.08)',
                '--title-accent': '#9a7b1a',
                '--section-color': '#5a6570',
                '--logo-primary': '#2b5ea0',
                '--logo-accent': '#1a7a9e',
                '--peer-panel-bg': 'rgba(255, 255, 255, 0.95)',
                '--peer-panel-blur': 'none',
            },
            advOverrides: {
                landHue: 120,
                landBright: 82,
                oceanHue: 210, // center of light-blue range (190-230)
                oceanBright: 50, // midpoint = soft sky blue
                gridHue: 220,
                gridBright: 45,
                borderHue: 215,
                snowPoles: 94,
            },
            oceanLightBlue: true, // light blue ocean preset enabled by default
            hudSolidBg: true, // solid HUD backgrounds for readability on light ocean
            nodeHighlight: { r: 30, g: 30, b: 30 },
            netColors: {
                ipv4: { r: 166, g: 124, b: 0 },
                ipv6: { r: 194, g: 52, b: 63 },
                onion: { r: 13, g: 71, b: 161 },
                i2p: { r: 109, g: 40, b: 217 },
                cjdns: { r: 126, g: 34, b: 206 },
            },
            netColorUnknown: { r: 100, g: 110, b: 130 },
        },
        oled: {
            label: 'OLED',
            dot: '#000000',
            desc: 'Pure black for OLED screens. Maximum contrast, minimum power draw.',
            cssVars: {
                '--bg-void': '#000000',
                '--bg-deep': '#030303',
                '--bg-surface': '#0a0a0a',
                '--bg-raised': '#111111',
                '--surface-overlay-rgb': '0, 0, 0',
                '--bg-surface-rgb': '10, 10, 10',
                '--map-land': '#0a0a0a',
                '--map-border': '#1a1a1a',
                '--map-grid': 'rgba(88, 166, 255, 0.025)',
            },
            advOverrides: {
                landHue: 0,
                landBright: 18,
                oceanHue: 0,
                oceanBright: 5,
                gridBright: 35,
            },
            nodeHighlight: { r: 255, g: 255, b: 255 },
            netColors: null,
        },
        midnight: {
            label: 'Midnight',
            dot: '#111b38',
            desc: 'Deep indigo-blue tones with purple accents. Rich and atmospheric.',
            cssVars: {
                '--bg-void': '#060b1a',
                '--bg-deep': '#0b1226',
                '--bg-surface': '#111b38',
                '--bg-raised': '#192448',
                '--surface-overlay-rgb': '8, 14, 32',
                '--bg-surface-rgb': '17, 27, 56',
                '--text-primary': '#d0dbf0',
                '--text-secondary': '#7e90b8',
                '--text-muted': '#566988',
                '--text-dim': '#3a4d6e',
                '--accent': '#818cf8',
                '--accent-dim': '#4f46e5',
                '--accent-glow': 'rgba(129, 140, 248, 0.30)',
                '--net-ipv4': '#fbbf24',
                '--net-ipv6': '#fb7185',
                '--net-tor': '#2979ff',
                '--net-i2p': '#a78bfa',
                '--net-cjdns': '#c4b5fd',
                '--net-unknown': '#566988',
                '--ok': '#34d399',
                '--ok-bright': '#6ee7b7',
                '--warn': '#fbbf24',
                '--err': '#f87171',
                '--err-bright': '#fca5a5',
                '--map-land': '#111b38',
                '--map-border': '#283a60',
                '--map-grid': 'rgba(129, 140, 248, 0.04)',
                '--title-accent': '#c9a83e',
                '--section-color': '#7e90b8',
                '--logo-primary': '#818cf8',
                '--logo-accent': '#a5b4fc',
            },
            advOverrides: {
                landHue: 230,
                landBright: 45,
                oceanHue: 235,
                oceanBright: 38,
                gridHue: 245,
                gridBright: 48,
                borderHue: 240,
            },
            nodeHighlight: { r: 255, g: 255, b: 255 },
            netColors: {
                ipv4: { r: 251, g: 191, b: 36 },
                ipv6: { r: 251, g: 113, b: 133 },
                onion: { r: 41, g: 121, b: 255 },
                i2p: { r: 167, g: 139, b: 250 },
                cjdns: { r: 196, g: 181, b: 253 },
            },
            netColorUnknown: null,
        },
    };

    let currentTheme = 'dark';

    let nodeHighlightColor = { r: 255, g: 255, b: 255 };

    const canvasLabelColors = {
        countryShadow: '6,8,12', // dark shadow behind country names
        countryText: '200,210,225', // country name fill
        stateText: '140,160,190', // state/province name fill
        cityDot: '212,218,228', // city marker dot
        cityText: '212,218,228', // city name fill
    };

    const CANVAS_LABEL_DARK = {
        countryShadow: '6,8,12',
        countryText: '200,210,225',
        stateText: '140,160,190',
        cityDot: '212,218,228',
        cityText: '212,218,228',
    };

    const CANVAS_LABEL_LIGHT = {
        countryShadow: '255,255,255',
        countryText: '40,50,65',
        stateText: '70,80,100',
        cityDot: '50,55,65',
        cityText: '50,55,65',
    };

    const CANVAS_LABEL_MIDNIGHT = {
        countryShadow: '6,10,25',
        countryText: '160,175,210',
        stateText: '120,140,175',
        cityDot: '170,180,200',
        cityText: '170,180,200',
    };

    /** @type {Record<string, string>} */
    const DARK_CSS_VARS = {};

    /**
     * @param {string} themeName
     * @param {{preserveAdvSettings?: boolean}} [opts]
     */
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
        Object.assign(nodeHighlightColor, theme.nodeHighlight || { r: 255, g: 255, b: 255 });

        // 3b. Update canvas text label colours
        /** @type {Record<string, typeof CANVAS_LABEL_DARK>} */
        const labelMap = { light: CANVAS_LABEL_LIGHT, midnight: CANVAS_LABEL_MIDNIGHT };
        const labelSet = labelMap[themeName] || CANVAS_LABEL_DARK;
        Object.assign(canvasLabelColors, labelSet);

        // 4. Apply map appearance overrides to advSettings
        //    Skip when preserveAdvSettings is set (init with saved settings — don't
        //    let the theme stomp over the user's permanently saved slider values).
        if (!(opts && opts.preserveAdvSettings)) {
            /** @type {import('../types').NumericSetting[]} */
            const mapKeys = [
                'landHue',
                'landBright',
                'oceanHue',
                'oceanBright',
                'gridHue',
                'gridBright',
                'borderHue',
                'gridThickness',
                'borderScale',
                'snowPoles',
            ];
            for (const k of mapKeys) {
                advSettings[k] = theme.advOverrides[k] !== undefined ? theme.advOverrides[k] : ADV_DEFAULTS[k];
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
            NET_COLORS.ipv4 = { r: 227, g: 179, b: 65 };
            NET_COLORS.ipv6 = { r: 240, g: 113, b: 120 };
            NET_COLORS.onion = { r: 74, g: 158, b: 255 };
            NET_COLORS.i2p = { r: 139, g: 92, b: 246 };
            NET_COLORS.cjdns = { r: 210, g: 168, b: 255 };
        }
        if (theme.netColorUnknown) {
            NET_COLOR_UNKNOWN.r = theme.netColorUnknown.r;
            NET_COLOR_UNKNOWN.g = theme.netColorUnknown.g;
            NET_COLOR_UNKNOWN.b = theme.netColorUnknown.b;
        } else {
            NET_COLOR_UNKNOWN.r = 120;
            NET_COLOR_UNKNOWN.g = 130;
            NET_COLOR_UNKNOWN.b = 140;
        }

        // 6. Re-colour existing nodes to match new theme NET_COLORS
        onAction('theme');

        // 7. Refresh advanced panel if open
        if (advancedDisplaySettings) {
            advancedDisplaySettings.refreshTheme(themeName, theme.label);
        }
    }

    function captureDarkDefaults() {
        const style = getComputedStyle(document.documentElement);
        const varsToCapture = [
            '--bg-void',
            '--bg-deep',
            '--bg-surface',
            '--bg-raised',
            '--surface-overlay-rgb',
            '--bg-surface-rgb',
            '--text-primary',
            '--text-secondary',
            '--text-muted',
            '--text-dim',
            '--accent',
            '--accent-dim',
            '--accent-glow',
            '--net-ipv4',
            '--net-ipv6',
            '--net-tor',
            '--net-i2p',
            '--net-cjdns',
            '--net-unknown',
            '--ok',
            '--ok-bright',
            '--warn',
            '--err',
            '--err-bright',
            '--map-land',
            '--map-border',
            '--map-grid',
            '--title-accent',
            '--section-color',
            '--logo-primary',
            '--logo-accent',
            '--peer-panel-bg',
            '--peer-panel-blur',
        ];
        for (const v of varsToCapture) {
            DARK_CSS_VARS[v] = style.getPropertyValue(v).trim();
        }
    }

    function saveTheme() {
        try {
            localStorage.setItem('bpm.theme', currentTheme);
        } catch (e) {
            /* ignore */
        }
    }

    function loadTheme() {
        try {
            const saved = localStorage.getItem('bpm.theme');
            if (saved && THEMES[saved]) {
                const savedDisplay = readSavedDisplaySettings();
                const hasSavedAdv = Object.keys(ADV_DEFAULTS).some((k) => Object.hasOwn(savedDisplay, k));
                applyTheme(saved, hasSavedAdv ? { preserveAdvSettings: true } : undefined);
            }
        } catch (e) {
            /* ignore */
        }
    }

    const advSettings = Object.assign({}, ADV_DEFAULTS);

    const advColors = {
        landFill: '#151d28',
        landStroke: '#253040',
        iceFill: 'hsl(210, 15%, 82%)',
        iceStroke: 'hsl(210, 12%, 65%)',
        oceanFill: '#06080c',
        lakeFill: '#06080c',
        lakeStroke: '#1a2230',
        gridColor: 'rgba(88,166,255,0.04)',
        gridWidth: 0.5,
        borderRGB: '88,166,255', // border colour as r,g,b for rgba()
    };

    /**
     * @param {number} slider
     * @param {number} defaultL
     */
    function brightnessToL(slider, defaultL) {
        return defaultL * Math.pow(2, (slider - 50) / 25);
    }

    function updateAdvColors() {
        // Land
        const ll = Math.max(0.5, Math.min(60, brightnessToL(advSettings.landBright, 12)));
        advColors.landFill = 'hsl(' + advSettings.landHue + ', 31%, ' + ll.toFixed(1) + '%)';
        advColors.landStroke = 'hsl(' + advSettings.landHue + ', 25%, ' + Math.min(70, ll + 8).toFixed(1) + '%)';

        // Ocean
        if (advSettings.oceanLightBlue) {
            // Light Blue mode: soft sky-blue ocean
            // Hue is constrained to 190-230 by the slider, brightness 0-100 maps to L 75%→50%
            const lbHue = advSettings.oceanHue; // already in 190-230 range
            const lbL = 75 - (advSettings.oceanBright / 100) * 25; // 75% (pale) → 50% (medium)
            const lbS = 48 + (advSettings.oceanBright / 100) * 12; // 48-60% saturation
            advColors.oceanFill = 'hsl(' + lbHue + ', ' + lbS.toFixed(1) + '%, ' + lbL.toFixed(1) + '%)';
            advColors.lakeFill = advColors.oceanFill;
            advColors.lakeStroke =
                'hsl(' + lbHue + ', ' + Math.max(30, lbS - 10).toFixed(1) + '%, ' + Math.max(40, lbL - 8).toFixed(1) + '%)';
        } else {
            // Original mode: near-black ocean with full hue range
            const ol = Math.max(0.2, Math.min(30, brightnessToL(advSettings.oceanBright, 3.5)));
            advColors.oceanFill = 'hsl(' + advSettings.oceanHue + ', 33%, ' + ol.toFixed(1) + '%)';
            advColors.lakeFill = advColors.oceanFill;
            advColors.lakeStroke = 'hsl(' + advSettings.oceanHue + ', 25%, ' + Math.min(40, ol + 10).toFixed(1) + '%)';
        }
        // Grid — alpha range: 0.005 (slider=0) to 0.04 (slider=50) to 0.35 (slider=100)
        const ga = Math.min(0.5, 0.04 * Math.pow(2, (advSettings.gridBright - 50) / 18));
        advColors.gridColor = 'hsla(' + advSettings.gridHue + ', 100%, 67%, ' + ga.toFixed(4) + ')';
        advColors.gridWidth = 0.2 + (advSettings.gridThickness / 100) * 1.8;

        // Borders — convert hue to r,g,b at S=100%, L=67% (same as accent blue default)
        advColors.borderRGB = hslToRgbStr(advSettings.borderHue, 100, 67);

        // Ice (constant cool gray)
        advColors.iceFill = 'hsl(210, 15%, 82%)';
        advColors.iceStroke = 'hsl(210, 12%, 65%)';

        onAction('map-style');
    }

    function applyHudSolidBg() {
        document.body.classList.toggle('hud-solid', !!advSettings.hudSolidBg);
    }

    /**
     * @param {number} h
     * @param {number} s
     * @param {number} l
     */
    function hslToRgbStr(h, s, l) {
        s /= 100;
        l /= 100;
        const a = s * Math.min(l, 1 - l);
        /** @param {number} n */
        const f = (n) => {
            const k = (n + h / 30) % 12;
            return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        };
        return Math.round(f(0) * 255) + ',' + Math.round(f(8) * 255) + ',' + Math.round(f(4) * 255);
    }

    /**
     * @returns {Partial<import('../types').AdvancedSettings & import('../types').TableDisplaySettings>}
     */
    function readSavedDisplaySettings() {
        try {
            const raw = localStorage.getItem('bpm.peerTable.display');
            if (raw) {
                const saved = JSON.parse(raw);
                if (saved && typeof saved === 'object' && !Array.isArray(saved)) return saved;
            }
        } catch (e) {
            /* ignore corrupt data */
        }
        return {};
    }

    /**
     * @param {Partial<import('../types').AdvancedSettings & import('../types').TableDisplaySettings>} settings
     */
    function writeSavedDisplaySettings(settings) {
        try {
            localStorage.setItem('bpm.peerTable.display', JSON.stringify(settings));
        } catch (e) {
            /* quota exceeded, silently fail */
        }
    }

    function loadAdvSettings() {
        const saved = readSavedDisplaySettings();
        /** @template {keyof typeof ADV_DEFAULTS} K @param {K} key */
        function restore(key) {
            const value = saved[key];
            if (value !== undefined && typeof value === typeof ADV_DEFAULTS[key]) advSettings[key] = value;
        }
        for (const key of /** @type {(keyof typeof ADV_DEFAULTS)[]} */ (Object.keys(ADV_DEFAULTS))) restore(key);
        // Always sync CFG from advSettings (whether loaded or defaults)
        CFG.shimmerStrength = advSettings.shimmerStrength;
        CFG.pulseDepthInbound = advSettings.pulseDepthIn;
        CFG.pulseDepthOutbound = advSettings.pulseDepthOut;
        CFG.pulseSpeedInbound = 0.0014 * Math.pow(2, (advSettings.pulseSpeedIn - 50) / 30);
        CFG.pulseSpeedOutbound = 0.0026 * Math.pow(2, (advSettings.pulseSpeedOut - 50) / 30);
        updateAdvColors();
    }

    function saveAdvSettings() {
        writeSavedDisplaySettings(Object.assign({}, readSavedDisplaySettings(), advSettings));
    }

    /** @type {Record<string, import('../types').RGB>} */
    const NET_COLORS = {
        ipv4: { r: 227, g: 179, b: 65 }, // gold
        ipv6: { r: 240, g: 113, b: 120 }, // coral
        onion: { r: 21, g: 101, b: 192 }, // dark blue (Tor)
        i2p: { r: 139, g: 92, b: 246 }, // purple
        cjdns: { r: 210, g: 168, b: 255 }, // lavender
    };

    const NET_COLOR_UNKNOWN = { r: 120, g: 130, b: 140 };

    /** @type {HTMLElement | null} */
    let displaySettingsEl = null;

    /**
     * @param {HTMLElement | null} [anchorEl]
     */
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
        visItems.forEach((item) => {
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
        visItems.forEach((item) => {
            html += `<div class="dsp-row"><span class="dsp-label">${item.label}</span><label class="dsp-toggle"><input type="checkbox" data-vis-target="${item.id}" ${item.visible ? 'checked' : ''}><span class="dsp-toggle-slider"></span></label></div>`;
        });
        html += `<div class="dsp-row"><span class="dsp-label" title="Animate donuts to display top 8 ISP or anonymous networks on hover">Display Top ISP/Net</span><label class="dsp-toggle"><input type="checkbox" id="dsp-donut-legends" ${advSettings.showDonutLegends ? 'checked' : ''}><span class="dsp-toggle-slider"></span></label></div>`;
        html += '<button class="dsp-advanced-btn" id="dsp-advanced-btn">Advanced &#9881;</button>';
        html += `<a class="dsp-feedback-link" href="${escapeHtml(repositoryDiscussionsUrl)}" target="_blank" rel="noopener" title="Open the project discussions">Suggestions &amp; Bug Reports &#8599;</a>`;
        popup.innerHTML = html;
        document.body.appendChild(popup);
        displaySettingsEl = popup;

        // Bind Advanced button
        const advBtn = document.getElementById('dsp-advanced-btn');
        if (advBtn) {
            advBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeDisplaySettingsPopup();
                openAdvancedPanel(anchorEl);
            });
        }

        // Position near anchor
        if (anchorEl) {
            const rect = anchorEl.getBoundingClientRect();
            popup.style.right = window.innerWidth - rect.right + 'px';
            popup.style.top = rect.bottom + 6 + 'px';
        }

        // Bind frequency inputs — restart active timers so new interval takes effect
        /** @type {HTMLInputElement} */
        const pollInput = required('#dsp-poll-sec');
        if (pollInput) {
            pollInput.addEventListener('change', () => {
                const v = clamp(parseInt(pollInput.value) || 10, 3, 120);
                pollInput.value = String(v);
                CFG.pollInterval = v * 1000;
                // Restart the peer poll timer at the new interval
                onAction('intervals');
                // Restart countdown display so it uses the new interval
                onAction('peer-interval');
            });
        }
        /** @type {HTMLInputElement} */
        const infoInput = required('#dsp-info-sec');
        if (infoInput) {
            infoInput.addEventListener('change', () => {
                const v = clamp(parseInt(infoInput.value) || 15, 5, 120);
                infoInput.value = String(v);
                CFG.infoPollInterval = v * 1000;
                // Restart info poll timer at the new interval
                onAction('intervals');
            });
        }

        // Bind show/hide visibility toggles
        /** @type {HTMLInputElement[]} */ (queryAll('.dsp-toggle input[data-vis-target]', popup)).forEach((cb) => {
            cb.addEventListener('change', () => {
                const targetId = cb.dataset.visTarget || '';
                const target = document.getElementById(targetId);
                if (!target) return;
                if (cb.checked) {
                    target.style.display = '';
                    // For private donut, also re-render if it was hidden
                    if (targetId === 'pn-mini-donut') {
                        onAction('private-show');
                    }
                } else {
                    target.style.display = 'none';
                    // If hiding public donut, deselect any active AS
                    if (targetId === 'as-distribution-container' && BPMDistribution && BPMDistribution.getSelectedAs()) {
                        BPMDistribution.deselect();
                    }
                    // If hiding private donut, exit private mode if active
                    if (targetId === 'pn-mini-donut') {
                        onAction('private-hide');
                    }
                }
            });
        });

        // Bind Display Top ISP/Net toggle
        /** @type {HTMLInputElement} */
        const donutLegendsInput = required('#dsp-donut-legends');
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
                if (BPMDistribution && BPMDistribution.setLegendsHidden) {
                    BPMDistribution.setLegendsHidden(!advSettings.showDonutLegends);
                }
            });
        }

        // Close on outside click
        setTimeout(() => {
            document.addEventListener('click', closeDisplaySettingsOnOutside);
        }, 0);
    }

    /** @param {MouseEvent} e */
    function closeDisplaySettingsOnOutside(e) {
        if (!(e.target instanceof Node)) return;
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

    const advancedDisplaySettings = BPMDisplaySettings.create({
        settings: advSettings,
        defaults: ADV_DEFAULTS,
        themes: THEMES,
        config: CFG,
        getCurrentTheme: () => currentTheme,
        applyTheme,
        saveSettings: saveAdvSettings,
        saveTheme,
        updateColors: updateAdvColors,
        markMapDirty: () => onAction('map-style'),
        applyHud: applyHudSolidBg,
    });

    /**
     * @param {HTMLElement | null} [returnFocus]
     */
    function openAdvancedPanel(returnFocus) {
        advancedDisplaySettings.open(returnFocus);
    }
    return Object.freeze({
        advSettings,
        advColors,
        canvasLabelColors,
        nodeHighlightColor,
        NET_COLORS,
        NET_COLOR_UNKNOWN,
        readSavedDisplaySettings,
        writeSavedDisplaySettings,
        saveAdvSettings,
        openDisplaySettingsPopup,
        closeDisplaySettingsPopup,
        init() {
            captureDarkDefaults();
            loadAdvSettings();
            loadTheme();
        },
        dispose() {
            closeDisplaySettingsPopup();
            advancedDisplaySettings.close();
        },
    });
}
export { create };
