/** General web search and reading services. */
import { createHash, createHmac } from 'node:crypto';
import { SourceError } from '../http.js';
import { MCP_SESSION_TAG, callTool } from './mcp.js';
import { afterDate, arr, clip, hit, hits, isCjk, joinUrl, num, requireKey, str, withSiteOperators } from './util.js';
const SNIPPET = 600;
export const keenable = {
    spec: {
        id: 'keenable', label: 'Keenable', engine: 'keenable', priority: 62,
        caps: { search: true, fetch: true }, types: ['web', 'news', 'documentation'],
        filters: { site: true, time: true }, credential: 'KEENABLE_API_KEY', keyOptional: true, defaultEnabled: true,
        blurb: '面向 Agent 的通用检索，支持站点与日期过滤，适合第一轮收集；无 Key 时走限速的公开端点',
        options: { mode: 'pro' },
    },
    async search(q, env) {
        const base = joinUrl(env.baseURL, 'https://api.keenable.ai', env.apiKey ? '/v1/search' : '/v1/search/public');
        const after = afterDate(q.need);
        const body = {
            query: q.query, max_results: Math.min(50, q.maxResults), mode: String(env.options.mode || 'pro'),
            ...(q.need.sites[0] ? { site: q.need.sites[0] } : {}),
            ...(after ? { published_after: after } : {}), ...(q.need.before ? { published_before: q.need.before } : {}),
        };
        const data = await env.http.json(base, {
            body, signal: q.signal, timeoutMs: q.timeoutMs,
            headers: env.apiKey ? { 'x-api-key': env.apiKey } : { 'x-keenable-title': 'dsh-multisearch' },
        });
        return { hits: hits(arr(data.results).map(r => hit(r.url, { title: str(r.title), snippet: clip(str(r.snippet), SNIPPET), publishedAt: str(r.published_at) }))) };
    },
    async fetch(r, env) {
        const base = joinUrl(env.baseURL, 'https://api.keenable.ai', env.apiKey ? '/v1/fetch' : '/v1/fetch/public');
        const data = await env.http.json(base, {
            query: { url: r.url, max_chars: Math.min(200_000, r.maxChars * 2), live: r.live || undefined },
            signal: r.signal, timeoutMs: r.timeoutMs,
            headers: env.apiKey ? { 'x-api-key': env.apiKey } : { 'x-keenable-title': 'dsh-multisearch' },
        });
        return { url: r.url, finalUrl: str(data.url), title: str(data.title), content: str(data.content) ?? '', publishedAt: str(data.published_at) };
    },
};
export const anysearch = {
    spec: {
        id: 'anysearch', label: 'AnySearch', engine: 'anysearch', priority: 58,
        caps: { search: true, fetch: true }, types: ['web', 'academic', 'finance', 'code', 'social', 'news', 'chinese'],
        filters: { language: true, region: true }, credential: 'ANYSEARCH_API_KEY', keyOptional: true,
        blurb: '统一检索网页、学术、财经、代码与社媒（含 X 讨论线索），可选 cn/intl 区域',
        options: { tag: '' },
    },
    async search(q, env) {
        const cn = q.need.region?.toLowerCase() === 'cn' || isCjk(q.query);
        const data = await env.http.json(joinUrl(env.baseURL, 'https://api.anysearch.com', '/v1/search'), {
            body: {
                query: withSiteOperators(q.query, q.need), max_results: Math.min(10, q.maxResults), zone: cn ? 'cn' : 'intl',
                ...(q.need.language ? { language: q.need.language } : {}), ...(env.options.tag ? { tag: String(env.options.tag) } : {}),
            },
            headers: env.apiKey ? { authorization: `Bearer ${env.apiKey}` } : {}, signal: q.signal, timeoutMs: q.timeoutMs,
        });
        if (num(data.code) !== undefined && data.code !== 0)
            throw new SourceError(`AnySearch: ${str(data.message) ?? data.code}`, 'upstream');
        return { hits: hits(arr(data.data?.results).map(r => hit(r.url, { title: str(r.title), snippet: clip(str(r.snippet) ?? str(r.content), SNIPPET), content: str(r.content) }))) };
    },
    async fetch(r, env) {
        const data = await env.http.json(joinUrl(env.baseURL, 'https://api.anysearch.com', '/v1/extract'), {
            body: { url: r.url }, headers: env.apiKey ? { authorization: `Bearer ${env.apiKey}` } : {}, signal: r.signal, timeoutMs: r.timeoutMs,
        });
        if (num(data.code) !== undefined && data.code !== 0)
            throw new SourceError(`AnySearch: ${str(data.message) ?? data.code}`, 'upstream');
        const content = str(data.data?.content) ?? '';
        return { url: r.url, title: str(data.data?.title), content, truncated: content.length >= 50_000 };
    },
};
const EXA_CATEGORY = { academic: 'research paper', news: 'news', code: 'github', company: 'company', finance: 'financial report' };
export const exa = {
    spec: {
        id: 'exa', label: 'Exa', engine: 'exa', priority: 70,
        caps: { search: true, fetch: true }, types: ['web', 'documentation', 'code', 'academic', 'company', 'news'],
        filters: { site: true, time: true }, credential: 'EXA_API_KEY',
        blurb: '语义搜索，按问题描述找技术文档、开源项目、论文与博客，关键词不一致时尤其有用',
    },
    async search(q, env) {
        const key = requireKey(env.apiKey, 'Exa');
        const after = afterDate(q.need);
        const category = q.need.types.map(type => EXA_CATEGORY[type]).find(Boolean);
        const data = await env.http.json(joinUrl(env.baseURL, 'https://api.exa.ai', '/search'), {
            body: {
                query: q.query, numResults: Math.min(25, q.maxResults), type: String(env.options.type || 'auto'),
                ...(q.need.sites.length ? { includeDomains: q.need.sites } : {}), ...(q.need.excludeSites.length ? { excludeDomains: q.need.excludeSites } : {}),
                ...(after ? { startPublishedDate: `${after}T00:00:00.000Z` } : {}), ...(q.need.before ? { endPublishedDate: `${q.need.before}T23:59:59.999Z` } : {}),
                ...(category && q.need.sites.length === 0 ? { category } : {}),
                contents: { highlights: { numSentences: 3, highlightsPerUrl: 2 }, text: { maxCharacters: 1200 } },
            },
            headers: { 'x-api-key': key }, signal: q.signal, timeoutMs: q.timeoutMs,
        });
        return {
            hits: hits(arr(data.results).map(r => hit(r.url, {
                title: str(r.title), snippet: clip(arr(r.highlights).join(' … ') || str(r.summary) || str(r.text), SNIPPET),
                content: str(r.text), publishedAt: str(r.publishedDate), meta: str(r.author) ? { author: str(r.author) } : undefined,
            }))),
        };
    },
    async fetch(r, env) {
        const key = requireKey(env.apiKey, 'Exa');
        const data = await env.http.json(joinUrl(env.baseURL, 'https://api.exa.ai', '/contents'), {
            body: { urls: [r.url], text: { maxCharacters: Math.min(100_000, r.maxChars * 2) }, livecrawl: r.live ? 'always' : 'fallback' },
            headers: { 'x-api-key': key }, signal: r.signal, timeoutMs: r.timeoutMs,
        });
        const first = arr(data.results)[0];
        const status = arr(data.statuses)[0];
        if (!first && status?.status === 'error')
            throw new SourceError(`Exa: ${str(status.error?.tag) ?? 'fetch failed'}`, 'upstream');
        return { url: r.url, finalUrl: str(first?.url), title: str(first?.title), content: str(first?.text) ?? '', publishedAt: str(first?.publishedDate) };
    },
};
export const tavily = {
    spec: {
        id: 'tavily', label: 'Tavily', engine: 'tavily', priority: 72,
        caps: { search: true, fetch: true, map: true, render: true }, types: ['web', 'news', 'finance', 'documentation'],
        filters: { site: true, time: true, region: true }, credential: 'TAVILY_API_KEY',
        blurb: '搜索结果附带适合模型阅读的片段，并能提取网页、发现站内页面，适合连续查证',
        options: { depth: 'basic', answer: false },
    },
    async search(q, env) {
        const key = requireKey(env.apiKey, 'Tavily');
        const topic = q.need.types.includes('news') ? 'news' : q.need.types.includes('finance') ? 'finance' : 'general';
        const after = q.need.timeRange ? undefined : q.need.after;
        const data = await env.http.json(joinUrl(env.baseURL, 'https://api.tavily.com', '/search'), {
            body: {
                query: q.query, max_results: Math.min(20, q.maxResults), search_depth: String(env.options.depth || 'basic'), topic,
                include_answer: Boolean(env.options.answer),
                ...(q.need.timeRange ? { time_range: q.need.timeRange } : {}), ...(after ? { start_date: after } : {}), ...(q.need.before ? { end_date: q.need.before } : {}),
                ...(q.need.sites.length ? { include_domains: q.need.sites } : {}), ...(q.need.excludeSites.length ? { exclude_domains: q.need.excludeSites } : {}),
            },
            headers: { authorization: `Bearer ${key}` }, signal: q.signal, timeoutMs: q.timeoutMs,
        });
        return {
            hits: hits(arr(data.results).map(r => hit(r.url, { title: str(r.title), snippet: clip(str(r.content), SNIPPET), publishedAt: str(r.published_date) }))),
            generated: str(data.answer),
        };
    },
    async fetch(r, env) {
        const key = requireKey(env.apiKey, 'Tavily');
        const data = await env.http.json(joinUrl(env.baseURL, 'https://api.tavily.com', '/extract'), {
            body: { urls: [r.url], extract_depth: String(env.options.depth) === 'advanced' ? 'advanced' : 'basic', format: 'markdown' },
            headers: { authorization: `Bearer ${key}` }, signal: r.signal, timeoutMs: r.timeoutMs,
        });
        const first = arr(data.results)[0];
        if (!first)
            throw new SourceError(`Tavily: ${str(arr(data.failed_results)[0]?.error) ?? 'extract failed'}`, 'upstream');
        return { url: r.url, finalUrl: str(first.url), content: str(first.raw_content) ?? '' };
    },
    async map(r, env) {
        const key = requireKey(env.apiKey, 'Tavily');
        const data = await env.http.json(joinUrl(env.baseURL, 'https://api.tavily.com', '/map'), {
            body: {
                url: r.url, max_depth: r.maxDepth, limit: r.maxPages * 3, allow_external: !r.sameDomain,
                ...(r.includePaths.length ? { select_paths: r.includePaths.map(path => `${escapeRegex(path)}.*`) } : {}),
                ...(r.excludePaths.length ? { exclude_paths: r.excludePaths.map(path => `${escapeRegex(path)}.*`) } : {}),
            },
            headers: { authorization: `Bearer ${key}` }, signal: r.signal, timeoutMs: r.timeoutMs,
        });
        return arr(data.results).map(url => typeof url === 'string' ? { url } : { url: String(url?.url ?? '') }).filter(link => link.url);
    },
};
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PARALLEL_MCP = 'https://mcp.parallel.ai/mcp';
const bareDomain = (site) => site.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
/** Parallel through its free Search MCP (`web_search` / `web_fetch`); the REST API needs a paid plan. */
export const parallel = {
    spec: {
        id: 'parallel', label: 'Parallel', engine: 'parallel', priority: 68,
        caps: { search: true, fetch: true, render: true, pdf: true }, types: ['web', 'documentation', 'academic', 'company'],
        filters: { site: true }, credential: 'PARALLEL_API_KEY', keyOptional: true,
        blurb: '以目标描述驱动的跨站搜索，返回面向模型的摘录，适合复杂比较和背景调查；经免费的 Search MCP 调用',
        options: { sendKey: false },
    },
    gate: ({ hasKey, options }) => options.sendKey && !hasKey ? { search: '已开启 sendKey 但缺少凭据', fetch: '已开启 sendKey 但缺少凭据' } : {},
    async search(q, env) {
        const sites = q.need.sites.slice(0, 3).map(bareDomain).filter(Boolean);
        const after = afterDate(q.need);
        const objective = [q.need.goal || q.query, after ? `Prefer sources published after ${after}.` : ''].filter(Boolean).join(' ');
        const data = await callTool(mcpTarget(q, env), 'web_search', {
            objective: objective.slice(0, 2000),
            search_queries: sites.length ? sites.map(site => `${q.query} site:${site}`) : [q.query],
            session_id: MCP_SESSION_TAG,
        });
        return { hits: hits(arr(data.results).slice(0, q.maxResults).map(r => hit(r.url, { title: str(r.title), snippet: clip(arr(r.excerpts).join(' … '), SNIPPET), content: arr(r.excerpts).join('\n\n') || undefined, publishedAt: str(r.publish_date) }))) };
    },
    async fetch(r, env) {
        const data = await callTool(mcpTarget(r, env), 'web_fetch', {
            urls: [r.url], full_content: true, ...(r.focus ? { objective: r.focus.slice(0, 200) } : {}), session_id: MCP_SESSION_TAG,
        });
        const first = arr(data.results)[0];
        if (!first) {
            const error = arr(data.errors)[0];
            throw new SourceError(`Parallel: ${str(error?.content) ?? str(error?.error_type) ?? str(data.text) ?? 'extract failed'}`, 'upstream');
        }
        const full = typeof first.full_content === 'string' ? first.full_content : str(first.full_content?.content);
        return { url: r.url, title: str(first.title), content: full ?? arr(first.excerpts).join('\n\n'), publishedAt: str(first.publish_date) };
    },
};
function mcpTarget(request, env) {
    // The anonymous tier is free; a key only helps with paid credit (without it the server answers 402).
    const headers = env.options.sendKey && env.apiKey ? { authorization: `Bearer ${env.apiKey}` } : {};
    return { http: env.http, endpoint: env.baseURL || PARALLEL_MCP, headers, signal: request.signal, timeoutMs: request.timeoutMs };
}
export const nimble = {
    spec: {
        id: 'nimble', label: 'Nimble', engine: 'nimble', priority: 55,
        caps: { search: true, fetch: true, render: true }, types: ['web', 'news', 'company'],
        filters: { site: true, time: true, language: true, region: true }, credential: 'NIMBLE_API_KEY',
        blurb: '实时 SERP 与浏览器渲染抓取，适合需要处理动态页面、补全企业或人物资料的任务',
        options: { depth: 'lite', render: false },
    },
    async search(q, env) {
        const key = requireKey(env.apiKey, 'Nimble');
        const range = q.need.timeRange;
        const data = await env.http.json(joinUrl(env.baseURL, 'https://sdk.nimbleway.com', '/v2/search'), {
            body: {
                query: q.query, max_results: Math.min(100, q.maxResults), search_depth: String(env.options.depth || 'lite'),
                focus: q.need.types.includes('news') ? 'news' : 'general',
                ...(q.need.sites.length ? { include_domains: q.need.sites.slice(0, 50) } : {}), ...(q.need.excludeSites.length ? { exclude_domains: q.need.excludeSites.slice(0, 50) } : {}),
                ...(range ? { time_range: range } : { ...(q.need.after ? { start_date: q.need.after } : {}), ...(q.need.before ? { end_date: q.need.before } : {}) }),
                ...(q.need.language ? { locale: q.need.language.split('-')[0] } : {}), ...(q.need.region ? { country: q.need.region.toUpperCase() } : {}),
            },
            headers: { authorization: `Bearer ${key}` }, signal: q.signal, timeoutMs: q.timeoutMs,
        });
        return { hits: hits(arr(data.results).map(r => hit(r.url, { title: str(r.title), snippet: clip(str(r.description) ?? str(r.content), SNIPPET), content: str(r.content) }))) };
    },
    async fetch(r, env) {
        const key = requireKey(env.apiKey, 'Nimble');
        const data = await env.http.json(joinUrl(env.baseURL, 'https://sdk.nimbleway.com', '/v2/extract'), {
            // Browser rendering took over two minutes in live tests; opt in per source when pages need JS.
            body: { url: r.url, render: Boolean(env.options.render), formats: ['markdown'], markdown_backend: 'main_content' },
            headers: { authorization: `Bearer ${key}` }, signal: r.signal, timeoutMs: r.timeoutMs,
        });
        return { url: r.url, content: str(data.data?.markdown) ?? '', statusCode: num(data.status_code) };
    },
};
const BRAVE_FRESHNESS = { day: 'pd', week: 'pw', month: 'pm', year: 'py' };
export const brave = {
    spec: {
        id: 'brave', label: 'Brave Search', engine: 'brave', priority: 60,
        caps: { search: true }, types: ['web', 'news'],
        filters: { site: true, time: true, language: true, region: true }, credential: 'BRAVE_API_KEY',
        blurb: '独立索引，补充 Google/Bing 之外的结果，支持新闻与新鲜度过滤（官方无按 URL 读取接口）',
    },
    async search(q, env) {
        const key = requireKey(env.apiKey, 'Brave');
        const news = q.need.types.includes('news') && !q.need.types.includes('web');
        const freshness = q.need.timeRange ? BRAVE_FRESHNESS[q.need.timeRange]
            : q.need.after ? `${q.need.after}to${q.need.before ?? new Date().toISOString().slice(0, 10)}` : undefined;
        const data = await env.http.json(joinUrl(env.baseURL, 'https://api.search.brave.com', news ? '/res/v1/news/search' : '/res/v1/web/search'), {
            query: {
                q: withSiteOperators(q.query, q.need), count: Math.min(20, q.maxResults), freshness, extra_snippets: news ? undefined : true,
                search_lang: q.need.language?.split('-')[0], country: q.need.region?.toUpperCase(),
            },
            headers: { 'x-subscription-token': key }, signal: q.signal, timeoutMs: q.timeoutMs,
        });
        const results = news ? arr(data.results) : arr(data.web?.results);
        return {
            hits: hits(results.map(r => hit(r.url, {
                title: str(r.title), snippet: clip([str(r.description), ...arr(r.extra_snippets).slice(0, 2)].filter(Boolean).join(' … '), SNIPPET),
                publishedAt: str(r.page_age) ?? str(r.age),
            }))),
        };
    },
};
export const you = {
    spec: {
        id: 'you', label: 'You.com', engine: 'you', priority: 56,
        caps: { search: true, fetch: true }, types: ['web', 'news'],
        filters: { site: true, time: true, language: true, region: true }, credential: 'YDC_API_KEY',
        blurb: '实时网页与新闻搜索，支持地区、语言、时间筛选；Contents API 读取网页正文',
    },
    async fetch(r, env) {
        const key = requireKey(env.apiKey, 'You.com');
        const data = await env.http.json(joinUrl(env.baseURL, 'https://ydc-index.io', '/v1/contents'), {
            body: { urls: [r.url], formats: ['markdown', 'metadata'], crawl_timeout: Math.max(1, Math.min(60, Math.floor(r.timeoutMs / 1000) - 1)), ...(r.live ? { max_age: 0 } : {}) },
            headers: { 'x-api-key': key }, signal: r.signal, timeoutMs: r.timeoutMs,
        });
        const first = arr(Array.isArray(data) ? data : data.results ?? data.contents)[0];
        if (!first || first.markdown == null)
            throw new SourceError('You.com: 未取得页面内容', 'upstream');
        return { url: r.url, finalUrl: str(first.url), title: str(first.title), content: str(first.markdown) ?? '' };
    },
    async search(q, env) {
        const key = requireKey(env.apiKey, 'You.com');
        const freshness = q.need.timeRange ?? (q.need.after ? `${q.need.after}to${q.need.before ?? new Date().toISOString().slice(0, 10)}` : undefined);
        const data = await env.http.json(joinUrl(env.baseURL, 'https://ydc-index.io', '/v1/search'), {
            body: {
                query: withSiteOperators(q.query, q.need), count: Math.min(50, q.maxResults),
                ...(freshness ? { freshness } : {}), ...(q.need.region ? { country: q.need.region.toUpperCase() } : {}),
                ...(q.need.language ? { language: q.need.language.toUpperCase() } : {}),
            },
            headers: { 'x-api-key': key }, signal: q.signal, timeoutMs: q.timeoutMs,
        });
        const results = [...arr(data.results?.web), ...arr(data.results?.news)];
        return { hits: hits(results.map(r => hit(r.url, { title: str(r.title), snippet: clip([str(r.description), ...arr(r.snippets).slice(0, 2)].filter(Boolean).join(' … '), SNIPPET), publishedAt: str(r.page_age) }))) };
    },
};
export const linkup = {
    spec: {
        id: 'linkup', label: 'Linkup', engine: 'linkup', priority: 58,
        caps: { search: true, fetch: true, answer: true, render: true }, types: ['web', 'company', 'news'],
        filters: { site: true, time: true }, credential: 'LINKUP_API_KEY',
        blurb: '搜索资料或返回带来源的答案，适合事实核查与企业信息调查；/fetch 读取网页（可渲染 JS）',
        options: { depth: 'standard', answer: false, renderJs: true, fetchMode: 'standard' },
    },
    async fetch(r, env) {
        const key = requireKey(env.apiKey, 'Linkup');
        const data = await env.http.json(joinUrl(env.baseURL, 'https://api.linkup.so', '/v1/fetch'), {
            body: { url: r.url, renderJs: env.options.renderJs !== false, mode: String(env.options.fetchMode || 'standard') },
            headers: { authorization: `Bearer ${key}` }, signal: r.signal, timeoutMs: r.timeoutMs,
        });
        return { url: r.url, content: str(data.markdown) ?? '' };
    },
    async search(q, env) {
        const key = requireKey(env.apiKey, 'Linkup');
        const answer = Boolean(env.options.answer);
        const after = afterDate(q.need);
        const data = await env.http.json(joinUrl(env.baseURL, 'https://api.linkup.so', '/v1/search'), {
            body: {
                q: q.query, depth: String(env.options.depth || 'standard'), outputType: answer ? 'sourcedAnswer' : 'searchResults',
                ...(q.need.sites.length ? { includeDomains: q.need.sites } : {}), ...(q.need.excludeSites.length ? { excludeDomains: q.need.excludeSites } : {}),
                ...(after ? { fromDate: after } : {}), ...(q.need.before ? { toDate: q.need.before } : {}), maxResults: q.maxResults,
            },
            headers: { authorization: `Bearer ${key}` }, signal: q.signal, timeoutMs: q.timeoutMs,
        });
        if (answer)
            return { generated: str(data.answer), hits: hits(arr(data.sources).map(r => hit(r.url, { title: str(r.name), snippet: clip(str(r.snippet), SNIPPET) }))) };
        return { hits: hits(arr(data.results).map(r => hit(r.url, { title: str(r.name), snippet: clip(str(r.content), SNIPPET), content: str(r.content) }))) };
    },
};
const YUANBAO_INDUSTRY = { government: 'gov', news: 'news', academic: 'acad', finance: 'finance' };
function tc3Headers(secretId, secretKey, host, service, action, version, payload) {
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
    const hmac = (key, text) => createHmac('sha256', key).update(text, 'utf8').digest();
    const contentType = 'application/json; charset=utf-8';
    const canonical = `POST\n/\n\ncontent-type:${contentType}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n\ncontent-type;host;x-tc-action\n${sha(payload)}`;
    const scope = `${date}/${service}/tc3_request`;
    const toSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${sha(canonical)}`;
    const signing = hmac(hmac(hmac(`TC3${secretKey}`, date), service), 'tc3_request');
    const signature = createHmac('sha256', signing).update(toSign, 'utf8').digest('hex');
    return {
        authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${scope}, SignedHeaders=content-type;host;x-tc-action, Signature=${signature}`,
        'content-type': contentType, host, 'x-tc-action': action, 'x-tc-timestamp': String(timestamp), 'x-tc-version': version,
    };
}
export const yuanbao = {
    spec: {
        id: 'yuanbao', label: '元宝搜索（腾讯云联网搜索）', engine: 'sogou', priority: 60,
        caps: { search: true }, types: ['chinese', 'web', 'news', 'government', 'academic', 'finance'],
        filters: { site: true, time: true }, credential: 'TENCENTCLOUD_WSA_SECRET',
        blurb: '覆盖中文全网与腾讯内容生态，支持站点、时间及新闻/政府/学术/财经筛选，适合国内资料与时效信息（官方无网页读取接口）',
        options: { edition: 'standard', mode: 0 },
    },
    async search(q, env) {
        const secret = requireKey(env.apiKey, '元宝搜索');
        // `SecretId:SecretKey` → Tencent Cloud TC3 signing; anything else is a service API KEY (Bearer).
        const split = /^AKID/.test(secret) ? secret.indexOf(':') : -1;
        const lite = String(env.options.edition) === 'lite';
        const industry = q.need.types.map(type => YUANBAO_INDUSTRY[type]).find(Boolean);
        const freshness = q.need.after
            ? (q.need.before ? `${q.need.after},${q.need.before}` : `${q.need.after},${new Date().toISOString().slice(0, 10)}`)
            : q.need.timeRange ? { day: 'd1', week: 'd7', month: 'm1', year: 'y1' }[q.need.timeRange] : undefined;
        const site = q.need.sites[0] ?? (q.need.excludeSites.length ? `exclude:${q.need.excludeSites.slice(0, 5).join('|')}` : undefined);
        const body = {
            Query: q.query, ...(site ? { Site: site } : {}), ...(freshness ? { Freshness: freshness } : {}),
            ...(lite ? {} : { Mode: Number(env.options.mode ?? 0), Cnt: Math.min(50, Math.max(10, Math.ceil(q.maxResults / 10) * 10)), ...(industry ? { Industry: industry } : {}) }),
        };
        const payload = JSON.stringify(body);
        const host = 'wsa.tencentcloudapi.com';
        const data = split > 0
            ? await env.http.json(env.baseURL || `https://${host}`, {
                method: 'POST', body: payload, signal: q.signal, timeoutMs: q.timeoutMs,
                headers: tc3Headers(secret.slice(0, split), secret.slice(split + 1), host, 'wsa', 'SearchPro', '2025-05-08', payload),
            })
            : await env.http.json(joinUrl(env.baseURL, 'https://api.wsa.cloud.tencent.com', '/SearchPro'), {
                method: 'POST', body: payload, signal: q.signal, timeoutMs: q.timeoutMs,
                headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json; charset=utf-8' },
            });
        const response = data.Response ?? {};
        if (response.Error)
            throw new SourceError(`元宝搜索: ${str(response.Error.Code)} ${str(response.Error.Message) ?? ''}`.trim(), String(response.Error.Code).startsWith('AuthFailure') ? 'auth' : 'upstream');
        const pages = arr(response.Pages).map(page => { try {
            return typeof page === 'string' ? JSON.parse(page) : page;
        }
        catch {
            return undefined;
        } }).filter(Boolean);
        return {
            hits: hits(pages.slice(0, q.maxResults).map(p => hit(p.url, {
                title: str(p.title), snippet: clip(str(p.content) ?? str(p.passage), SNIPPET), publishedAt: str(p.date),
                meta: { ...(str(p.site) ? { site: str(p.site) } : {}), ...(num(p.authority_level) !== undefined ? { authority: num(p.authority_level) } : {}) },
            }))),
        };
    },
};
export const contextdev = {
    spec: {
        id: 'contextdev', label: 'Context.dev', engine: 'contextdev', priority: 50,
        caps: { search: true, fetch: true, render: true }, types: ['web', 'company', 'news'],
        filters: { site: true }, credential: 'CONTEXT_DEV_API_KEY',
        blurb: '搜索与动态网页提取，可把企业、品牌、新闻网页整理成可处理的数据',
    },
    async search(q, env) {
        const key = requireKey(env.apiKey, 'Context.dev');
        const data = await env.http.json(joinUrl(env.baseURL, 'https://api.context.dev', '/v1/web/search'), {
            body: {
                query: q.query, numResults: Math.min(100, q.maxResults), descriptionMaxCharacters: SNIPPET,
                ...(q.need.sites.length ? { includeDomains: q.need.sites } : {}), ...(q.need.excludeSites.length ? { excludeDomains: q.need.excludeSites } : {}),
            },
            headers: { authorization: `Bearer ${key}` }, signal: q.signal, timeoutMs: q.timeoutMs,
        });
        return { hits: hits(arr(data.results).map(r => hit(r.url, { title: str(r.title), snippet: clip(str(r.description), SNIPPET), meta: str(r.relevance) ? { relevance: str(r.relevance) } : undefined }))) };
    },
    async fetch(r, env) {
        const key = requireKey(env.apiKey, 'Context.dev');
        const data = await env.http.json(joinUrl(env.baseURL, 'https://api.context.dev', '/v1/web/scrape'), {
            body: { url: r.url, formats: { markdown: true }, sharedParams: { mainContentOnly: true }, ...(r.live ? { maxAgeMs: 0 } : {}) },
            headers: { authorization: `Bearer ${key}` }, signal: r.signal, timeoutMs: r.timeoutMs,
        });
        if (data.markdown && data.markdown.success === false)
            throw new SourceError(`Context.dev: ${str(data.markdown.message) ?? str(data.markdown.error_code) ?? 'scrape failed'}`, 'upstream');
        return { url: r.url, finalUrl: str(data.url), title: str(data.metadata?.title), content: str(data.markdown?.data) ?? '', truncated: Boolean(data.isPartial) };
    },
};
export const brightdata = {
    spec: {
        id: 'brightdata', label: 'Bright Data', engine: 'google', priority: 50,
        caps: { search: true, fetch: true, render: true }, types: ['web', 'social', 'community'],
        filters: { site: true, language: true, region: true }, credential: 'BRIGHTDATA_API_KEY',
        hosts: ['x.com', 'twitter.com', 'reddit.com', 'amazon.com'],
        blurb: 'Google SERP 与 Web Unlocker，适合普通请求容易失败的页面、Reddit/X 等受限站点',
        options: { serpZone: '', unlockerZone: '' },
    },
    gate: ({ options }) => ({
        ...(options.serpZone ? {} : { search: '未配置 SERP zone' }),
        ...(options.unlockerZone ? {} : { fetch: '未配置 Web Unlocker zone' }),
    }),
    async search(q, env) {
        const key = requireKey(env.apiKey, 'Bright Data');
        const zone = String(env.options.serpZone || '');
        if (!zone)
            throw new SourceError('Bright Data 未配置 SERP zone', 'no_credential');
        const target = new URL('https://www.google.com/search');
        target.searchParams.set('q', withSiteOperators(q.query, q.need));
        target.searchParams.set('num', String(Math.min(20, q.maxResults)));
        if (q.need.language)
            target.searchParams.set('hl', q.need.language);
        if (q.need.region)
            target.searchParams.set('gl', q.need.region.toLowerCase());
        if (q.need.timeRange)
            target.searchParams.set('tbs', `qdr:${q.need.timeRange[0]}`);
        const data = await env.http.json(joinUrl(env.baseURL, 'https://api.brightdata.com', '/request'), {
            // `brd_json=1` now yields only general/input for Google; `parsed_light` returns the organic list.
            body: { zone, url: target.toString(), format: 'raw', data_format: 'parsed_light' }, headers: { authorization: `Bearer ${key}` }, signal: q.signal, timeoutMs: q.timeoutMs,
        });
        return { hits: hits(arr(data.organic).map(r => hit(r.link ?? r.url, { title: str(r.title), snippet: clip(str(r.description) ?? str(r.snippet), SNIPPET) }))) };
    },
    async fetch(r, env) {
        const key = requireKey(env.apiKey, 'Bright Data');
        const zone = String(env.options.unlockerZone || '');
        if (!zone)
            throw new SourceError('Bright Data 未配置 Web Unlocker zone', 'no_credential');
        const res = await env.http.text(joinUrl(env.baseURL, 'https://api.brightdata.com', '/request'), {
            body: { zone, url: r.url, format: 'raw', data_format: 'markdown' }, headers: { authorization: `Bearer ${key}` }, signal: r.signal, timeoutMs: r.timeoutMs,
        });
        if (res.status >= 400)
            throw new SourceError(`Bright Data HTTP ${res.status}: ${res.text.slice(0, 200)}`, res.status === 401 ? 'auth' : 'upstream', res.status);
        return { url: r.url, content: res.text };
    },
};
const RECENCY_MINUTES = { day: 1440, week: 10_080, month: 43_200, year: 525_600 };
/** TinyFish Search (GET api.search.tinyfish.ai) and Fetch (POST api.fetch.tinyfish.ai); free within a daily allowance. */
export const tinyfish = {
    spec: {
        id: 'tinyfish', label: 'TinyFish', engine: 'tinyfish', priority: 60,
        caps: { search: true, fetch: true, render: true, pdf: true }, types: ['web', 'news', 'academic'],
        filters: { site: true, time: true, language: true, region: true }, credential: 'TINYFISH_API_KEY',
        blurb: '通用网页、新闻与论文检索（论文带作者、期刊、引用数），正文抓取支持动态页面与 PDF；每日免费额度内不计费',
    },
    async search(q, env) {
        const key = requireKey(env.apiKey, 'TinyFish');
        const wanted = q.need.types;
        const domainType = wanted.length && wanted.every(t => t === 'academic') ? 'research_paper' : wanted.includes('news') && !wanted.includes('web') ? 'news' : undefined;
        const after = q.need.after;
        const query = {
            query: q.query,
            purpose: q.need.goal?.slice(0, 2000),
            include_domains: q.need.sites.map(bareDomain).filter(Boolean).join(',') || undefined,
            exclude_domains: q.need.excludeSites.map(bareDomain).filter(Boolean).join(',') || undefined,
            language: q.need.language?.split('-')[0],
            location: q.need.region?.toUpperCase(),
            domain_type: domainType,
        };
        if (domainType === 'research_paper') {
            const year = (q.need.after ?? afterDate(q.need))?.slice(0, 4);
            if (year)
                query.pub_year_min = Number(year);
            if (q.need.before)
                query.pub_year_max = Number(q.need.before.slice(0, 4));
        }
        else if (after || q.need.before) {
            query.after_date = after;
            query.before_date = q.need.before;
        }
        else if (q.need.timeRange) {
            query.recency_minutes = RECENCY_MINUTES[q.need.timeRange];
        }
        const data = await env.http.json(joinUrl(env.baseURL, 'https://api.search.tinyfish.ai', '/'), {
            method: 'GET', query, headers: { 'x-api-key': key }, signal: q.signal, timeoutMs: q.timeoutMs,
        });
        return {
            hits: hits(arr(data.results).slice(0, q.maxResults).map(r => hit(r.url, {
                title: str(r.title), snippet: clip(str(r.snippet), SNIPPET), publishedAt: str(r.date) ?? (num(r.year) ? String(r.year) : undefined),
                meta: Object.fromEntries(Object.entries({
                    publisher: str(r.publisher), venue: str(r.venue), authors: arr(r.authors).slice(0, 4).join(', ') || undefined,
                    cited_by: num(r.cited_by_count), pdf: str(r.pdf_url),
                }).filter(([, v]) => v !== undefined)),
            }))),
        };
    },
    async fetch(r, env) {
        const key = requireKey(env.apiKey, 'TinyFish');
        const data = await env.http.json(joinUrl(env.baseURL, 'https://api.fetch.tinyfish.ai', '/'), {
            body: {
                urls: [r.url], format: 'markdown', per_url_timeout_ms: Math.max(1000, Math.min(110_000, r.timeoutMs - 500)),
                ...(r.live ? { ttl: 0 } : {}), ...(r.focus ? { purpose: r.focus.slice(0, 2000) } : {}),
            },
            headers: { 'x-api-key': key }, signal: r.signal, timeoutMs: r.timeoutMs,
        });
        const page = arr(data.results)[0];
        if (page)
            return { url: r.url, finalUrl: str(page.final_url), title: str(page.title), content: typeof page.text === 'string' ? page.text : '', publishedAt: str(page.published_date) };
        const error = arr(data.errors)[0];
        const code = str(error?.error) ?? 'unknown';
        if (code === 'login_required' || code === 'bot_blocked')
            return { url: r.url, content: '', statusCode: 403 };
        if (code === 'page_not_found')
            return { url: r.url, content: '', statusCode: num(error?.status) ?? 404 };
        if (code === 'target_http_error')
            return { url: r.url, content: '', statusCode: num(error?.status) ?? 502 };
        throw new SourceError(`TinyFish: ${code}`, code === 'timeout' ? 'timeout' : code === 'invalid_url' ? 'bad_request' : 'upstream');
    },
};
