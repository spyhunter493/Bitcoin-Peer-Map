/* Advanced display-settings panel and controls. */
(function (global) {
    'use strict';

    const escapeHtml = global.BPMModal.escapeHtml;

    function create(options) {
        const settings = options.settings;
        const defaults = options.defaults;
        const themes = options.themes;
        const config = options.config;
        let panel = null;
        let returnFocus = null;
        let themeOutsideClick = null;

        function sliderHtml(id, label, value, min, max, step, isHue, bold) {
            const sliderClass = isHue ? 'adv-slider hue-slider' : 'adv-slider';
            const display = step < 1 ? parseFloat(value).toFixed(2) : Math.round(value);
            const openBold = bold ? '<b>' : '';
            const closeBold = bold ? '</b>' : '';
            return '<div class="adv-slider-row">' +
                '<span class="adv-slider-label adv-reset-link" data-slider="' + id + '" role="button" tabindex="0" title="Click to reset to default">' + openBold + escapeHtml(label) + closeBold + '</span>' +
                '<input type="range" class="' + sliderClass + '" id="' + id + '" aria-label="' + escapeHtml(label) + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '">' +
                '<span class="adv-slider-val" id="' + id + '-val">' + display + '</span>' +
                '</div>';
        }

        function buildHtml() {
            const currentTheme = options.getCurrentTheme();
            let html = '<div class="adv-titlebar" id="adv-titlebar">';
            html += '<span class="adv-titlebar-text" id="adv-panel-title">Advanced Display</span>';
            html += '<button type="button" class="adv-close" id="adv-close" title="Close" aria-label="Close Advanced Display">&times;</button>';
            html += '</div><div class="adv-body">';

            html += '<div class="adv-theme-section"><div class="adv-section">Theme</div>';
            html += '<div class="adv-theme-wrap" id="adv-theme-wrap">';
            html += '<button type="button" class="adv-theme-selected" id="adv-theme-selected" aria-haspopup="listbox" aria-expanded="false">';
            html += '<span id="adv-theme-current">' + escapeHtml(themes[currentTheme] ? themes[currentTheme].label : 'Dark') + '</span>';
            html += '<span class="adv-theme-arrow">&#9660;</span></button>';
            html += '<div class="adv-theme-list" id="adv-theme-list" role="listbox">';
            for (const [key, theme] of Object.entries(themes)) {
                const active = key === currentTheme ? ' active' : '';
                html += '<div class="adv-theme-option' + active + '" data-theme="' + escapeHtml(key) + '" role="option" tabindex="0" aria-selected="' + (key === currentTheme) + '">';
                html += '<span>' + escapeHtml(theme.label) + '</span><span class="adv-theme-check">&#10003;</span>';
                html += '<div class="adv-theme-tip"><div class="adv-theme-tip-head">';
                html += '<span class="adv-theme-tip-dot" style="background:' + escapeHtml(theme.dot || '#888') + '"></span>';
                html += '<span class="adv-theme-tip-name">' + escapeHtml(theme.label) + '</span></div>';
                html += '<div class="adv-theme-tip-desc">' + escapeHtml(theme.desc || '') + '</div></div></div>';
            }
            html += '</div></div></div>';

            html += '<div class="adv-section">Service Provider Distribution</div>';
            html += sliderHtml('adv-as-linewidth', 'Line Thickness', settings.asLineWidth, 0, 100, 1);
            html += sliderHtml('adv-as-fan', 'Line Fanning', settings.asLineFan, 0, 100, 1);
            html += '<div class="adv-section">Peer Effects</div>';
            html += sliderHtml('adv-shimmer', 'Shimmer', settings.shimmerStrength, 0, 1, 0.01);
            html += sliderHtml('adv-pdepth-in', 'Pulse Depth In', settings.pulseDepthIn, 0, 1, 0.01);
            html += sliderHtml('adv-pdepth-out', 'Pulse Depth Out', settings.pulseDepthOut, 0, 1, 0.01);
            html += sliderHtml('adv-pspeed-in', 'Pulse Speed In', settings.pulseSpeedIn, 0, 100, 1);
            html += sliderHtml('adv-pspeed-out', 'Pulse Speed Out', settings.pulseSpeedOut, 0, 100, 1);

            html += '<div class="adv-section">Land</div>';
            html += sliderHtml('adv-land-hue', 'Hue', settings.landHue, 0, 360, 1, true);
            html += sliderHtml('adv-land-bright', 'Brightness', settings.landBright, 0, 100, 1);
            html += sliderHtml('adv-snow-poles', 'Snow the Poles', settings.snowPoles, 0, 100, 1, false, true);
            html += '<div class="adv-note">*Use Peer table <span style="font-size:11px">&#9881;</span> below to adjust its transparency</div>';

            html += '<div class="adv-section">Ocean</div><div class="adv-preset-row">';
            html += '<span class="adv-preset-label">Preset</span>';
            html += '<button type="button" class="adv-preset-chip' + (settings.oceanLightBlue ? '' : ' active') + '" id="adv-ocean-original">Original</button>';
            html += '<button type="button" class="adv-preset-chip' + (settings.oceanLightBlue ? ' active' : '') + '" id="adv-ocean-lightblue">Light Blue</button></div>';
            if (settings.oceanLightBlue) {
                html += sliderHtml('adv-ocean-hue', 'Hue', Math.max(190, Math.min(230, settings.oceanHue)), 190, 230, 1, false);
            } else {
                html += sliderHtml('adv-ocean-hue', 'Hue', settings.oceanHue, 0, 360, 1, true);
            }
            html += sliderHtml('adv-ocean-bright', 'Brightness', settings.oceanBright, 0, 100, 1);

            html += '<div class="adv-section">Lat/Lon Grid</div><div class="adv-toggle-row">';
            html += '<span class="adv-toggle-label adv-reset-link" data-default-key="gridVisible" role="button" tabindex="0" title="Click to reset">Visible</span>';
            html += '<label class="dsp-toggle"><input type="checkbox" id="adv-grid-visible" ' + (settings.gridVisible ? 'checked' : '') + '><span class="dsp-toggle-slider"></span></label></div>';
            html += sliderHtml('adv-grid-thick', 'Thickness', settings.gridThickness, 0, 100, 1);
            html += sliderHtml('adv-grid-hue', 'Hue', settings.gridHue, 0, 360, 1, true);
            html += sliderHtml('adv-grid-bright', 'Brightness', settings.gridBright, 0, 100, 1);

            html += '<div class="adv-section">Borders</div>';
            html += sliderHtml('adv-border-scale', 'Thickness', settings.borderScale, 0, 100, 1);
            html += sliderHtml('adv-border-hue', 'Hue', settings.borderHue, 0, 360, 1, true);
            html += '<div class="adv-section">HUD Overlays</div><div class="adv-toggle-row">';
            html += '<span class="adv-toggle-label">Solid Backgrounds</span>';
            html += '<label class="dsp-toggle"><input type="checkbox" id="adv-hud-solid" ' + (settings.hudSolidBg ? 'checked' : '') + '><span class="dsp-toggle-slider"></span></label></div>';
            html += '<div class="adv-note">Adds backgrounds behind stats, price &amp; info panels for readability on lighter maps</div></div>';

            html += '<div class="adv-footer"><button type="button" class="adv-btn adv-btn-reset" id="adv-reset">Reset</button>';
            html += '<button type="button" class="adv-btn adv-btn-session" id="adv-session-save" title="Keeps settings for this session only — closes menu">Session Save</button>';
            html += '<button type="button" class="adv-btn adv-btn-save" id="adv-save" title="Saves settings permanently across sessions">Permanent Save</button></div>';
            return html + '<div class="adv-feedback" id="adv-feedback" role="status" aria-live="polite"></div>';
        }

        function open(focusTarget) {
            close(false);
            returnFocus = focusTarget || document.activeElement;
            panel = document.createElement('div');
            panel.className = 'adv-panel';
            panel.id = 'adv-panel';
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('aria-modal', 'false');
            panel.setAttribute('aria-labelledby', 'adv-panel-title');
            panel.innerHTML = buildHtml();
            document.body.appendChild(panel);
            position();
            bindControls();
            document.addEventListener('keydown', onKeydown);
            panel.querySelector('#adv-close').focus({ preventScroll: true });
            return panel;
        }

        function close(restoreFocus = true) {
            if (!panel) return;
            if (themeOutsideClick) {
                document.removeEventListener('click', themeOutsideClick);
                themeOutsideClick = null;
            }
            document.removeEventListener('keydown', onKeydown);
            panel.remove();
            panel = null;
            if (restoreFocus && returnFocus && returnFocus.isConnected && returnFocus.focus) {
                returnFocus.focus({ preventScroll: true });
            }
        }

        function onKeydown(event) {
            if (event.key === 'Escape' && panel) {
                event.preventDefault();
                close();
            }
        }

        function position() {
            if (!panel) return;
            const padding = 12;
            const panelWidth = 310;
            panel.style.left = Math.max(padding, global.innerWidth - panelWidth - padding) + 'px';
            panel.style.top = '56px';
        }

        function bindDrag() {
            const titlebar = panel.querySelector('#adv-titlebar');
            if (!titlebar) return;
            titlebar.addEventListener('mousedown', event => {
                if (event.target.classList.contains('adv-close')) return;
                const startX = event.clientX;
                const startY = event.clientY;
                const startLeft = parseInt(panel.style.left) || 0;
                const startTop = parseInt(panel.style.top) || 0;
                const movingPanel = panel;
                function move(moveEvent) {
                    if (!movingPanel.isConnected) return;
                    const nextX = Math.max(0, Math.min(
                        startLeft + moveEvent.clientX - startX,
                        global.innerWidth - movingPanel.offsetWidth
                    ));
                    const nextY = Math.max(0, Math.min(
                        startTop + moveEvent.clientY - startY,
                        global.innerHeight - movingPanel.offsetHeight
                    ));
                    movingPanel.style.left = nextX + 'px';
                    movingPanel.style.top = nextY + 'px';
                }
                function stop() {
                    global.removeEventListener('mousemove', move);
                    global.removeEventListener('mouseup', stop);
                }
                global.addEventListener('mousemove', move);
                global.addEventListener('mouseup', stop);
                event.preventDefault();
            });
        }

        function bindSlider(id, callback) {
            const slider = panel.querySelector('#' + id);
            const value = panel.querySelector('#' + id + '-val');
            if (!slider) return;
            slider.addEventListener('input', () => {
                const next = parseFloat(slider.value);
                if (value) value.textContent = parseFloat(slider.step) < 1 ? next.toFixed(2) : Math.round(next);
                callback(next);
            });
        }

        function setSliderValue(id, value) {
            if (!panel) return;
            const slider = panel.querySelector('#' + id);
            const output = panel.querySelector('#' + id + '-val');
            if (!slider) return;
            slider.value = value;
            if (output) {
                output.textContent = parseFloat(slider.step) < 1
                    ? parseFloat(value).toFixed(2)
                    : Math.round(value);
            }
        }

        function refreshSliders() {
            const values = {
                'adv-as-linewidth': settings.asLineWidth,
                'adv-as-fan': settings.asLineFan,
                'adv-shimmer': settings.shimmerStrength,
                'adv-pdepth-in': settings.pulseDepthIn,
                'adv-pdepth-out': settings.pulseDepthOut,
                'adv-pspeed-in': settings.pulseSpeedIn,
                'adv-pspeed-out': settings.pulseSpeedOut,
                'adv-land-hue': settings.landHue,
                'adv-land-bright': settings.landBright,
                'adv-snow-poles': settings.snowPoles,
                'adv-ocean-hue': settings.oceanHue,
                'adv-ocean-bright': settings.oceanBright,
                'adv-grid-thick': settings.gridThickness,
                'adv-grid-hue': settings.gridHue,
                'adv-grid-bright': settings.gridBright,
                'adv-border-scale': settings.borderScale,
                'adv-border-hue': settings.borderHue,
            };
            for (const [id, value] of Object.entries(values)) setSliderValue(id, value);
        }

        function syncOceanPreset() {
            if (!panel) return;
            const original = panel.querySelector('#adv-ocean-original');
            const lightBlue = panel.querySelector('#adv-ocean-lightblue');
            original.classList.toggle('active', !settings.oceanLightBlue);
            lightBlue.classList.toggle('active', !!settings.oceanLightBlue);
            const hue = panel.querySelector('#adv-ocean-hue');
            if (settings.oceanLightBlue) {
                hue.min = 190;
                hue.max = 230;
                hue.classList.remove('hue-slider');
                hue.classList.add('blue-hue-slider');
            } else {
                hue.min = 0;
                hue.max = 360;
                hue.classList.remove('blue-hue-slider');
                hue.classList.add('hue-slider');
            }
        }

        function refreshTheme(themeName, themeLabel) {
            if (!panel) return;
            syncOceanPreset();
            refreshSliders();
            const hud = panel.querySelector('#adv-hud-solid');
            if (hud) hud.checked = settings.hudSolidBg;
            const label = panel.querySelector('#adv-theme-current');
            if (label) label.textContent = themeLabel;
            panel.querySelectorAll('.adv-theme-option').forEach(option => {
                const active = option.dataset.theme === themeName;
                option.classList.toggle('active', active);
                option.setAttribute('aria-selected', String(active));
            });
        }

        function bindLabelResets() {
            const resetMap = {
                'adv-as-linewidth': { key: 'asLineWidth' },
                'adv-as-fan': { key: 'asLineFan' },
                'adv-shimmer': { key: 'shimmerStrength', configKey: 'shimmerStrength' },
                'adv-pdepth-in': { key: 'pulseDepthIn', configKey: 'pulseDepthInbound' },
                'adv-pdepth-out': { key: 'pulseDepthOut', configKey: 'pulseDepthOutbound' },
                'adv-pspeed-in': { key: 'pulseSpeedIn', updateConfig: value => { config.pulseSpeedInbound = 0.0014 * Math.pow(2, (value - 50) / 30); } },
                'adv-pspeed-out': { key: 'pulseSpeedOut', updateConfig: value => { config.pulseSpeedOutbound = 0.0026 * Math.pow(2, (value - 50) / 30); } },
                'adv-land-hue': { key: 'landHue', colors: true },
                'adv-land-bright': { key: 'landBright', colors: true },
                'adv-snow-poles': { key: 'snowPoles', redraw: true },
                'adv-ocean-hue': { key: 'oceanHue', colors: true },
                'adv-ocean-bright': { key: 'oceanBright', colors: true },
                'adv-grid-thick': { key: 'gridThickness', colors: true },
                'adv-grid-hue': { key: 'gridHue', colors: true },
                'adv-grid-bright': { key: 'gridBright', colors: true },
                'adv-border-scale': { key: 'borderScale', redraw: true },
                'adv-border-hue': { key: 'borderHue', colors: true },
            };
            panel.querySelectorAll('.adv-reset-link').forEach(label => {
                label.addEventListener('keydown', event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        label.click();
                    }
                });
                const sliderId = label.dataset.slider;
                if (sliderId) {
                    label.addEventListener('click', () => {
                        const info = resetMap[sliderId];
                        if (!info) return;
                        const value = defaults[info.key];
                        settings[info.key] = value;
                        setSliderValue(sliderId, value);
                        if (info.configKey) config[info.configKey] = value;
                        if (info.updateConfig) info.updateConfig(value);
                        if (info.colors) options.updateColors();
                        if (info.redraw) options.markMapDirty();
                    });
                    return;
                }
                const defaultKey = label.dataset.defaultKey;
                if (defaultKey && defaults[defaultKey] !== undefined) {
                    label.addEventListener('click', () => {
                        settings[defaultKey] = defaults[defaultKey];
                        if (defaultKey === 'gridVisible') {
                            panel.querySelector('#adv-grid-visible').checked = defaults[defaultKey];
                            options.markMapDirty();
                        }
                    });
                }
            });
        }

        function bindControls() {
            panel.querySelector('#adv-close').addEventListener('click', () => close());
            const themeWrap = panel.querySelector('#adv-theme-wrap');
            const themeSelected = panel.querySelector('#adv-theme-selected');
            const themeList = panel.querySelector('#adv-theme-list');
            themeSelected.addEventListener('click', event => {
                event.stopPropagation();
                const open = themeWrap.classList.toggle('open');
                themeSelected.setAttribute('aria-expanded', String(open));
            });
            themeOutsideClick = event => {
                if (!themeWrap.contains(event.target)) {
                    themeWrap.classList.remove('open');
                    themeSelected.setAttribute('aria-expanded', 'false');
                }
            };
            document.addEventListener('click', themeOutsideClick);
            themeList.querySelectorAll('.adv-theme-option').forEach(option => {
                const choose = () => {
                    const themeName = option.dataset.theme;
                    if (!themeName || !themes[themeName]) return;
                    options.applyTheme(themeName);
                    themeWrap.classList.remove('open');
                    themeSelected.setAttribute('aria-expanded', 'false');
                    const grid = panel.querySelector('#adv-grid-visible');
                    if (grid) grid.checked = settings.gridVisible;
                };
                option.addEventListener('click', choose);
                option.addEventListener('keydown', event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        choose();
                    }
                });
            });
            bindDrag();

            bindSlider('adv-shimmer', value => { settings.shimmerStrength = value; config.shimmerStrength = value; });
            bindSlider('adv-pdepth-in', value => { settings.pulseDepthIn = value; config.pulseDepthInbound = value; });
            bindSlider('adv-pdepth-out', value => { settings.pulseDepthOut = value; config.pulseDepthOutbound = value; });
            bindSlider('adv-pspeed-in', value => { settings.pulseSpeedIn = value; config.pulseSpeedInbound = 0.0014 * Math.pow(2, (value - 50) / 30); });
            bindSlider('adv-pspeed-out', value => { settings.pulseSpeedOut = value; config.pulseSpeedOutbound = 0.0026 * Math.pow(2, (value - 50) / 30); });
            bindSlider('adv-land-hue', value => { settings.landHue = value; options.updateColors(); });
            bindSlider('adv-land-bright', value => { settings.landBright = value; options.updateColors(); });
            bindSlider('adv-snow-poles', value => { settings.snowPoles = value; options.markMapDirty(); });
            bindSlider('adv-ocean-hue', value => { settings.oceanHue = value; options.updateColors(); });
            bindSlider('adv-ocean-bright', value => { settings.oceanBright = value; options.updateColors(); });
            bindSlider('adv-grid-thick', value => { settings.gridThickness = value; options.updateColors(); });
            bindSlider('adv-grid-hue', value => { settings.gridHue = value; options.updateColors(); });
            bindSlider('adv-grid-bright', value => { settings.gridBright = value; options.updateColors(); });
            bindSlider('adv-as-linewidth', value => { settings.asLineWidth = value; });
            bindSlider('adv-as-fan', value => { settings.asLineFan = value; });
            bindSlider('adv-border-scale', value => { settings.borderScale = value; options.markMapDirty(); });
            bindSlider('adv-border-hue', value => { settings.borderHue = value; options.updateColors(); });

            panel.querySelector('#adv-ocean-original').addEventListener('click', () => {
                settings.oceanLightBlue = false;
                settings.oceanHue = defaults.oceanHue;
                settings.oceanBright = defaults.oceanBright;
                syncOceanPreset();
                setSliderValue('adv-ocean-hue', settings.oceanHue);
                setSliderValue('adv-ocean-bright', settings.oceanBright);
                options.updateColors();
            });
            panel.querySelector('#adv-ocean-lightblue').addEventListener('click', () => {
                settings.oceanLightBlue = true;
                settings.oceanHue = 210;
                settings.oceanBright = 50;
                syncOceanPreset();
                setSliderValue('adv-ocean-hue', settings.oceanHue);
                setSliderValue('adv-ocean-bright', settings.oceanBright);
                options.updateColors();
            });
            panel.querySelector('#adv-grid-visible').addEventListener('change', event => {
                settings.gridVisible = event.target.checked;
                options.markMapDirty();
            });
            panel.querySelector('#adv-hud-solid').addEventListener('change', event => {
                settings.hudSolidBg = event.target.checked;
                options.applyHud();
            });
            syncOceanPreset();
            bindLabelResets();

            panel.querySelector('#adv-reset').addEventListener('click', () => {
                options.applyTheme('dark');
                Object.assign(settings, defaults);
                config.shimmerStrength = defaults.shimmerStrength;
                config.pulseDepthInbound = defaults.pulseDepthIn;
                config.pulseDepthOutbound = defaults.pulseDepthOut;
                config.pulseSpeedInbound = 0.0014;
                config.pulseSpeedOutbound = 0.0026;
                options.updateColors();
                syncOceanPreset();
                refreshSliders();
                panel.querySelector('#adv-grid-visible').checked = defaults.gridVisible;
                panel.querySelector('#adv-hud-solid').checked = defaults.hudSolidBg;
                options.applyHud();
                feedback('All settings reset to defaults');
            });
            panel.querySelector('#adv-session-save').addEventListener('click', () => {
                feedback('Session settings applied');
                global.setTimeout(() => close(), 400);
            });
            panel.querySelector('#adv-save').addEventListener('click', () => {
                options.saveSettings();
                options.saveTheme();
                feedback('Settings saved permanently');
            });
        }

        function feedback(message) {
            if (!panel) return;
            const output = panel.querySelector('#adv-feedback');
            output.textContent = message;
            output.style.opacity = '1';
            global.clearTimeout(output._timer);
            output._timer = global.setTimeout(() => { output.style.opacity = '0'; }, 2000);
        }

        return Object.freeze({ open, close, refreshTheme, isOpen: () => !!panel });
    }

    global.BPMDisplaySettings = Object.freeze({ create });
})(window);
