// JSON-RPC methods return heterogeneous objects; validation stays at service boundaries.
export type Data = Record<string, any>;
export interface Rpc {
    call(method: string, params?: unknown[], timeoutSeconds?: number): Promise<any>;
}
export function object(value: unknown): value is Data {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
export const nowSeconds = () => Date.now() / 1000;
export const round = (value: number, digits = 0) => Number(value.toFixed(digits));
