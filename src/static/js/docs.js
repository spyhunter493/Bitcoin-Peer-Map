/** @typedef {((options: {url: string; dom_id: string; validatorUrl: null; queryConfigEnabled: boolean; persistAuthorization: boolean; presets: unknown[]; layout: string}) => unknown) & {presets: {apis: unknown}}} SwaggerBundle */
const { SwaggerUIBundle } = /** @type {{SwaggerUIBundle: SwaggerBundle}} */ (/** @type {unknown} */ (globalThis));

SwaggerUIBundle({
    url: '/openapi.json',
    dom_id: '#swagger-ui',
    validatorUrl: null,
    queryConfigEnabled: false,
    persistAuthorization: false,
    presets: [SwaggerUIBundle.presets.apis],
    layout: 'BaseLayout',
});
