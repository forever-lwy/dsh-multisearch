/** Settings schema, profile presets and the effective per-call tuning. */
import z from '@deepseek-ai/schemastery';
import { PROFILES, RESOURCE_TYPES } from './types.js';
import { STATIC_ADAPTERS, builtinWeb, directHttp } from './sources/index.js';
export const PRESETS = {
    fast: {
        parallelSources: 1, queryConcurrency: 4, perSourceResults: 6, autoFollowUp: false, followUpRounds: 0, minResults: 3, duplicateRatio: 0.7,
        requestTimeoutMs: 8000, callTimeoutMs: 15000, fetchConcurrency: 4, fetchMaxChars: 8000, fetchRetries: 0, fetchFallbacks: 2,
        cacheTtlMinutes: 60, candidateLimit: 20, returnResults: 6, outputTokens: 2000, snippetChars: 280, rerank: true,
    },
    balanced: {
        parallelSources: 2, queryConcurrency: 6, perSourceResults: 8, autoFollowUp: false, followUpRounds: 1, minResults: 5, duplicateRatio: 0.6,
        requestTimeoutMs: 12000, callTimeoutMs: 30000, fetchConcurrency: 4, fetchMaxChars: 15000, fetchRetries: 1, fetchFallbacks: 3,
        cacheTtlMinutes: 60, candidateLimit: 40, returnResults: 8, outputTokens: 4000, snippetChars: 450, rerank: true,
    },
    deep: {
        parallelSources: 4, queryConcurrency: 8, perSourceResults: 10, autoFollowUp: true, followUpRounds: 2, minResults: 8, duplicateRatio: 0.5,
        requestTimeoutMs: 20000, callTimeoutMs: 60000, fetchConcurrency: 6, fetchMaxChars: 30000, fetchRetries: 1, fetchFallbacks: 4,
        cacheTtlMinutes: 120, candidateLimit: 80, returnResults: 12, outputTokens: 8000, snippetChars: 600, rerank: true,
    },
};
const typeUnion = z.union([...RESOURCE_TYPES]);
const nat = (description) => z.natural().description(description);
const tuningSchema = z.object({
    parallelSources: nat('并行来源数量'),
    queryConcurrency: nat('查询并发数'),
    perSourceResults: nat('每个来源的候选数量'),
    autoFollowUp: z.boolean().description('自动补搜（关闭时只把补搜建议返回给模型）'),
    followUpRounds: nat('最多补搜轮数'),
    minResults: nat('去重后结果少于该数量时触发补搜'),
    duplicateRatio: z.number().min(0).max(1).description('重复命中占比高于该值时触发补搜'),
    requestTimeoutMs: nat('单个请求超时（毫秒）'),
    callTimeoutMs: nat('单次工具调用总时限（毫秒）'),
    fetchConcurrency: nat('抓取并发数'),
    fetchMaxChars: nat('每个页面单次返回的最大字符数'),
    fetchRetries: nat('同一服务的重试次数'),
    fetchFallbacks: nat('同一 URL 最多尝试的抓取服务数'),
    cacheTtlMinutes: nat('已抓取正文的缓存时效（分钟）'),
    candidateLimit: nat('参与重排的候选数量'),
    returnResults: nat('返回条数'),
    outputTokens: nat('证据输出预算（约 tokens）'),
    snippetChars: nat('每条片段的最大字符数'),
    rerank: z.boolean().description('启用重排'),
}).description('逐项覆盖档位默认值；留空即使用档位值');
function sourceSchema(spec) {
    return z.object({
        enabled: z.boolean().default(spec.defaultEnabled ?? false).description('启用'),
        search: spec.caps.search ? z.boolean().default(true).description('使用其搜索功能') : z.boolean().default(false).hidden(),
        fetch: spec.caps.fetch ? z.boolean().default(true).description('使用其抓取功能') : z.boolean().default(false).hidden(),
        apiKey: spec.credential
            ? z.string().role('credential-ref').default(spec.credential).description(spec.keyOptional ? 'API Key 凭据引用（可选）' : 'API Key 凭据引用')
            : z.string().default('').hidden(),
        priority: z.number().min(0).max(100).default(spec.priority).description('优先级 0–100'),
        baseURL: z.string().default('').description('自定义接口地址（留空用官方地址）'),
        types: z.array(typeUnion).default([]).description(`能力标签（留空用内置：${spec.types.join(', ')}）`),
        options: z.dict(z.union([z.string(), z.number(), z.boolean()])).default({ ...(spec.options ?? {}) }).description('来源专属参数'),
    }).description(`${spec.label} — ${spec.blurb}`);
}
const BUILTIN_SPECS = [builtinWeb(() => undefined).spec, directHttp(() => false).spec];
export const ALL_SPECS = [...STATIC_ADAPTERS.map(a => a.spec), ...BUILTIN_SPECS];
const sourcesSchema = z.object(Object.fromEntries(ALL_SPECS.map(spec => [spec.id, sourceSchema(spec)])));
export const DEFAULT_FETCH_ORDER = ['keenable', 'jina', 'http', 'builtin', 'firecrawl', 'tavily', 'exa', 'you', 'linkup', 'crawl4ai', 'contextdev', 'parallel', 'anysearch', 'scrapingant', 'nimble', 'brightdata', 'tinyfish'];
export const Config = z.object({
    profile: z.union([...PROFILES]).default('balanced').volatile().description('默认档位：fast 快速 / balanced 均衡 / deep 深入'),
    tools: z.object({
        search: z.boolean().default(true).description('注册搜索工具'),
        fetch: z.boolean().default(true).description('注册抓取工具'),
        searchName: z.string().default('search').description('搜索工具名'),
        fetchName: z.string().default('fetch').description('抓取工具名'),
        guidance: z.boolean().default(true).description('在系统提示词中加入简短使用说明'),
    }).volatile().description('工具'),
    overrides: tuningSchema.default({}).volatile(),
    limits: z.object({
        maxQueries: z.natural().default(6).description('单次调用最多查询数'),
        maxParallelSources: z.natural().default(6).description('并行来源数上限'),
        maxPerSourceResults: z.natural().default(20).description('每源候选数上限'),
        maxReturnResults: z.natural().default(30).description('返回条数上限'),
        maxOutputTokens: z.natural().default(16000).description('输出预算上限（约 tokens）'),
        maxCallTimeoutMs: z.natural().default(120000).description('单次调用总时限上限（毫秒）'),
        maxRequestTimeoutMs: z.natural().default(45000).description('单请求超时上限（毫秒）'),
        maxFetchUrls: z.natural().default(10).description('单次抓取 URL 数上限'),
        maxFetchChars: z.natural().default(60000).description('单页返回字符上限'),
        maxFollowUpRounds: z.natural().default(3).description('补搜轮数上限'),
        maxCrawlPages: z.natural().default(30).description('站内爬取页数上限'),
        maxCrawlDepth: z.natural().default(3).description('站内爬取深度上限'),
    }).volatile().description('硬性上限（单次调用参数和逐项设置都不能超过）'),
    routing: z.object({
        autoRoute: z.boolean().default(true).description('按需求自动选源'),
        defaultSources: z.array(z.string()).default(['exa', 'tavily', 'keenable', 'brave', 'builtin']).description('需求不明确时的通用组合（按顺序取可用来源）'),
        rules: z.array(z.object({
            name: z.string().default(''),
            types: z.array(typeUnion).default([]).description('命中任一资料类型'),
            keywords: z.array(z.string()).default([]).description('查询包含任一关键词'),
            sites: z.array(z.string()).default([]).description('限定域名包含任一项'),
            sources: z.array(z.string()).default([]).description('加分的来源'),
            boost: z.number().default(30).description('加分'),
        })).default([]).description('自定义匹配规则'),
        overlapPenalty: z.number().default(25).description('与已选来源共用底层引擎时的扣分'),
        officialDomains: z.array(z.string()).default([]).description('额外视为官方资料的域名'),
    }).volatile().description('来源与路由'),
    fetching: z.object({
        order: z.array(z.string()).default([...DEFAULT_FETCH_ORDER]).description('抓取服务回退顺序'),
        allowPrivateNetwork: z.boolean().default(false).description('允许直接请求本机与内网地址'),
        minContentChars: z.natural().default(200).description('少于该字符数视为空内容'),
        preferRender: z.array(z.string()).default(['x.com', 'twitter.com', 'linkedin.com', 'instagram.com', 'facebook.com']).description('优先使用渲染型抓取服务的域名'),
    }).volatile().description('抓取'),
    rerank: z.object({
        mode: z.union(['rules', 'service', 'model']).default('rules').description('重排方式：规则 / 专用重排服务 / 决策模型'),
        url: z.string().default('https://api.jina.ai/v1/rerank').description('重排服务地址（Jina/Cohere 兼容）'),
        apiKey: z.string().role('credential-ref').default('JINA_API_KEY').description('重排服务凭据引用'),
        model: z.string().default('jina-reranker-v2-base-multilingual').description('重排模型'),
    }).volatile().description('结果重排'),
    decision: z.object({
        enabled: z.boolean().default(false).description('启用决策模型（如 Jev）'),
        provider: z.string().default('').description('模型供应商 ID（DSH 模型设置中的路由）'),
        model: z.string().default('').description('模型 ID'),
        reasoning: z.string().default('').description('思考强度 ID（可选）'),
        stages: z.array(z.union(['route', 'rerank', 'followup'])).default(['rerank', 'followup']).description('使用环节'),
        timeoutMs: z.natural().default(15000).description('单次判断超时（毫秒）'),
        keepThreshold: z.number().min(0).max(1).default(0.35).description('相关性低于该值的候选降权'),
        maxCandidates: z.natural().default(30).description('单批判断的候选数'),
    }).volatile().description('决策模型；关闭、超时或输出无效时回退到规则'),
    research: z.object({
        maxSubagents: z.natural().default(3).description('子智能体最大数量（提供给调用模型）'),
        maxRounds: z.natural().default(4).description('研究轮数上限'),
        maxPages: z.natural().default(30).description('总读页数上限'),
        timeMinutes: z.natural().default(30).description('研究总时长（分钟）'),
        maxCalls: z.natural().default(60).description('search/fetch 总调用次数上限'),
        modelInvocable: z.boolean().default(true).description('允许模型在用户明确要求深度研究时自行加载技能'),
    }).volatile().description('深度研究'),
    sources: sourcesSchema.volatile().description('搜索源与抓取服务'),
});
/** Top-level sections, every one volatile so the settings page can edit them and changes apply without a remount. */
export const SECTIONS = ['profile', 'tools', 'overrides', 'limits', 'routing', 'fetching', 'rerank', 'decision', 'research', 'sources'];
/** Read the current values out of the volatile references the loader hands to `apply` (plain objects pass through). */
export function snapshotConfig(raw) {
    const source = (raw ?? {});
    const out = {};
    for (const key of SECTIONS) {
        const value = source[key];
        out[key] = value && typeof value === 'object' && typeof value.get === 'function' ? structuredClone(value.get()) : value;
    }
    return out;
}
const defined = (value) => Object.fromEntries(Object.entries(value ?? {}).filter(([, v]) => v !== undefined && v !== null));
/** Merge order: per-call > user setting > preset; then clamp to hard limits. */
export function effectiveTuning(config, profile, call) {
    const base = PRESETS[profile ?? config.profile] ?? PRESETS.balanced;
    const merged = { ...base, ...defined(config.overrides), ...defined(call) };
    const l = config.limits;
    const clamp = (value, max, min = 0) => Math.max(min, Math.min(max, Math.floor(value)));
    return {
        ...merged,
        parallelSources: clamp(merged.parallelSources, l.maxParallelSources, 1),
        queryConcurrency: clamp(merged.queryConcurrency, 32, 1),
        perSourceResults: clamp(merged.perSourceResults, l.maxPerSourceResults, 1),
        followUpRounds: clamp(merged.followUpRounds, l.maxFollowUpRounds),
        requestTimeoutMs: clamp(merged.requestTimeoutMs, l.maxRequestTimeoutMs, 1000),
        callTimeoutMs: clamp(merged.callTimeoutMs, l.maxCallTimeoutMs, 2000),
        fetchConcurrency: clamp(merged.fetchConcurrency, 16, 1),
        fetchMaxChars: clamp(merged.fetchMaxChars, l.maxFetchChars, 500),
        fetchRetries: clamp(merged.fetchRetries, 3),
        fetchFallbacks: clamp(merged.fetchFallbacks, 12, 1),
        candidateLimit: clamp(merged.candidateLimit, 200, 1),
        returnResults: clamp(merged.returnResults, l.maxReturnResults, 1),
        outputTokens: clamp(merged.outputTokens, l.maxOutputTokens, 300),
        snippetChars: clamp(merged.snippetChars, 2000, 80),
        duplicateRatio: Math.max(0, Math.min(1, merged.duplicateRatio)),
    };
}
export function sourceSettings(config, id) {
    const spec = ALL_SPECS.find(s => s.id === id);
    const raw = config.sources[id] ?? {};
    return {
        enabled: raw.enabled ?? spec?.defaultEnabled ?? false,
        search: raw.search ?? true,
        fetch: raw.fetch ?? true,
        apiKey: raw.apiKey ?? spec?.credential ?? '',
        priority: raw.priority ?? spec?.priority ?? 50,
        baseURL: raw.baseURL ?? '',
        types: raw.types && raw.types.length ? raw.types : spec?.types ?? [],
        options: { ...(spec?.options ?? {}), ...(raw.options ?? {}) },
    };
}
