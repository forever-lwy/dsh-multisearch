export class SourceError extends Error {
    code;
    status;
    constructor(message, code, status) {
        super(message);
        this.code = code;
        this.status = status;
        this.name = 'SourceError';
    }
}
const USER_AGENT = 'dsh-multisearch/0.1 (+https://github.com/forever-lwy/dsh-multisearch)';
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
function withQuery(url, query) {
    if (!query)
        return url;
    const target = new URL(url);
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === '')
            continue;
        target.searchParams.set(key, String(value));
    }
    return target.toString();
}
/** Abort when either the caller cancels or the per-request timeout elapses. */
export function deadlineSignal(signal, timeoutMs) {
    return AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, timeoutMs))]);
}
async function readCapped(response, maxBytes) {
    if (!response.body)
        return { text: '', truncated: false };
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    let truncated = false;
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        size += value.byteLength;
        if (size > maxBytes) {
            chunks.push(value.subarray(0, value.byteLength - (size - maxBytes)));
            truncated = true;
            await reader.cancel().catch(() => { });
            break;
        }
        chunks.push(value);
    }
    const buffer = Buffer.concat(chunks);
    const type = response.headers.get('content-type') ?? '';
    const charset = /charset=([^;]+)/i.exec(type)?.[1]?.trim().toLowerCase();
    let text;
    try {
        text = new TextDecoder(charset && charset !== 'utf-8' ? charset : 'utf-8').decode(buffer);
    }
    catch {
        text = buffer.toString('utf8');
    }
    return { text, truncated };
}
function describe(error, signal, outer) {
    if (error instanceof SourceError)
        return error;
    if (outer.aborted)
        return new SourceError('cancelled', 'cancelled');
    if (signal.aborted)
        return new SourceError('request timed out', 'timeout');
    const message = error instanceof Error ? (error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message) : String(error);
    return new SourceError(message, 'network');
}
/** Never echo credentials back in error text. */
export function redact(text, secrets) {
    let out = text;
    for (const secret of secrets)
        if (secret && secret.length >= 6)
            out = out.split(secret).join('***');
    return out;
}
async function request(url, init, accept) {
    const signal = deadlineSignal(init.signal, init.timeoutMs);
    const headers = { 'user-agent': USER_AGENT, accept, ...init.headers };
    let body;
    if (init.body !== undefined) {
        if (typeof init.body === 'string')
            body = init.body;
        else {
            body = JSON.stringify(init.body);
            headers['content-type'] ??= 'application/json';
        }
    }
    try {
        const response = await fetch(withQuery(url, init.query), {
            method: init.method ?? (body === undefined ? 'GET' : 'POST'), headers, body, signal, redirect: 'follow',
        });
        return { response, signal };
    }
    catch (error) {
        throw describe(error, signal, init.signal);
    }
}
function statusError(status, text) {
    const detail = text.replace(/\s+/g, ' ').trim().slice(0, 300);
    const code = status === 401 || status === 403 ? 'auth' : status === 402 ? 'quota' : status === 429 ? 'rate_limited' : status >= 500 ? 'upstream' : 'bad_request';
    return new SourceError(`HTTP ${status}${detail ? `: ${detail}` : ''}`, code, status);
}
export const http = {
    async json(url, init) {
        const { response, signal } = await request(url, init, 'application/json');
        try {
            const { text } = await readCapped(response, init.maxBytes ?? DEFAULT_MAX_BYTES);
            if (!response.ok)
                throw statusError(response.status, text);
            try {
                return text === '' ? {} : JSON.parse(text);
            }
            catch {
                throw new SourceError(`invalid JSON response: ${text.slice(0, 120)}`, 'bad_response', response.status);
            }
        }
        catch (error) {
            throw describe(error, signal, init.signal);
        }
    },
    async text(url, init) {
        const { response, signal } = await request(url, init, 'text/html,application/xhtml+xml,text/plain;q=0.9,application/pdf;q=0.5,*/*;q=0.3');
        try {
            const { text } = await readCapped(response, init.maxBytes ?? DEFAULT_MAX_BYTES);
            return { status: response.status, text, url: response.url || url, contentType: response.headers.get('content-type') ?? '', headers: Object.fromEntries(response.headers) };
        }
        catch (error) {
            throw describe(error, signal, init.signal);
        }
    },
};
/** Run tasks with a concurrency limit, preserving input order of results. */
export async function pool(items, limit, run) {
    const results = new Array(items.length);
    let next = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
        for (;;) {
            const index = next++;
            if (index >= items.length)
                return;
            results[index] = await run(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}
export function errorText(error) {
    return error instanceof Error ? error.message : String(error);
}
export function errorCode(error) {
    return error instanceof SourceError ? error.code : 'error';
}
