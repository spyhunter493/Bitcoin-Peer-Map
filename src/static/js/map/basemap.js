import { project, clamp } from './geometry.js';
import * as mapTools from './geometry.js';

/** @typedef {Pick<import('./renderer.js').Options,
 * 'mapView' | 'view' | 'basemapCanvas' | 'baseCtx' | 'config' | 'preferences' | 'fetchJson'> & {
 * getDpr(): number;
 * getWrapOffsetsFor(view: import('../types').Camera, margin: number): number[];
 * }} Options */

/** Owns geography loading and cached basemap rendering.
 * @param {Options} options
 */
export function create(options) {
    const { mapView, view, basemapCanvas, baseCtx } = options;
    const CFG = options.config;
    const { advSettings, advColors, canvasLabelColors } = options.preferences;

    /** @type {number[][][][]} */
    let polarPolygons = [];
    /** @type {number[][][][]} */
    let nonPolarPolygons = [];

    /** Classify world polygons into polar vs non-polar for "Snow the Poles". */
    function classifyPolarPolygons() {
        polarPolygons = [];
        nonPolarPolygons = [];
        for (let i = 0; i < worldPolygons.length; i++) {
            const ring = worldPolygons[i][0];
            if (!ring || ring.length === 0) {
                nonPolarPolygons.push(worldPolygons[i]);
                continue;
            }
            let sumLat = 0;
            for (let j = 0; j < ring.length; j++) sumLat += ring[j][1];
            const avgLat = sumLat / ring.length;
            if (avgLat < -60 || avgLat > 66) polarPolygons.push(worldPolygons[i]);
            else nonPolarPolygons.push(worldPolygons[i]);
        }
    }

    // Static geography is projected into reusable viewport-space paths.
    // The cached basemap bitmap is transformed while the camera is moving,
    // then redrawn once at the settled view for sharp output.
    /** @type {Record<'grid' | 'land' | 'polar' | 'lakes' | 'borders' | 'states', Path2D | null>} */
    const basemapPaths = {
        grid: null,
        land: null,
        polar: null,
        lakes: null,
        borders: null,
        states: null,
    };
    /** @type {import('../types').Camera | null} */
    let basemapView = null;
    let basemapDirty = true;
    let lastBasemapTransform = '';

    /** @type {number[][][][]} */
    let worldPolygons = [];
    /** @type {number[][][][]} */
    let lakePolygons = [];
    /** @type {number[][][]} */
    let borderLines = []; // country border line strings
    /** @type {number[][][]} */
    let stateLines = []; // state/province border line strings
    /** @type {(import('../types').MapPlace & {p: number})[]} */
    let cityPoints = []; // { n: name, p: population, c: [lon,lat] }
    /** @type {import('../types').MapPlace[]} */
    let countryLabels = []; // { n: name, c: [lon,lat] } — country centroids (English)
    /** @type {import('../types').MapPlace[]} */
    let stateLabels = []; // { n: name, c: [lon,lat] } — state/province centroids (English)
    let worldReady = false;
    let lakesReady = false;
    let bordersReady = false;
    let statesReady = false;
    let citiesReady = false;
    let countryLabelsReady = false;
    let stateLabelsReady = false;
    // Zoom thresholds for progressive detail layers
    // Country borders render at ALL zoom levels (no threshold)
    // Label hierarchy: countries first → states → cities
    const ZOOM_SHOW_COUNTRY_LABELS = 1.5; // country names appear (medium zoom)
    const ZOOM_SHOW_STATES = 3.0; // state/province borders appear
    const ZOOM_SHOW_STATE_LABELS = 4.0; // state/province names (after countries visible)
    const ZOOM_SHOW_CITIES_MAJOR = 6.0; // cities > 5M population
    const ZOOM_SHOW_CITIES_LARGE = 8.0; // cities > 1M population
    const ZOOM_SHOW_CITIES_MED = 10.0; // cities > 300K population
    const ZOOM_SHOW_CITIES_ALL = 12.0; // all cities
    const ZOOM_PREFETCH_STATES = ZOOM_SHOW_STATES - 0.5;
    const ZOOM_PREFETCH_STATE_LABELS = ZOOM_SHOW_STATE_LABELS - 0.5;
    const ZOOM_PREFETCH_CITIES = ZOOM_SHOW_CITIES_MAJOR - 0.5;

    const mapDataLoader = mapTools.createDataLoader({
        fetchJson: options.fetchJson,
        thresholds: {
            states: ZOOM_PREFETCH_STATES,
            stateLabels: ZOOM_PREFETCH_STATE_LABELS,
            cities: ZOOM_PREFETCH_CITIES,
        },
        callbacks: {
            world(polygons) {
                worldPolygons = polygons;
                worldReady = true;
                classifyPolarPolygons();
                rebuildWorldPaths();
                markBasemapDirty();
            },
            lakes(polygons) {
                lakePolygons = polygons;
                lakesReady = true;
                rebuildLakePath();
                markBasemapDirty();
            },
            borders(lines) {
                borderLines = lines;
                bordersReady = true;
                rebuildBorderPath();
                markBasemapDirty();
            },
            states(lines) {
                stateLines = lines;
                statesReady = true;
                rebuildStatePath();
                markBasemapDirty();
            },
            cities(points) {
                cityPoints = points;
                citiesReady = true;
                projectBasemapPoints(cityPoints);
                markBasemapDirty();
            },
            countryLabels(labels) {
                countryLabels = labels;
                countryLabelsReady = true;
                projectBasemapPoints(countryLabels);
                markBasemapDirty();
            },
            stateLabels(labels) {
                stateLabels = labels;
                stateLabelsReady = true;
                projectBasemapPoints(stateLabels);
                markBasemapDirty();
            },
        },
    });

    const loadWorldGeometry = mapDataLoader.loadWorld;
    const loadLakeGeometry = mapDataLoader.loadLakes;
    const loadBorderGeometry = mapDataLoader.loadBorders;
    const loadCountryLabels = mapDataLoader.loadCountryLabels;
    const ensureZoomDetailLoaded = mapDataLoader.ensureZoomDetailLoaded;

    function markBasemapDirty() {
        basemapDirty = true;
    }

    /** @param {number} lon
     * @param {number} lat */
    function basePoint(lon, lat) {
        const p = project(lon, lat);
        return { x: (p.x - 0.5) * mapView.width, y: (p.y - 0.5) * mapView.height };
    }

    /** @param {import('../types').MapPlace[]} points */
    function projectBasemapPoints(points) {
        if (!mapView.width || !mapView.height) return;
        for (const point of points) {
            const p = basePoint(point.c[0], point.c[1]);
            point.mapX = p.x;
            point.mapY = p.y;
        }
    }

    /** @param {number[][][][]} polygons */
    function buildPolygonPath(polygons) {
        if (!mapView.width || !mapView.height || polygons.length === 0) return null;
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

    /** @param {number[][][]} lines */
    function buildLinePath(lines) {
        if (!mapView.width || !mapView.height || lines.length === 0) return null;
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
        if (!mapView.width || !mapView.height) return;
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

    function getBasemapWrapOffsets() {
        return options.getWrapOffsetsFor(view, 0);
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

 * @param {number} lonOffset */
    function setBasemapWorldTransform(lonOffset) {
        const basemapDpr = options.getDpr();
        const zoom = view.zoom;
        const wrapX = (mapView.width * lonOffset) / 360;
        baseCtx.setTransform(
            basemapDpr * zoom,
            0,
            0,
            basemapDpr * zoom,
            basemapDpr * (mapView.width / 2 - view.x * zoom + wrapX * zoom),
            basemapDpr * (mapView.height / 2 - view.y * zoom)
        );
    }

    /** @param {Path2D | null} path
     * @param {string} fillStyle
     * @param {string} strokeStyle */
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

 * @param {Path2D | null} path
 * @param {string} strokeStyle
 * @param {number} lineWidth */
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
        const bScale = advSettings.borderScale / 50; // 0→0, 50→1 (default), 100→2
        if (bScale < 0.01) return; // slider at 0 = hidden
        const alpha = (0.25 + clamp((view.zoom - 1) / 3, 0, 1) * 0.15) * bScale;
        const strokeW = Math.max(0.5, 0.8 * view.zoom * bScale);
        const rgb = advColors.borderRGB;
        drawLinePathCopies(basemapPaths.borders, `rgba(${rgb},${alpha})`, strokeW);
    }

    /** @param {import('../types').MapPlace} point
     * @param {number} lonOffset */
    function basemapPointToScreen(point, lonOffset) {
        if (point.mapX === undefined || point.mapY === undefined) {
            const p = basePoint(point.c[0], point.c[1]);
            point.mapX = p.x;
            point.mapY = p.y;
        }
        return {
            x: (point.mapX + (mapView.width * lonOffset) / 360) * view.zoom + mapView.width / 2 - view.x * view.zoom,
            y: point.mapY * view.zoom + mapView.height / 2 - view.y * view.zoom,
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

        const dpr = options.getDpr();
        baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        baseCtx.font = `600 ${fontSize}px 'SF Mono','Fira Code',Consolas,monospace`;
        baseCtx.textAlign = 'center';
        baseCtx.textBaseline = 'middle';

        const offsets = getBasemapWrapOffsets();

        for (const label of countryLabels) {
            for (const off of offsets) {
                const s = basemapPointToScreen(label, off);
                // Cull off-screen labels
                if (s.x < -150 || s.x > mapView.width + 150 || s.y < -30 || s.y > mapView.height + 30) continue;

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
        const alpha = clamp((view.zoom - ZOOM_SHOW_STATES) / 1.5, 0, 1) * 0.2 * bScale;
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
        const alpha = clamp((view.zoom - ZOOM_SHOW_STATE_LABELS) / 1.5, 0, 1) * 0.4;

        // Font size: smaller than country labels, scales gently
        const fontSize = clamp(7 + (view.zoom - ZOOM_SHOW_STATE_LABELS) * 0.6, 7, 13);

        const dpr = options.getDpr();
        baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        baseCtx.font = `${fontSize}px 'SF Mono','Fira Code',Consolas,monospace`;
        baseCtx.textAlign = 'center';
        baseCtx.textBaseline = 'middle';

        const offsets = getBasemapWrapOffsets();

        for (const label of stateLabels) {
            for (const off of offsets) {
                const s = basemapPointToScreen(label, off);
                if (s.x < -100 || s.x > mapView.width + 100 || s.y < -20 || s.y > mapView.height + 20) continue;

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
        if (view.zoom >= ZOOM_SHOW_CITIES_ALL) minPop = 0;
        else if (view.zoom >= ZOOM_SHOW_CITIES_MED) minPop = 300000;
        else if (view.zoom >= ZOOM_SHOW_CITIES_LARGE) minPop = 1000000;
        else minPop = 5000000;

        // Overall opacity fades in from the first threshold
        const alpha = clamp((view.zoom - ZOOM_SHOW_CITIES_MAJOR) / 0.5, 0, 1) * 0.7;

        const offsets = getBasemapWrapOffsets();
        const dpr = options.getDpr();
        baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        baseCtx.textAlign = 'left';
        baseCtx.textBaseline = 'middle';

        for (const city of cityPoints) {
            if (city.p < minPop) continue;

            for (const off of offsets) {
                const s = basemapPointToScreen(city, off);
                // Cull off-screen cities
                if (s.x < -50 || s.x > mapView.width + 50 || s.y < -20 || s.y > mapView.height + 20) continue;

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
        const dpr = options.getDpr();
        baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        baseCtx.globalAlpha = 1;
        baseCtx.fillStyle = advColors.oceanFill;
        baseCtx.fillRect(0, 0, mapView.width, mapView.height);
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
        const translateX = mapView.width * 0.5 * (1 - scale) + view.zoom * (basemapView.x - view.x);
        const translateY = mapView.height * 0.5 * (1 - scale) + view.zoom * (basemapView.y - view.y);
        const transform = `matrix(${scale},0,0,${scale},${translateX},${translateY})`;
        if (transform !== lastBasemapTransform) {
            basemapCanvas.style.transform = transform;
            lastBasemapTransform = transform;
        }
    }

    function basemapMatchesView() {
        return (
            basemapView &&
            Math.abs(view.x - basemapView.x) < 0.25 &&
            Math.abs(view.y - basemapView.y) < 0.25 &&
            Math.abs(view.zoom - basemapView.zoom) < 0.001
        );
    }

    function resize() {
        rebuildBasemapPaths();
        basemapView = null;
        basemapCanvas.style.transform = 'none';
        lastBasemapTransform = 'none';
        markBasemapDirty();
    }

    /** @param {boolean} settled @param {boolean} interacting */
    function draw(settled, interacting) {
        if (settled && !interacting) {
            if (basemapDirty || !basemapMatchesView()) renderBasemap();
        } else if (!basemapView) {
            renderBasemap();
        } else {
            transformCachedBasemap();
        }
    }

    function loadGeometry() {
        loadWorldGeometry();
        loadLakeGeometry();
        loadBorderGeometry();
        loadCountryLabels();
    }

    return Object.freeze({
        resize,
        draw,
        markBasemapDirty,
        basemapMatchesView,
        loadGeometry,
        ensureZoomDetailLoaded,
    });
}
