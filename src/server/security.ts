import type { ServerResponse } from 'node:http';

// Inline attributes remain necessary for generated peer views and positioning.
// Scripts and stylesheet elements must come from the application's own assets.
export const CONTENT_SECURITY_POLICY = [
    "default-src 'self'",
    "script-src 'self'",
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "style-src-elem 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "form-action 'self'",
].join('; ');

export function setSecurityHeaders(response: ServerResponse) {
    response.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('X-Content-Type-Options', 'nosniff');
}
