const ANTARCTICA_STATIONS = Object.freeze([
    { lat: -67.602, lon: 62.873 },
    { lat: -68.576, lon: 77.967 },
    { lat: -66.281, lon: 110.528 },
    { lat: -66.663, lon: 140.001 },
    { lat: -69.005, lon: 39.58 },
    { lat: -70.667, lon: 11.633 },
    { lat: -70.75, lon: -8.25 },
    { lat: -70.45, lon: -2.842 },
]);

const FALLBACK_WORLD_POLYGONS = [
    [
        [
            [-130, 50],
            [-125, 60],
            [-115, 68],
            [-95, 72],
            [-80, 72],
            [-65, 62],
            [-55, 50],
            [-60, 45],
            [-68, 44],
            [-75, 38],
            [-82, 30],
            [-90, 28],
            [-97, 26],
            [-105, 30],
            [-118, 34],
            [-125, 42],
            [-130, 50],
        ],
    ],
    [
        [
            [-80, 10],
            [-75, 12],
            [-63, 10],
            [-52, 4],
            [-42, 0],
            [-35, -5],
            [-35, -12],
            [-38, -18],
            [-42, -22],
            [-48, -28],
            [-52, -33],
            [-58, -38],
            [-65, -45],
            [-68, -53],
            [-72, -48],
            [-75, -42],
            [-72, -35],
            [-68, -28],
            [-70, -18],
            [-75, -10],
            [-80, 0],
            [-80, 10],
        ],
    ],
    [
        [
            [-10, 36],
            [0, 38],
            [3, 42],
            [5, 44],
            [2, 48],
            [-5, 48],
            [-8, 54],
            [-5, 58],
            [5, 62],
            [12, 58],
            [18, 55],
            [24, 58],
            [30, 60],
            [35, 58],
            [42, 55],
            [45, 50],
            [40, 45],
            [35, 40],
            [28, 36],
            [20, 36],
            [12, 38],
            [5, 38],
            [0, 36],
            [-10, 36],
        ],
    ],
    [
        [
            [-15, 12],
            [-17, 15],
            [-12, 25],
            [-5, 35],
            [0, 36],
            [10, 37],
            [12, 32],
            [20, 32],
            [25, 30],
            [32, 32],
            [35, 30],
            [42, 12],
            [50, 2],
            [42, -5],
            [40, -12],
            [35, -22],
            [30, -30],
            [22, -34],
            [18, -34],
            [15, -28],
            [12, -18],
            [8, -5],
            [5, 5],
            [0, 6],
            [-8, 5],
            [-15, 12],
        ],
    ],
    [
        [
            [28, 36],
            [35, 40],
            [42, 48],
            [50, 50],
            [55, 55],
            [60, 60],
            [65, 68],
            [75, 72],
            [90, 72],
            [100, 68],
            [115, 65],
            [125, 60],
            [130, 55],
            [140, 55],
            [145, 50],
            [142, 44],
            [135, 38],
            [128, 34],
            [122, 30],
            [115, 24],
            [108, 18],
            [105, 12],
            [100, 5],
            [98, 8],
            [95, 15],
            [88, 22],
            [80, 28],
            [72, 32],
            [60, 38],
            [50, 40],
            [42, 45],
            [35, 40],
            [28, 36],
        ],
    ],
    [
        [
            [115, -15],
            [120, -14],
            [130, -12],
            [135, -14],
            [140, -16],
            [148, -20],
            [152, -25],
            [153, -28],
            [150, -33],
            [145, -38],
            [137, -35],
            [130, -32],
            [122, -33],
            [116, -32],
            [114, -28],
            [114, -22],
            [118, -20],
            [120, -18],
            [115, -15],
        ],
    ],
];

/** @param {number} lon
 * @param {number} lat */
function project(lon, lat) {
    const x = (lon + 180) / 360;
    const latRad = (lat * Math.PI) / 180;
    const mercator = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
    return { x, y: 0.5 - mercator / (2 * Math.PI) };
}

/** @param {number} lon
 * @param {number} lat
 * @param {number} width
 * @param {number} height
 * @param {import('../types').Camera} view */
function worldToScreen(lon, lat, width, height, view) {
    const point = project(lon, lat);
    return {
        x: (point.x - 0.5) * width * view.zoom + width / 2 - view.x * view.zoom,
        y: (point.y - 0.5) * height * view.zoom + height / 2 - view.y * view.zoom,
    };
}

/** @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {import('../types').Camera} view */
function screenToWorld(x, y, width, height, view) {
    const projectedX = (x - width / 2 + view.x * view.zoom) / (width * view.zoom) + 0.5;
    const projectedY = (y - height / 2 + view.y * view.zoom) / (height * view.zoom) + 0.5;
    const mercator = (0.5 - projectedY) * 2 * Math.PI;
    return {
        lon: projectedX * 360 - 180,
        lat: ((2 * Math.atan(Math.exp(mercator)) - Math.PI / 2) * 180) / Math.PI,
    };
}

/** @param {import('../types').RGB} color
 * @param {number} alpha */
function rgba(color, alpha) {
    return `rgba(${color.r},${color.g},${color.b},${alpha})`;
}

/** @param {number} start
 * @param {number} end
 * @param {number} amount */
function lerp(start, end, amount) {
    return start + (end - start) * amount;
}

/** @param {number} value
 * @param {number} minimum
 * @param {number} maximum */
function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

/** @param {string} value */
function hashString(value) {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
        hash = (hash << 5) - hash + value.charCodeAt(index);
        hash &= hash;
    }
    return hash;
}

function createAntarcticaLocator(stations = ANTARCTICA_STATIONS) {
    /** @type {Map<string, {lat: number; lon: number}>} */
    const positions = new Map();
    /** @param {string | undefined} address */
    return function locate(address) {
        const key = String(address || 'unknown');
        const cached = positions.get(key);
        if (cached) return cached;
        const stationHash = hashString(key);
        const offsetHash = hashString(key + '_offset');
        const station = stations[Math.abs(stationHash) % stations.length];
        const position = Object.freeze({
            lat: station.lat + ((Math.abs(offsetHash) % 100) / 100 - 0.5),
            lon: station.lon + ((Math.abs(offsetHash >> 8) % 100) / 100 - 0.5),
        });
        positions.set(key, position);
        return position;
    };
}

/**
 * @param {import('../types').GeometryLoaderOptions} options
 */
function createDataLoader(options) {
    const fetchJson = options.fetchJson;
    const thresholds = options.thresholds || {};
    const callbacks = options.callbacks || {};
    const logger = options.logger || globalThis.console || { log() {}, warn() {}, error() {} };
    /** @type {Map<keyof import('../types').GeometryLayers, Promise<import('../types').GeometryLayers[keyof import('../types').GeometryLayers] | null>>} */
    const requests = new Map();

    /** @template {keyof import('../types').GeometryLayers} K
     * @param {K} key
     * @param {string} filename
     * @param {string} label
     * @param {import('../types').GeometryLayers[K]} [fallback]
     */
    function loadOnce(key, filename, label, fallback) {
        if (!requests.has(key)) {
            /** @type {Promise<import('../types').GeometryLayers[K]>} */
            const request = fetchJson(filename);
            const pending = request
                .then((data) => {
                    if (callbacks[key]) callbacks[key](data);
                    logger.log(`[Bitcoin Peer Map] Loaded ${data.length} ${label}`);
                    return data;
                })
                .catch((error) => {
                    if (fallback) {
                        if (callbacks[key]) callbacks[key](fallback);
                        logger.error('[Bitcoin Peer Map] Failed to load world geometry, using fallback:', error);
                        return fallback;
                    }
                    logger.warn(`[Bitcoin Peer Map] Failed to load ${label}:`, error);
                    return null;
                });
            requests.set(key, pending);
        }
        return /** @type {Promise<import('../types').GeometryLayers[K] | null>} */ (requests.get(key));
    }

    const loadWorld = () => loadOnce('world', 'world-50m.json', 'land polygons', FALLBACK_WORLD_POLYGONS);
    const loadLakes = () => loadOnce('lakes', 'lakes-50m.json', 'lake polygons');
    const loadBorders = () => loadOnce('borders', 'borders-50m.json', 'country border lines');
    const loadStates = () => loadOnce('states', 'states-50m.json', 'state/province border lines');
    const loadCities = () => loadOnce('cities', 'cities-50m.json', 'cities');
    const loadCountryLabels = () => loadOnce('countryLabels', 'country-labels-50m.json', 'country labels');
    const loadStateLabels = () => loadOnce('stateLabels', 'state-labels-50m.json', 'state/province labels');

    /** @param {number} zoom */
    function ensureZoomDetailLoaded(zoom) {
        if (zoom >= (thresholds.states ?? Infinity)) loadStates();
        if (zoom >= (thresholds.stateLabels ?? Infinity)) loadStateLabels();
        if (zoom >= (thresholds.cities ?? Infinity)) loadCities();
    }

    return Object.freeze({
        loadWorld,
        loadLakes,
        loadBorders,
        loadStates,
        loadCities,
        loadCountryLabels,
        loadStateLabels,
        ensureZoomDetailLoaded,
    });
}

export { project };
export { worldToScreen };
export { screenToWorld };
export { rgba };
export { lerp };
export { clamp };
export { hashString };
export { createAntarcticaLocator };
export { createDataLoader };
