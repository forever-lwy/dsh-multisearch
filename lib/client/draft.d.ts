/** Pure helpers for the settings draft: path access and the minimal write set. Free of React for tests. */
export type PathOp = {
    op: 'set';
    path: string[];
    value: unknown;
} | {
    op: 'unset';
    path: string[];
};
export declare function deepEqual(a: unknown, b: unknown): boolean;
export declare function getIn(value: unknown, path: readonly string[]): unknown;
/** Immutable set; `undefined` removes the key. */
export declare function setIn<T>(value: T, path: readonly string[], next: unknown): T;
/**
 * Leaf writes turning `current` into `next`. Objects recurse, arrays and scalars are leaves;
 * a field removed in `next` becomes an unset so it inherits the default again.
 */
export declare function diffOps(current: unknown, next: unknown, path?: string[]): PathOp[];
/** Comma/newline separated text → trimmed unique list. */
export declare function splitList(text: string): string[];
