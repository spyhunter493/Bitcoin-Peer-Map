/* Projection, stable private-peer placement, and progressive map-data loading. */
(function (global) {
    'use strict';

    const ANTARCTICA_STATIONS = Object.freeze([
        { lat: -67.6020, lon: 62.8730 },
        { lat: -68.5760, lon: 77.9670 },
        { lat: -66.2810, lon: 110.5280 },
        { lat: -66.6630, lon: 140.0010 },
        { lat: -69.0050, lon: 39.5800 },
        { lat: -70.6670, lon: 11.6330 },
        { lat: -70.7500, lon: -8.2500 },
        { lat: -70.4500, lon: -2.8420 },
    ]);

    const FALLBACK_WORLD_POLYGONS = [
        [[[-130,50],[-125,60],[-115,68],[-95,72],[-80,72],[-65,62],[-55,50],[-60,45],[-68,44],[-75,38],[-82,30],[-90,28],[-97,26],[-105,30],[-118,34],[-125,42],[-130,50]]],
        [[[-80,10],[-75,12],[-63,10],[-52,4],[-42,0],[-35,-5],[-35,-12],[-38,-18],[-42,-22],[-48,-28],[-52,-33],[-58,-38],[-65,-45],[-68,-53],[-72,-48],[-75,-42],[-72,-35],[-68,-28],[-70,-18],[-75,-10],[-80,0],[-80,10]]],
        [[[-10,36],[0,38],[3,42],[5,44],[2,48],[-5,48],[-8,54],[-5,58],[5,62],[12,58],[18,55],[24,58],[30,60],[35,58],[42,55],[45,50],[40,45],[35,40],[28,36],[20,36],[12,38],[5,38],[0,36],[-10,36]]],
        [[[-15,12],[-17,15],[-12,25],[-5,35],[0,36],[10,37],[12,32],[20,32],[25,30],[32,32],[35,30],[42,12],[50,2],[42,-5],[40,-12],[35,-22],[30,-30],[22,-34],[18,-34],[15,-28],[12,-18],[8,-5],[5,5],[0,6],[-8,5],[-15,12]]],
        [[[28,36],[35,40],[42,48],[50,50],[55,55],[60,60],[65,68],[75,72],[90,72],[100,68],[115,65],[125,60],[130,55],[140,55],[145,50],[142,44],[135,38],[128,34],[122,30],[115,24],[108,18],[105,12],[100,5],[98,8],[95,15],[88,22],[80,28],[72,32],[60,38],[50,40],[42,45],[35,40],[28,36]]],
        [[[115,-15],[120,-14],[130,-12],[135,-14],[140,-16],[148,-20],[152,-25],[153,-28],[150,-33],[145,-38],[137,-35],[130,-32],[122,-33],[116,-32],[114,-28],[114,-22],[118,-20],[120,-18],[115,-15]]],
    ];

    function project(lon, lat) {
        const x = (lon + 180) / 360;
        const latRad = lat * Math.PI / 180;
        const mercator = Math.log(Math.tan(Math.PI / 4 + latRad / 2));
        return { x, y: 0.5 - mercator / (2 * Math.PI) };
    }

    function worldToScreen(lon, lat, width, height, view) {
        const point = project(lon, lat);
        return {
            x: (point.x - 0.5) * width * view.zoom + width / 2 - view.x * view.zoom,
            y: (point.y - 0.5) * height * view.zoom + height / 2 - view.y * view.zoom,
        };
    }

    function screenToWorld(x, y, width, height, view) {
        const projectedX = ((x - width / 2 + view.x * view.zoom) / (width * view.zoom)) + 0.5;
        const projectedY = ((y - height / 2 + view.y * view.zoom) / (height * view.zoom)) + 0.5;
        const mercator = (0.5 - projectedY) * 2 * Math.PI;
        return {
            lon: projectedX * 360 - 180,
            lat: (2 * Math.atan(Math.exp(mercator)) - Math.PI / 2) * 180 / Math.PI,
        };
    }

    function rgba(color, alpha) {
        return `rgba(${color.r},${color.g},${color.b},${alpha})`;
    }

    function lerp(start, end, amount) {
        return start + (end - start) * amount;
    }

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function hashString(value) {
        let hash = 0;
        for (let index = 0; index < value.length; index += 1) {
            hash = ((hash << 5) - hash) + value.charCodeAt(index);
            hash &= hash;
        }
        return hash;
    }

    function createAntarcticaLocator(stations = ANTARCTICA_STATIONS) {
        const positions = new Map();
        return function locate(address) {
            const key = String(address || 'unknown');
            if (positions.has(key)) return positions.get(key);
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

    function createDataLoader(options) {
        const fetchJson = options.fetchJson;
        const thresholds = options.thresholds || {};
        const callbacks = options.callbacks || {};
        const logger = options.logger || global.console || { log() {}, warn() {}, error() {} };
        const requests = Object.create(null);

        function loadOnce(key, filename, callbackName, label, fallback) {
            if (!requests[key]) {
                requests[key] = fetchJson(filename)
                    .then(data => {
                        if (callbacks[callbackName]) callbacks[callbackName](data);
                        logger.log(`[Bitcoin Peer Map] Loaded ${data.length} ${label}`);
                        return data;
                    })
                    .catch(error => {
                        if (fallback) {
                            if (callbacks[callbackName]) callbacks[callbackName](fallback);
                            logger.error('[Bitcoin Peer Map] Failed to load world geometry, using fallback:', error);
                            return fallback;
                        }
                        logger.warn(`[Bitcoin Peer Map] Failed to load ${label}:`, error);
                        return null;
                    });
            }
            return requests[key];
        }

        const loadWorld = () => loadOnce(
            'world', 'world-50m.json', 'world', 'land polygons', FALLBACK_WORLD_POLYGONS
        );
        const loadLakes = () => loadOnce('lakes', 'lakes-50m.json', 'lakes', 'lake polygons');
        const loadBorders = () => loadOnce(
            'borders', 'borders-50m.json', 'borders', 'country border lines'
        );
        const loadStates = () => loadOnce(
            'states', 'states-50m.json', 'states', 'state/province border lines'
        );
        const loadCities = () => loadOnce('cities', 'cities-50m.json', 'cities', 'cities');
        const loadCountryLabels = () => loadOnce(
            'countryLabels', 'country-labels-50m.json', 'countryLabels', 'country labels'
        );
        const loadStateLabels = () => loadOnce(
            'stateLabels', 'state-labels-50m.json', 'stateLabels', 'state/province labels'
        );

        function ensureZoomDetailLoaded(zoom) {
            if (zoom >= thresholds.states) loadStates();
            if (zoom >= thresholds.stateLabels) loadStateLabels();
            if (zoom >= thresholds.cities) loadCities();
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

    global.BPMWorldMap = Object.freeze({
        project,
        worldToScreen,
        screenToWorld,
        rgba,
        lerp,
        clamp,
        hashString,
        createAntarcticaLocator,
        createDataLoader,
    });
})(window);
