import type { IncomingMessage, ServerResponse } from 'node:http';
import type { paths } from '../shared/api.generated.d.ts';

export type RouteHandler<Result = unknown> = (
    query: URLSearchParams, request: IncomingMessage, response: ServerResponse, signal: AbortSignal,
) => Result | Promise<Result>;
type JsonPath = Exclude<keyof paths, '/' | '/api/stream/system'>;
type RouteKey = {
    [Path in JsonPath]: {
        [Method in 'get' | 'post']: undefined extends paths[Path][Method] ? never : `${Uppercase<Method>} ${Path}`;
    }['get' | 'post'];
}[JsonPath];
type ResponseFor<Key extends RouteKey> = Key extends `${infer Method} ${infer Path extends JsonPath}`
    ? paths[Path][Lowercase<Method> & keyof paths[Path]] extends {
        responses: { 200: { content: { 'application/json': infer Result } } };
    } ? Result : never // Retired routes throw; they cannot return a successful body.
    : never;

/** Check every HTTP JSON producer while keeping dynamic routing independent of codegen at runtime. */
export type ApiRoutes = { [Key in RouteKey]: RouteHandler<ResponseFor<Key>> }
    & { 'GET /openapi.json': RouteHandler };
