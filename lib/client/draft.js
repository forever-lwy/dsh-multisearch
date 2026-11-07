/** Pure helpers for the settings draft: path access and the minimal write set. Free of React for tests. */
const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export function deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}
export function getIn(value, path) {
    let node = value;
    for (const key of path)
        node = isPlain(node) ? node[key] : undefined;
    return node;
}
/** Immutable set; `undefined` removes the key. */
export function setIn(value, path, next) {
    if (path.length === 0)
        return next;
    const [head, ...rest] = path;
    const base = isPlain(value) ? { ...value } : {};
    const child = setIn(base[head], rest, next);
    if (child === undefined)
        delete base[head];
    else
        base[head] = child;
    return base;
}
/**
 * Leaf writes turning `current` into `next`. Objects recurse, arrays and scalars are leaves;
 * a field removed in `next` becomes an unset so it inherits the default again.
 */
export function diffOps(current, next, path = []) {
    if (isPlain(current) && isPlain(next)) {
        const keys = [...new Set([...Object.keys(current), ...Object.keys(next)])];
        return keys.flatMap(key => diffOps(current[key], next[key], [...path, key]));
    }
    if (deepEqual(current, next))
        return [];
    if (next === undefined)
        return [{ op: 'unset', path }];
    return [{ op: 'set', path, value: next }];
}
/** Comma/newline separated text → trimmed unique list. */
export function splitList(text) {
    return [...new Set(text.split(/[\n,，;；]+/).map(item => item.trim()).filter(Boolean))];
}
