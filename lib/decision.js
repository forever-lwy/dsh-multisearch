/**
 * Optional decision model: batched judgements for source fit, candidate relevance and follow-up.
 *
 * Three backends:
 * - dsh: a DSH provider through `llm.stream` (wire protocol chosen by the DSH route, e.g. the
 *   openai route speaks `/v1/responses`). A general LLM is prompted to reply with JSON.
 * - openai: an OpenAI-compatible `POST …/chat/completions`. Same JSON-reply prompting.
 * - decisions: a decision API (OpenAI Decisions or System One, e.g. Jev, gpt-6-luna). Typed
 *   questions come back as probabilities and scores; no text is generated or parsed.
 *
 * Any failure — disabled, timeout, bad JSON — returns undefined and the caller falls back to rules;
 * items the model skipped stay unknown.
 */
import { BlockAssembler } from '@deepseek-ai/dsh-llm';
import { askDecisions } from './decisions-api.js';
import { http } from './http.js';
import { chatCompletionsUrl } from './presets.js';
export { chatCompletionsUrl };
/** 5-level scales; the decision API's score (a level position) is normalised to 0–1. */
const FIT_LEVELS = [
    { label: 'unsuitable', description: 'the source cannot serve this need' },
    { label: 'weak', description: 'only marginally useful for this need' },
    { label: 'possible', description: 'may return some relevant material' },
    { label: 'good', description: 'well suited to this need' },
    { label: 'ideal', description: 'the best kind of source for this need' },
];
const RELEVANCE_LEVELS = [
    { label: 'irrelevant', description: 'off topic' },
    { label: 'tangential', description: 'same broad topic, does not address the need' },
    { label: 'partial', description: 'addresses part of the need or misses a constraint' },
    { label: 'relevant', description: 'addresses the need' },
    { label: 'direct', description: 'directly answers the need and meets its constraints' },
];
export class DecisionModel {
    config;
    llm;
    resolveKey;
    constructor(config, llm, resolveKey = async () => undefined) {
        this.config = config;
        this.llm = llm;
        this.resolveKey = resolveKey;
    }
    /** Why the last call fell back, for the settings page test. */
    lastError = '';
    enabled(stage) {
        const d = this.config().decision;
        if (!d.enabled || !d.stages.includes(stage))
            return false;
        return this.configured() === undefined;
    }
    backend() {
        return (this.config().decision.backend ?? 'dsh');
    }
    /** Why the current backend cannot run, or undefined when it can. */
    configured() {
        const d = this.config().decision;
        if (d.model === '')
            return '未填写模型';
        const backend = this.backend();
        if (backend === 'dsh')
            return d.provider === '' ? '未选择供应商' : this.llm() ? undefined : 'DSH 模型服务不可用';
        return d.baseURL?.trim() ? undefined : '未填写接口地址';
    }
    /** Typed questions to a decision API; undefined (with lastError set) on any failure. */
    async decide(state, questions, signal) {
        const d = this.config().decision;
        this.lastError = '';
        try {
            const apiKey = d.apiKey ? await this.resolveKey(d.apiKey) : undefined;
            const answers = await askDecisions({
                protocol: (d.protocol ?? 'openai'), baseURL: d.baseURL, model: d.model, ...(apiKey ? { apiKey } : {}),
                timeoutMs: d.timeoutMs, signal: AbortSignal.any([signal, AbortSignal.timeout(d.timeoutMs)]),
            }, state, questions);
            if (answers.size === 0) {
                this.lastError = '决策接口没有返回可用的答案';
                return undefined;
            }
            return answers;
        }
        catch (error) {
            this.lastError = error instanceof Error ? error.message : String(error);
            return undefined;
        }
    }
    async ask(system, user, signal) {
        const d = this.config().decision;
        this.lastError = '';
        if ((d.backend ?? 'dsh') === 'openai')
            return this.askOpenAI(system, user, signal);
        const llm = this.llm();
        if (!llm)
            return undefined;
        const local = AbortSignal.any([signal, AbortSignal.timeout(d.timeoutMs)]);
        const assembler = new BlockAssembler();
        try {
            for await (const chunk of llm.stream({
                provider: d.provider, model: d.model, ...(d.reasoning ? { reasoningEffort: d.reasoning } : {}),
                system, messages: [{ role: 'user', content: [{ type: 'text', text: user }] }], signal: local,
            })) {
                assembler.push(chunk);
                if (chunk?.type === 'finish' && (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted')) {
                    this.lastError = chunk.reason.kind === 'aborted' ? '已中止或超时' : String(chunk.reason.error?.message ?? chunk.reason.message ?? '模型返回错误');
                    return undefined;
                }
            }
        }
        catch (error) {
            this.lastError = error instanceof Error ? error.message : String(error);
            return undefined;
        }
        const text = assembler.blocks().filter((block) => block.type === 'text').map((block) => block.text).join('');
        const parsed = parseJson(text);
        if (parsed === undefined)
            this.lastError = `未返回 JSON：${text.slice(0, 120)}`;
        return parsed;
    }
    /** A provider configured only for this plugin: plain OpenAI-compatible chat completions. */
    async askOpenAI(system, user, signal) {
        const d = this.config().decision;
        try {
            const key = d.apiKey ? await this.resolveKey(d.apiKey) : undefined;
            const data = await http.json(chatCompletionsUrl(d.baseURL), {
                body: {
                    model: d.model, temperature: 0, stream: false,
                    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
                    ...(d.reasoning ? { reasoning_effort: d.reasoning } : {}),
                },
                headers: key ? { authorization: `Bearer ${key}` } : {}, signal, timeoutMs: d.timeoutMs,
            });
            const content = data?.choices?.[0]?.message?.content;
            const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((part) => part?.text ?? '').join('') : '';
            const parsed = parseJson(text);
            if (parsed === undefined)
                this.lastError = `未返回 JSON：${text.slice(0, 120)}`;
            return parsed;
        }
        catch (error) {
            this.lastError = error instanceof Error ? error.message : String(error);
            return undefined;
        }
    }
    /** One small judgement to check the configured backend end to end (settings page "test"). */
    async probe(signal) {
        const started = Date.now();
        const problem = this.configured();
        if (problem)
            return { ok: false, detail: problem, ms: 0 };
        if (this.backend() === 'decisions') {
            const answers = await this.decide({ statement: 'Paris is the capital of France.' }, [
                { id: 'ok', type: 'bool', instructions: 'Is the statement true?', true: 'the statement is true', false: 'the statement is false' },
            ], signal);
            const p = answers?.get('ok');
            if (typeof p !== 'number')
                return { ok: false, detail: this.lastError || '决策接口没有回答测试问题', ms: Date.now() - started };
            return p >= 0.5 ? { ok: true, detail: `决策接口返回 P(true)=${p.toFixed(2)}`, ms: Date.now() - started }
                : { ok: false, detail: `决策接口回答异常：P(true)=${p.toFixed(2)}，应接近 1`, ms: Date.now() - started };
        }
        const out = await this.ask('Reply with JSON only: {"ok":true}.', 'Health check.', signal);
        return out?.ok === true ? { ok: true, detail: '模型按提示输出了有效 JSON', ms: Date.now() - started }
            : { ok: false, detail: out === undefined ? this.lastError || '调用失败、超时或未返回 JSON' : '返回内容不符合要求', ms: Date.now() - started };
    }
    /** Semantic fit 0–1 of each candidate source for the need. */
    async routeScores(need, specs, signal) {
        if (!this.enabled('route') || specs.length === 0)
            return undefined;
        if (this.backend() === 'decisions') {
            const ids = specs.map((spec, i) => [`s${i + 1}`, spec]);
            const answers = await this.decide({
                need: needState(need),
                sources: ids.map(([id, spec]) => ({ id, source: spec.id, description: spec.blurb, types: spec.types })),
            }, ids.map(([id, spec]) => ({ id, type: 'score', instructions: `How well does source ${id} (${spec.id}) fit the search need?`, levels: FIT_LEVELS })), signal);
            return answers ? numberMap(Object.fromEntries(ids.map(([id, spec]) => [spec.id, answers.get(id)])), new Set(specs.map(s => s.id))) : undefined;
        }
        const list = specs.map(spec => `- ${spec.id}: ${spec.blurb} [types: ${spec.types.join(', ')}]`).join('\n');
        const out = await this.ask('You route web searches to sources. Reply with JSON only: {"scores":{"<sourceId>":0.0-1.0}}. Score how well each source fits the need; omit sources you cannot judge.', `Need:\n${describeNeed(need)}\n\nSources:\n${list}`, signal);
        return numberMap(out?.scores, new Set(specs.map(spec => spec.id)));
    }
    /** Relevance 0–1 per candidate key, judged in one batch. */
    async relevance(need, candidates, signal) {
        if (!this.enabled('rerank') || candidates.length === 0)
            return undefined;
        const batch = candidates.slice(0, this.config().decision.maxCandidates);
        const ids = new Map(batch.map((c, i) => [`c${i + 1}`, c.key]));
        if (this.backend() === 'decisions') {
            const answers = await this.decide({
                need: needState(need),
                candidates: batch.map((c, i) => ({ id: `c${i + 1}`, title: c.title, url: c.url, ...(c.publishedAt ? { published: c.publishedAt } : {}), snippet: c.snippet.slice(0, 300) })),
            }, [...ids.keys()].map(id => ({
                id, type: 'score', levels: RELEVANCE_LEVELS,
                instructions: `How relevant is candidate ${id} to the search need? Evidence against the claim in question still counts as relevant.`,
            })), signal);
            if (!answers)
                return undefined;
            const scores = numberMap(Object.fromEntries(answers), new Set(ids.keys()));
            return scores ? new Map([...scores].map(([id, score]) => [ids.get(id), score])) : undefined;
        }
        const list = batch.map((c, i) => `c${i + 1}. ${c.title} | ${c.url}${c.publishedAt ? ` | ${c.publishedAt}` : ''}\n   ${c.snippet.slice(0, 300)}`).join('\n');
        const out = await this.ask('You judge search results. Reply with JSON only: {"relevance":{"c1":0.0-1.0,...}}. 1 = directly answers the need and meets its constraints; keep counter-evidence relevant; omit items you cannot judge.', `Need:\n${describeNeed(need)}\n\nCandidates:\n${list}`, signal);
        const scores = numberMap(out?.relevance, new Set(ids.keys()));
        if (!scores)
            return undefined;
        return new Map([...scores].map(([id, score]) => [ids.get(id), score]));
    }
    async followUp(need, summary, untried, signal) {
        if (!this.enabled('followup'))
            return undefined;
        if (this.backend() === 'decisions') {
            // A decision API answers with probabilities only: it can say whether to continue and which
            // sources to try, but proposes no new queries (follow-up keeps the rule-based alternatives).
            const ids = untried.map((spec, i) => [`t${i + 1}`, spec]);
            const answers = await this.decide({
                need: needState(need), current_results: summary,
                untried_sources: ids.map(([id, spec]) => ({ id, source: spec.id, description: spec.blurb })),
            }, [
                { id: 'continue', type: 'bool', instructions: 'Do the current results leave the search need insufficiently covered, so that searching more sources is worthwhile?', true: 'more material is needed', false: 'the current results are enough' },
                ...ids.map(([id, spec]) => ({ id, type: 'bool', instructions: `Would untried source ${id} (${spec.id}) likely add material the current results are missing?`, true: 'likely adds missing material', false: 'unlikely to help' })),
            ], signal);
            const p = answers?.get('continue');
            if (typeof p !== 'number')
                return undefined;
            const ranked = ids.map(([id, spec]) => [spec.id, answers.get(id)])
                .filter((entry) => typeof entry[1] === 'number' && entry[1] >= 0.5)
                .sort((a, b) => b[1] - a[1]);
            return { continue: p >= 0.5, reason: `决策接口：需要补搜的概率 ${p.toFixed(2)}`, trySources: ranked.map(([id]) => id), queries: [] };
        }
        const out = await this.ask('You decide whether a web search needs more material. Reply with JSON only: {"continue":true|false,"reason":"...","try_sources":["id"],"queries":["..."]}. Suggest only listed sources; queries must stay within the original need.', `Need:\n${describeNeed(need)}\n\nCurrent results:\n${summary}\n\nUntried sources:\n${untried.map(s => `- ${s.id}: ${s.blurb}`).join('\n') || '(none)'}`, signal);
        if (!out || typeof out.continue !== 'boolean')
            return undefined;
        const allowed = new Set(untried.map(s => s.id));
        return {
            continue: out.continue, reason: typeof out.reason === 'string' ? out.reason.slice(0, 300) : '',
            trySources: Array.isArray(out.try_sources) ? out.try_sources.filter((id) => typeof id === 'string' && allowed.has(id)) : [],
            queries: Array.isArray(out.queries) ? out.queries.filter((q) => typeof q === 'string' && q.trim()).slice(0, 3) : [],
        };
    }
}
export function describeNeed(need) {
    return [
        `queries: ${need.queries.join(' | ')}`, need.goal ? `goal: ${need.goal}` : '', need.types.length ? `types: ${need.types.join(', ')}` : '',
        need.preferOfficial ? 'prefer official sources' : '', need.sites.length ? `sites: ${need.sites.join(', ')}` : '',
        need.timeRange ? `time: past ${need.timeRange}` : '', need.after ? `after: ${need.after}` : '', need.before ? `before: ${need.before}` : '',
        need.version ? `version: ${need.version}` : '', need.language ? `language: ${need.language}` : '', need.region ? `region: ${need.region}` : '',
    ].filter(Boolean).join('\n');
}
/** The need as structured state for a decision API. */
function needState(need) {
    const out = { queries: need.queries };
    if (need.goal)
        out.goal = need.goal;
    if (need.types.length)
        out.types = need.types;
    if (need.preferOfficial)
        out.prefer_official = true;
    if (need.sites.length)
        out.sites = need.sites;
    for (const key of ['timeRange', 'after', 'before', 'version', 'language', 'region'])
        if (need[key])
            out[key] = need[key];
    return out;
}
export function parseJson(text) {
    const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text;
    const start = fenced.indexOf('{');
    const end = fenced.lastIndexOf('}');
    if (start < 0 || end <= start)
        return undefined;
    try {
        return JSON.parse(fenced.slice(start, end + 1));
    }
    catch {
        return undefined;
    }
}
function numberMap(value, allowed) {
    if (!value || typeof value !== 'object')
        return undefined;
    const out = new Map();
    for (const [key, score] of Object.entries(value)) {
        if (allowed.has(key) && typeof score === 'number' && Number.isFinite(score))
            out.set(key, Math.max(0, Math.min(1, score)));
    }
    return out.size ? out : undefined;
}
