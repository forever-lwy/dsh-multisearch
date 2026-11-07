import { SourceError } from '../http.js';
import { afterDate, arr, clip, hit, hits, joinUrl, num, requireKey, str, unixToIso } from './util.js';
const WEIR_TIME = { day: 'day', week: 'week', month: 'month', year: 'year' };
function subredditOf(sites) {
    for (const site of sites) {
        const match = /reddit\.com\/r\/([A-Za-z0-9_]+)/i.exec(site);
        if (match)
            return match[1];
    }
    return undefined;
}
function redditPostId(url) {
    return /reddit\.com\/(?:r\/[^/]+\/)?comments\/([a-z0-9]+)/i.exec(url)?.[1] ?? /redd\.it\/([a-z0-9]+)/i.exec(url)?.[1];
}
function xPostId(url) {
    return /(?:x|twitter)\.com\/[^/]+\/status(?:es)?\/(\d+)/i.exec(url)?.[1];
}
export function decodeEntities(text) {
    return text?.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
function interleave(lists) {
    const out = [];
    for (let i = 0; lists.some(list => i < list.length); i++)
        for (const list of lists)
            if (list[i])
                out.push(list[i]);
    return out;
}
function formatXPost(p) {
    const author = p?.author?.username ? `@${p.author.username}` : 'unknown';
    const counts = [p?.likeCount != null ? `${p.likeCount} likes` : '', p?.replyCount != null ? `${p.replyCount} replies` : ''].filter(Boolean).join(', ');
    return `${author} (${str(p?.createdAt) ?? ''}${counts ? `; ${counts}` : ''}):\n${str(p?.text) ?? ''}`;
}
export const weir = {
    spec: {
        id: 'weir', label: 'Weir', engine: 'weir', priority: 60,
        caps: { search: true, fetch: true }, types: ['social', 'community'],
        filters: { site: true, time: true, language: true }, credential: 'WEIR_API_KEY',
        fetchHosts: ['x.com', 'twitter.com', 'reddit.com', 'redd.it'],
        blurb: 'X 与 Reddit 专用检索，读取帖子、评论和讨论串，适合关键词讨论收集和社媒追踪',
        options: { platforms: 'reddit,x' },
    },
    async search(q, env) {
        const key = requireKey(env.apiKey, 'Weir');
        const headers = { authorization: `Bearer ${key}` };
        const base = env.baseURL || 'https://api.weirapp.io';
        const platforms = String(env.options.platforms || 'reddit,x').split(',').map(p => p.trim());
        const wantX = platforms.includes('x') && (q.need.types.length === 0 || q.need.types.includes('social') || q.need.sites.some(s => /(^|\.)(x|twitter)\.com/.test(s)));
        const wantReddit = platforms.includes('reddit') && (q.need.types.length === 0 || q.need.types.includes('community') || q.need.sites.some(s => /reddit\.com/.test(s)));
        const tasks = [];
        if (wantReddit) {
            const subreddit = subredditOf(q.need.sites);
            tasks.push(env.http.json(joinUrl(base, '', '/v1/reddit/search'), {
                body: { query: q.query, ...(subreddit ? { subreddit } : {}), sort: 'relevance', time: q.need.timeRange ? WEIR_TIME[q.need.timeRange] : 'all', limit: Math.min(50, q.maxResults) },
                headers, signal: q.signal, timeoutMs: q.timeoutMs,
            }).then(data => hits(arr(data.data).map(p => hit(str(p.permalink) ? `https://www.reddit.com${p.permalink}` : p.url, {
                title: str(p.title), snippet: clip(str(p.selftext) ?? str(p.title), 500), publishedAt: str(p.createdAt) ?? unixToIso(p.createdUtc),
                meta: { platform: 'reddit', subreddit: str(p.subreddit) ?? '', score: num(p.score) ?? 0, comments: num(p.numComments) ?? 0 },
            })))));
        }
        if (wantX) {
            const after = afterDate(q.need);
            tasks.push(env.http.json(joinUrl(base, '', '/v1/x/search'), {
                body: { query: q.query, ...(q.need.language ? { language: q.need.language.split('-')[0] } : {}), ...(after ? { since: after } : {}), ...(q.need.before ? { until: q.need.before } : {}) },
                headers, signal: q.signal, timeoutMs: q.timeoutMs,
            }).then(data => hits(arr(data.data).slice(0, q.maxResults).map(p => hit(p.url, {
                title: `@${p.author?.username ?? 'unknown'} on X`, snippet: clip(str(p.text), 500), publishedAt: str(p.createdAt),
                meta: { platform: 'x', likes: num(p.likeCount) ?? 0, replies: num(p.replyCount) ?? 0 },
            })))));
        }
        if (tasks.length === 0)
            return { hits: [] };
        const settled = await Promise.allSettled(tasks);
        const lists = settled.flatMap(s => s.status === 'fulfilled' ? [s.value] : []);
        if (lists.length === 0)
            throw settled[0].reason;
        return { hits: interleave(lists).slice(0, q.maxResults) };
    },
    async fetch(r, env) {
        const key = requireKey(env.apiKey, 'Weir');
        const headers = { authorization: `Bearer ${key}` };
        const base = env.baseURL || 'https://api.weirapp.io';
        const xId = xPostId(r.url);
        if (xId) {
            const thread = await env.http.json(joinUrl(base, '', `/v1/x/posts/${xId}/thread`), { headers, signal: r.signal, timeoutMs: r.timeoutMs }).catch(() => undefined);
            const posts = arr(thread?.data);
            const replies = await env.http.json(joinUrl(base, '', `/v1/x/posts/${xId}/replies`), { query: { limit: 40 }, headers, signal: r.signal, timeoutMs: r.timeoutMs }).catch(() => undefined);
            const main = posts.length ? posts : [(await env.http.json(joinUrl(base, '', `/v1/x/posts/${xId}`), { headers, signal: r.signal, timeoutMs: r.timeoutMs })).data];
            const content = [`## Thread`, ...main.map(formatXPost), ...(arr(replies?.data).length ? ['## Replies', ...arr(replies?.data).slice(0, 40).map(formatXPost)] : [])].join('\n\n');
            return { url: r.url, title: 'X post', content };
        }
        const redditId = redditPostId(r.url);
        if (redditId) {
            const post = (await env.http.json(joinUrl(base, '', `/v1/reddit/posts/${redditId}`), { headers, signal: r.signal, timeoutMs: r.timeoutMs })).data ?? {};
            const comments = await env.http.json(joinUrl(base, '', `/v1/reddit/posts/${redditId}/comments`), { query: { limit: 80 }, headers, signal: r.signal, timeoutMs: r.timeoutMs }).catch(() => undefined);
            const lines = arr(comments?.data).slice(0, 80).map(c => `${'  '.repeat(Math.min(6, num(c.depth) ?? 0))}- u/${str(c.author) ?? '?'} (${num(c.score) ?? 0}): ${clip(str(c.body), 1200) ?? ''}`);
            return { url: r.url, title: str(post.title), content: [`# ${str(post.title) ?? ''}`, `r/${str(post.subreddit) ?? ''} · u/${str(post.author) ?? ''} · score ${num(post.score) ?? 0}`, str(post.selftext) ?? '', lines.length ? '## Comments' : '', ...lines].filter(Boolean).join('\n\n') };
        }
        throw new SourceError('Weir 只能读取 X 或 Reddit 帖子链接', 'unsupported_type');
    },
};
export const arcticshift = {
    spec: {
        id: 'arcticshift', label: 'Arctic Shift', engine: 'reddit-archive', priority: 45,
        caps: { search: true, fetch: true }, types: ['community'], filters: { time: true, site: true }, defaultEnabled: true, needs: 'subreddit',
        fetchHosts: ['reddit.com', 'redd.it'],
        blurb: 'Reddit 历史归档检索与帖子读取（含已删除帖的归档），搜索需要在 sites 中指定 reddit.com/r/<社区>',
    },
    async fetch(r, env) {
        const id = redditPostId(r.url);
        if (!id)
            throw new SourceError('不是 Reddit 帖子链接', 'unsupported_type');
        const base = env.baseURL || 'https://arctic-shift.photon-reddit.com';
        const post = arr((await env.http.json(`${base}/api/posts/ids`, { query: { ids: id }, signal: r.signal, timeoutMs: r.timeoutMs })).data)[0];
        if (!post)
            throw new SourceError('Arctic Shift 没有该帖子的归档', 'not_found');
        const tree = await env.http.json(`${base}/api/comments/tree`, { query: { link_id: `t3_${id}`, limit: 120 }, signal: r.signal, timeoutMs: r.timeoutMs }).catch(() => undefined);
        const lines = [];
        const walk = (nodes, depth) => {
            for (const node of nodes) {
                if (lines.length >= 150)
                    return;
                const c = node?.data ?? node;
                if (node?.kind === 'more' || !c)
                    continue;
                if (str(c.body))
                    lines.push(`${'  '.repeat(Math.min(depth, 6))}- u/${str(c.author) ?? '?'} (${num(c.score) ?? 0}): ${clip(str(c.body), 1200)}`);
                const replies = c.replies?.data?.children ?? c.replies ?? c.children;
                if (Array.isArray(replies))
                    walk(replies, depth + 1);
            }
        };
        walk(arr(tree?.data), 0);
        const head = [`# ${str(post.title) ?? ''}`, `r/${str(post.subreddit) ?? ''} · u/${str(post.author) ?? ''} · score ${num(post.score) ?? 0} · ${unixToIso(post.created_utc) ?? ''}`, str(post.url) && !String(post.url).includes(id) ? `Link: ${post.url}` : '', str(post.selftext) ?? ''];
        return { url: r.url, title: str(post.title), content: [...head, lines.length ? '## Comments' : '', ...lines].filter(Boolean).join('\n\n'), publishedAt: unixToIso(post.created_utc) };
    },
    async search(q, env) {
        const subreddit = subredditOf(q.need.sites);
        if (!subreddit)
            throw new SourceError('Arctic Shift 需要在 sites 中指定 reddit.com/r/<社区>', 'bad_request');
        const after = afterDate(q.need);
        const data = await env.http.json(joinUrl(env.baseURL, 'https://arctic-shift.photon-reddit.com', '/api/posts/search'), {
            query: { query: q.query, subreddit, after, before: q.need.before, limit: Math.min(100, q.maxResults), sort: 'desc' },
            signal: q.signal, timeoutMs: q.timeoutMs,
        });
        if (data.error)
            throw new SourceError(`Arctic Shift: ${str(data.error)}`, 'upstream');
        return {
            hits: hits(arr(data.data).map(p => hit(str(p.permalink) ? `https://www.reddit.com${p.permalink}` : undefined, {
                title: str(p.title), snippet: clip(str(p.selftext) || str(p.title), 500), publishedAt: unixToIso(p.created_utc),
                meta: { platform: 'reddit', subreddit: str(p.subreddit) ?? '', score: num(p.score) ?? 0, comments: num(p.num_comments) ?? 0 },
            }))),
        };
    },
};
export const hackernews = {
    spec: {
        id: 'hackernews', label: 'Hacker News (Algolia)', engine: 'hn', priority: 50,
        caps: { search: true, fetch: true }, types: ['community', 'code', 'news'], filters: { time: true }, defaultEnabled: true,
        fetchHosts: ['news.ycombinator.com'],
        blurb: '检索 Hacker News 帖子与评论，适合查 AI、开发工具、开源项目与创业产品的技术社区讨论',
    },
    async search(q, env) {
        const after = afterDate(q.need);
        const filters = [after ? `created_at_i>${Math.floor(Date.parse(after) / 1000)}` : '', q.need.before ? `created_at_i<${Math.floor(Date.parse(q.need.before) / 1000) + 86_400}` : ''].filter(Boolean);
        const data = await env.http.json(joinUrl(env.baseURL, 'https://hn.algolia.com', '/api/v1/search'), {
            query: { query: q.query, tags: '(story,comment)', hitsPerPage: Math.min(50, q.maxResults), numericFilters: filters.join(',') || undefined },
            signal: q.signal, timeoutMs: q.timeoutMs,
        });
        return {
            hits: hits(arr(data.hits).map(h => {
                const comment = !h.title && h.comment_text;
                const text = decodeEntities((comment ? str(h.comment_text) : str(h.story_text))?.replace(/<[^>]+>/g, ' '));
                return hit(`https://news.ycombinator.com/item?id=${h.objectID}`, {
                    title: comment ? `Comment on: ${str(h.story_title) ?? 'HN story'}` : str(h.title),
                    snippet: clip(text ?? str(h.url) ?? '', 500), publishedAt: str(h.created_at),
                    meta: { platform: 'hn', points: num(h.points) ?? 0, comments: num(h.num_comments) ?? 0, ...(str(h.url) ? { link: str(h.url) } : {}) },
                });
            })),
        };
    },
    async fetch(r, env) {
        const id = /[?&]id=(\d+)/.exec(r.url)?.[1];
        if (!id)
            throw new SourceError('不是 Hacker News 帖子链接', 'unsupported_type');
        const item = await env.http.json(joinUrl(env.baseURL, 'https://hn.algolia.com', `/api/v1/items/${id}`), { signal: r.signal, timeoutMs: r.timeoutMs });
        const lines = [];
        const strip = (html) => decodeEntities((str(html) ?? '').replace(/<p>/g, '\n').replace(/<[^>]+>/g, '')) ?? '';
        const walk = (node, depth) => {
            if (lines.length > 300)
                return;
            if (depth > 0 && node.text)
                lines.push(`${'  '.repeat(Math.min(depth - 1, 6))}- ${node.author ?? '?'}: ${strip(node.text).replace(/\n+/g, ' ')}`);
            for (const child of arr(node.children))
                walk(child, depth + 1);
        };
        walk(item, 0);
        const head = [`# ${str(item.title) ?? 'HN item'}`, str(item.url) ? `Link: ${item.url}` : '', `by ${str(item.author) ?? '?'} · ${num(item.points) ?? 0} points · ${str(item.created_at) ?? ''}`, strip(item.text)].filter(Boolean);
        return { url: r.url, title: str(item.title), content: [...head, lines.length ? '## Comments' : '', ...lines].filter(Boolean).join('\n\n') };
    },
};
