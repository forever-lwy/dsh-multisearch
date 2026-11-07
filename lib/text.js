/** URL normalization, tokenization and similarity helpers. */
const TRACKING = /^(utm_\w+|fbclid|gclid|dclid|msclkid|mc_[a-z]+|ref|ref_src|spm|from|source|share|igshid|si|_hsenc|_hsmi|yclid|vero_\w+|scid|cmpid)$/i;
/** Canonical identity of a page: same document, different decoration → same key. */
export function urlKey(raw) {
    try {
        const url = new URL(raw);
        url.hash = '';
        url.hostname = url.hostname.toLowerCase().replace(/^(www|m|mobile|amp)\./, '');
        if (url.hostname === 'twitter.com')
            url.hostname = 'x.com';
        if (url.hostname === 'old.reddit.com' || url.hostname === 'np.reddit.com')
            url.hostname = 'reddit.com';
        for (const key of [...url.searchParams.keys()])
            if (TRACKING.test(key))
                url.searchParams.delete(key);
        url.searchParams.sort();
        let path = url.pathname.replace(/\/(index\.html?|amp)$/i, '/').replace(/\/+$/, '');
        if (path === '')
            path = '/';
        const query = url.searchParams.toString();
        return `${url.hostname}${url.port ? `:${url.port}` : ''}${path}${query ? `?${query}` : ''}`;
    }
    catch {
        return raw.trim().toLowerCase();
    }
}
export function hostOf(raw) {
    try {
        return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
    }
    catch {
        return '';
    }
}
/** Does `host` equal or sit under `domain` (domain may carry a path prefix)? */
export function matchesSite(url, site) {
    const clean = site.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
    const [domain, ...rest] = clean.split('/');
    const host = hostOf(url);
    if (!domain || !(host === domain || host.endsWith(`.${domain}`)))
        return false;
    if (rest.length === 0)
        return true;
    try {
        return new URL(url).pathname.toLowerCase().startsWith(`/${rest.join('/')}`);
    }
    catch {
        return false;
    }
}
const STOP = new Set('a an the and or of to in on for with by is are was were be what how why which when who does do can vs versus from at as about into than this that these those it its 的 了 和 是 在 与 及 或 怎么 如何 什么 哪些 为什么 吗 呢'.split(' '));
/** Lowercased word tokens; CJK text becomes overlapping bigrams. */
export function tokens(text) {
    const out = [];
    const lower = text.toLowerCase();
    for (const word of lower.match(/[\p{L}\p{N}][\p{L}\p{N}._+#-]*/gu) ?? []) {
        if (/[㐀-鿿]/.test(word)) {
            const chars = [...word.replace(/[^㐀-鿿]/g, '')];
            for (let i = 0; i < chars.length - 1; i++)
                out.push(chars[i] + chars[i + 1]);
            if (chars.length === 1)
                out.push(chars[0]);
            const latin = word.replace(/[㐀-鿿]/g, ' ').trim();
            if (latin)
                out.push(...latin.split(/\s+/).filter(w => !STOP.has(w)));
        }
        else if (!STOP.has(word) && word.length > 1)
            out.push(word);
    }
    return out;
}
export function shingles(text, size = 4) {
    const words = tokens(text);
    const out = new Set();
    if (words.length < size) {
        if (words.length)
            out.add(words.join(' '));
        return out;
    }
    for (let i = 0; i <= words.length - size; i++)
        out.add(words.slice(i, i + size).join(' '));
    return out;
}
export function jaccard(a, b) {
    if (a.size === 0 || b.size === 0)
        return 0;
    let common = 0;
    for (const item of a)
        if (b.has(item))
            common++;
    return common / (a.size + b.size - common);
}
/** Rough token count: ~4 Latin chars per token, ~1 token per CJK character. */
export function estimateTokens(text) {
    let cjk = 0;
    for (const char of text)
        if (/[　-鿿＀-￯]/.test(char))
            cjk++;
    return Math.ceil(cjk + (text.length - cjk) / 4);
}
/** Version-like strings (v1.2, 3.11.4, 2024.10). */
export function findVersion(text) {
    const tagged = /(?:\bv|\bversion\s+|\brelease\s+|版本\s*)(\d+(?:\.\d+){1,3}(?:-(?:alpha|beta|rc)\.?\d*)?)(?![\d%])/i.exec(text)?.[1];
    if (tagged)
        return tagged;
    return /(?<![\d.])(\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.?\d*)?)(?![\d.%])/.exec(text)?.[1];
}
/** Provider dates come as ISO, RFC 2822, unix seconds/ms or a bare year; normalize to ISO when possible. */
export function normalizeDate(value) {
    if (!value)
        return undefined;
    const text = value.trim();
    if (/^\d{4}$/.test(text))
        return text;
    if (/^\d{10}$/.test(text))
        return new Date(Number(text) * 1000).toISOString();
    if (/^\d{13}$/.test(text))
        return new Date(Number(text)).toISOString();
    const time = Date.parse(text);
    if (!Number.isFinite(time))
        return undefined;
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : new Date(time).toISOString();
}
export function parseDate(value) {
    if (!value)
        return undefined;
    if (/^\d{4}$/.test(value))
        return Date.UTC(Number(value), 6, 1);
    const time = Date.parse(value);
    return Number.isFinite(time) ? time : undefined;
}
