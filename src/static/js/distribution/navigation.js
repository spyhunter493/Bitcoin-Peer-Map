import * as Selection from './selection.js';
import * as NavigationView from './navigation-view.js';
import * as SelectionFilters from './selection-filters.js';
import * as DonutInput from './donut-input.js';
import * as PanelInput from './panel-input.js';
import * as InsightInput from './insight-input.js';

/** Compose navigation responsibilities while preserving the controller's public API.
 * @param {import('../types').DistributionNavigationOptions} options
 * @returns {Readonly<import('../types').DistributionNavigation>}
 */
export function create(options) {
    // Factories only define handlers. Resolve cross-module transitions when a
    // handler runs, after every responsibility has been composed.
    const getNavigation = () => navigation;
    const navigation = Object.freeze({
        ...Selection.create(options, getNavigation),
        ...NavigationView.create(options, getNavigation),
        ...SelectionFilters.create(options, getNavigation),
        ...DonutInput.create(options, getNavigation),
        ...PanelInput.create(options, getNavigation),
        ...InsightInput.create(options, getNavigation),
    });
    return navigation;
}
