/**
 * Optional decision model (e.g. Jev): batched structured judgements for source fit, candidate
 * relevance and follow-up. Any failure — disabled, timeout, bad JSON — returns undefined and the
 * caller falls back to rules; items the model skipped stay unknown.
 */
import { BlockAssembler } from '@deepseek-ai/dsh-llm';
export class DecisionModel {
    config;
    llm;
    constructor(config, llm) {
        this.config = config;
        this.llm = llm;
    }
    enabled(stage) {
        const d = this.config().decision;
        return d.enabled && d.provider !== '' && d.model !== '' && d.stages.includes(stage) && this.llm() !== undefined;
    }
    async ask(system, user, signal) {
        const d = this.config().decision;
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
                if (chunk?.type === 'finish' && (chunk.reason?.kind === 'error' || chunk.reason?.kind === 'aborted'))
                    return undefined;
            }
        }
        catch {
            return undefined;
        }
        const text = assembler.blocks().filter((block) => block.type === 'text').map((block) => block.text).join('');
        return parseJson(text);
    }
    /** Semantic fit 0–1 of each candidate source for the need. */
    async routeScores(need, specs, signal) {
        if (!this.enabled('route') || specs.length === 0)
            return undefined;
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
