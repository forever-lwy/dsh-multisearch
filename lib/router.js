import { isCjk } from './sources/util.js';
const SITE_TYPES = [
    [/github\.com|gitlab\.com|stackoverflow\.com|npmjs\.com|pypi\.org|crates\.io/, 'code'],
    [/arxiv\.org|doi\.org|pubmed|semanticscholar|openreview|acm\.org|ieee\.org|nature\.com|sciencedirect/, 'academic'],
    [/reddit\.com|news\.ycombinator\.com|v2ex\.com|zhihu\.com/, 'community'],
    [/(^|\.)x\.com|twitter\.com|weibo\.com|bsky\.app/, 'social'],
    [/huggingface\.co/, 'ai-models'],
    [/docs\.|developer\.|readthedocs|\.dev\/docs|learn\.microsoft\.com|developer\.mozilla\.org/, 'documentation'],
    [/\.gov(\.|$)|gov\.cn/, 'government'],
    [/\.cn$|\.com\.cn$|baidu\.com|qq\.com|163\.com|sina\.com|weixin\.qq\.com/, 'chinese'],
];
const KEYWORD_TYPES = [
    [/\b(api|sdk|docs?|documentation|reference|config(uration)?|install|migration|upgrade|error|exception|typeerror|deprecated)\b|文档|配置|报错|升级|迁移|用法/i, 'documentation'],
    [/\b(paper|study|studies|trial|meta-analysis|evidence|arxiv|journal|peer[- ]reviewed)\b|论文|研究表明|文献|综述/i, 'academic'],
    [/\b(reddit|subreddit|discussions?|opinions?|experiences?|community|think of|thoughts on|worth it|people say)\b|讨论|口碑|体验|社区|怎么看|评价/i, 'community'],
    [/\b(tweet|twitter|x\.com|thread)\b|推文|推特/i, 'social'],
    [/\b(news|latest|today|announced|breaking)\b|新闻|最新|今日|发布会/i, 'news'],
    [/\b(stock|earnings|revenue|market cap|ipo|financial)\b|股价|财报|营收|市值/i, 'finance'],
    [/\b(model card|checkpoint|dataset|fine-?tun|gguf|lora)\b|数据集|模型权重/i, 'ai-models'],
    [/\b(github|repo|repository|library|package|npm|pip)\b|源码|开源/i, 'code'],
];
/** Types implied by sites and wording when the caller gave none. */
export function inferTypes(need) {
    const out = new Set();
    for (const site of need.sites)
        for (const [pattern, type] of SITE_TYPES)
            if (pattern.test(site.toLowerCase()))
                out.add(type);
    const text = [need.goal ?? '', ...need.queries].join(' ');
    for (const [pattern, type] of KEYWORD_TYPES)
        if (pattern.test(text))
            out.add(type);
    if (isCjk(text) || need.region?.toLowerCase() === 'cn' || need.language?.toLowerCase().startsWith('zh'))
        out.add('chinese');
    return [...out];
}
function scoreSource(source, need, wanted, inferred, config, semantic) {
    const reasons = [];
    let score = source.settings.priority;
    const types = source.settings.types;
    const requested = wanted.filter(type => types.includes(type));
    if (requested.length) {
        score += 45 * requested.length;
        reasons.push(`类型:${requested.join('/')}`);
    }
    else if (wanted.length && !types.includes('web'))
        score -= 40;
    const hinted = inferred.filter(type => types.includes(type) && !wanted.includes(type));
    if (hinted.length) {
        score += 18 * hinted.length;
        reasons.push(`线索:${hinted.join('/')}`);
    }
    if (need.preferOfficial && types.includes('documentation')) {
        score += 15;
        reasons.push('官方文档');
    }
    if (need.sites.length && source.spec.filters.site)
        score += 8;
    if ((need.timeRange || need.after) && source.spec.filters.time)
        score += 6;
    if (types.includes('answer') && !wanted.includes('answer'))
        score -= 12;
    const text = [need.goal ?? '', ...need.queries].join(' ').toLowerCase();
    for (const rule of config.routing.rules) {
        if (!rule.sources.includes(source.spec.id))
            continue;
        const hit = rule.types.some(type => wanted.includes(type) || inferred.includes(type))
            || rule.keywords.some(keyword => keyword && text.includes(keyword.toLowerCase()))
            || rule.sites.some(site => need.sites.some(s => s.includes(site)));
        if (hit) {
            score += rule.boost;
            reasons.push(`规则:${rule.name || '自定义'}`);
        }
    }
    if (semantic !== undefined) {
        score += Math.round((semantic - 0.5) * 60);
        reasons.push(`语义:${semantic.toFixed(2)}`);
    }
    return { id: source.spec.id, score, reasons };
}
/** Greedy pick of complementary sources: penalize a shared engine and fully overlapping types. */
function pickComplementary(scored, sources, count, penalty) {
    const pool = [...scored];
    const chosen = [];
    while (chosen.length < count && pool.length) {
        let bestIndex = 0;
        let bestValue = -Infinity;
        pool.forEach((choice, index) => {
            const source = sources.get(choice.id);
            let value = choice.score;
            for (const picked of chosen) {
                const other = sources.get(picked.id);
                if (other.spec.engine === source.spec.engine)
                    value -= penalty;
                const overlap = source.settings.types.filter(type => other.settings.types.includes(type)).length / Math.max(1, source.settings.types.length);
                value -= overlap * 10;
            }
            if (value > bestValue) {
                bestValue = value;
                bestIndex = index;
            }
        });
        chosen.push(pool.splice(bestIndex, 1)[0]);
    }
    return { chosen, reserve: pool.sort((a, b) => b.score - a.score) };
}
export function planRoute(input) {
    const { need, explicit, config, count } = input;
    const byId = new Map(input.sources.map(source => [source.spec.id, source]));
    const searchable = input.sources.filter(source => source.spec.caps.search && source.settings.enabled && source.usable
        && !(source.spec.needs === 'subreddit' && !need.sites.some(site => /reddit\.com\/r\//i.test(site))));
    const inferred = inferTypes(need);
    const unavailable = [];
    if (explicit.length) {
        const chosen = [];
        for (const id of explicit) {
            const source = byId.get(id);
            if (!source || !source.spec.caps.search)
                unavailable.push({ id, reason: source ? '不支持搜索' : '未知来源' });
            else if (!source.settings.enabled)
                unavailable.push({ id, reason: '已停用' });
            else if (!source.usable)
                unavailable.push({ id, reason: source.reason ?? '缺少凭据' });
            else
                chosen.push({ id, score: source.settings.priority, reasons: ['调用方指定'] });
        }
        return { mode: 'explicit', chosen, reserve: [], unavailable, inferredTypes: inferred };
    }
    const scored = searchable.map(source => scoreSource(source, need, need.types, inferred, config, input.semantic?.get(source.spec.id))).sort((a, b) => b.score - a.score);
    const informative = config.routing.autoRoute && (need.types.length > 0 || inferred.some(type => type !== 'chinese') || need.preferOfficial || (input.semantic?.size ?? 0) > 0);
    if (informative) {
        const { chosen, reserve } = pickComplementary(scored, byId, count, config.routing.overlapPenalty);
        return { mode: 'rules', chosen, reserve, unavailable, inferredTypes: inferred };
    }
    // Default combination: configured order first, then remaining by score.
    const defaults = config.routing.defaultSources.map(id => scored.find(choice => choice.id === id)).filter((c) => c !== undefined);
    if (inferred.includes('chinese')) {
        const cn = scored.filter(choice => byId.get(choice.id).settings.types.includes('chinese'));
        for (const choice of cn.reverse())
            if (!defaults.includes(choice))
                defaults.unshift(choice);
    }
    // Filling up the default combination only uses general-purpose web sources, never a specialist.
    const general = scored.filter(choice => !defaults.includes(choice) && byId.get(choice.id).settings.types.includes('web') && !byId.get(choice.id).settings.types.includes('answer'));
    const ordered = [...defaults, ...general];
    const { chosen, reserve } = pickComplementary(ordered.map((choice, index) => ({ ...choice, score: 1000 - index * 10, reasons: [...choice.reasons, '默认组合'] })), byId, count, config.routing.overlapPenalty);
    return { mode: 'default', chosen, reserve, unavailable, inferredTypes: inferred };
}
