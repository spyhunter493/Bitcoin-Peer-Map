// Untrusted objects require field validation before use.
export type Data = Record<string, unknown>;
export interface Rpc {
    call(method: string, params?: unknown[], timeoutSeconds?: number): Promise<unknown>;
}
export function object(value: unknown): value is Data {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
export const nowSeconds = () => Date.now() / 1000;
export const round = (value: number, digits = 0) => Number(value.toFixed(digits));
