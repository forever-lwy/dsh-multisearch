import { findVersion, hostOf, jaccard, matchesSite, parseDate, shingles, tokens, urlKey } from './text.js';
const pickLonger = (a, b) => (b && (!a || b.length > a.length) ? b : a);
/** Normalize and merge; identical pages collapse by URL key, near-identical text by shingle overlap. */
export function mergeHits(lists, existing = new Map()) {
    const candidates = existing;
    let raw = 0;
    let collapsed = 0;
    for (const list of lists) {
        list.hits.forEach((hit, rank) => {
            raw++;
            const key = urlKey(hit.url);
            let candidate = candidates.get(key);
            if (candidate)
                collapsed++;
            else {
                candidate = {
                    key, url: hit.url, title: hit.title ?? hostOf(hit.url), snippet: hit.snippet ?? '', content: hit.content,
                    publishedAt: hit.publishedAt, ranks: new Map(), queries: new Set(), alsoAt: [], meta: {}, score: 0, flags: new Set(),
                };
                candidates.set(key, candidate);
            }
            const ranks = candidate.ranks.get(list.source) ?? [];
            ranks.push(rank);
            candidate.ranks.set(list.source, ranks);
            candidate.queries.add(list.query);
            if (hit.title?.trim() && (!candidate.title || candidate.title === hostOf(candidate.url)))
                candidate.title = hit.title;
            candidate.snippet = pickLonger(candidate.snippet, hit.snippet) ?? '';
            candidate.content = pickLonger(candidate.content, hit.content);
            candidate.publishedAt ??= hit.publishedAt;
            Object.assign(candidate.meta, hit.meta ?? {});
        });
    }
    collapseReprints(candidates);
    return { candidates, stats: { rawHits: raw, unique: candidates.size, duplicateRatio: raw === 0 ? 0 : collapsed / raw } };
}
/** Reprints: different URLs, same title and near-identical text. Keep the earliest or best-ranked as the original. */
function collapseReprints(candidates) {
    const list = [...candidates.values()];
    const prints = new Map(list.map(c => [c.key, shingles(`${c.title} ${c.snippet}`)]));
    for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!candidates.has(a.key))
            continue;
        for (let j = i + 1; j < list.length; j++) {
            const b = list[j];
            if (!candidates.has(b.key) || hostOf(a.url) === hostOf(b.url))
                continue;
            const sameTitle = a.title.trim().toLowerCase() === b.title.trim().toLowerCase() && a.title.length > 12;
            const pa = prints.get(a.key);
            const pb = prints.get(b.key);
            // Short texts look alike by accident; require enough material to call it a copy.
            if (Math.min(pa.size, pb.size) < 6)
                continue;
            const similarity = jaccard(pa, pb);
            if (!(sameTitle && similarity > 0.5) && similarity < 0.85)
                continue;
            // Distinct dates or versions are substantive differences: keep both.
            const va = findVersion(`${a.title} ${a.snippet}`);
            const vb = findVersion(`${b.title} ${b.snippet}`);
            if (va && vb && va !== vb)
                continue;
            const da = parseDate(a.publishedAt);
            const db = parseDate(b.publishedAt);
            if (da && db && Math.abs(da - db) > 30 * 86_400_000)
                continue;
            const [keep, drop] = (da && db ? da <= db : bestRank(a) <= bestRank(b)) ? [a, b] : [b, a];
            for (const [source, ranks] of drop.ranks)
                keep.ranks.set(source, [...(keep.ranks.get(source) ?? []), ...ranks]);
            for (const query of drop.queries)
                keep.queries.add(query);
            keep.alsoAt.push(drop.url, ...drop.alsoAt);
            keep.snippet = pickLonger(keep.snippet, drop.snippet) ?? '';
            candidates.delete(drop.key);
        }
    }
}
const bestRank = (c) => Math.min(...[...c.ranks.values()].flat());
/** Reciprocal rank fusion across every (source, query) list the candidate appeared in. */
export function fuse(candidates, weights, k = 60) {
    for (const candidate of candidates) {
        let score = 0;
        for (const [source, ranks] of candidate.ranks) {
            const weight = weights.get(source) ?? 1;
            for (const rank of ranks)
                score += weight / (k + rank + 1);
        }
        candidate.score = score;
    }
}
const RERANK_FLAGS = ['off-site', 'date-unknown', 'out-of-range', 'other-version', 'low-relevance', 'official'];
const OFFICIAL_LABELS = new Set(['docs', 'doc', 'developer', 'developers', 'dev', 'learn', 'support', 'help', 'api', 'reference']);
const OFFICIAL_SUFFIX = /readthedocs\.io$|\.gov(\.[a-z]{2})?$|\.edu(\.[a-z]{2})?$|gov\.cn$/;
/** A docs-style subdomain of some site (docs.python.org), not a domain that merely starts with one (dev.to). */
const looksOfficial = (host) => OFFICIAL_SUFFIX.test(host) || (host.split('.').length >= 3 && OFFICIAL_LABELS.has(host.split('.')[0]));
/** Relevance, hard constraints, credibility, freshness, completeness — applied on top of the fused score. */
export function rerank(candidates, ctx) {
    const { need } = ctx;
    const queryTokens = new Set(tokens([need.goal ?? '', ...need.queries].join(' ')));
    const brandTokens = [...queryTokens].filter(token => /^[a-z][a-z0-9-]{2,}$/.test(token));
    const after = parseDate(need.after) ?? (need.timeRange ? Date.now() - { day: 1, week: 7, month: 31, year: 366 }[need.timeRange] * 86_400_000 : undefined);
    const before = parseDate(need.before);
    const maxFused = Math.max(1e-9, ...candidates.map(c => c.score));
    const kept = [];
    for (const c of candidates) {
        for (const flag of RERANK_FLAGS)
            c.flags.delete(flag);
        const host = hostOf(c.url);
        if (need.excludeSites.some(site => matchesSite(c.url, site)))
            continue;
        let factor = 1;
        // Hard constraints.
        if (need.sites.length && !need.sites.some(site => matchesSite(c.url, site)) && !c.alsoAt.some(url => need.sites.some(site => matchesSite(url, site)))) {
            factor *= 0.35;
            c.flags.add('off-site');
        }
        const date = parseDate(c.publishedAt);
        if (after !== undefined || before !== undefined) {
            if (date === undefined)
                c.flags.add('date-unknown');
            else if ((after !== undefined && date < after - 86_400_000) || (before !== undefined && date > before + 86_400_000)) {
                factor *= 0.25;
                c.flags.add('out-of-range');
            }
        }
        const text = `${c.title} ${c.snippet}`;
        if (need.version) {
            const found = findVersion(text);
            if (text.includes(need.version))
                factor *= 1.25;
            else if (found && !need.version.startsWith(found) && !found.startsWith(need.version)) {
                factor *= 0.6;
                c.flags.add('other-version');
            }
        }
        c.version = findVersion(text);
        // Lexical relevance.
        const docTokens = new Set(tokens(text));
        let overlap = 0;
        for (const token of queryTokens)
            if (docTokens.has(token))
                overlap++;
        const lexical = queryTokens.size ? overlap / queryTokens.size : 0.5;
        const external = ctx.relevance?.get(c.key);
        const relevance = external ?? lexical;
        c.relevance = relevance;
        if (external !== undefined && external < ctx.keepThreshold) {
            factor *= 0.4;
            c.flags.add('low-relevance');
        }
        // Credibility and source type.
        const official = looksOfficial(host) || ctx.officialDomains.some(domain => matchesSite(c.url, domain))
            || brandTokens.some(token => host.split('.').slice(0, -1).includes(token));
        if (official) {
            c.flags.add('official');
            if (need.preferOfficial)
                factor *= 1.35;
        }
        if (c.flags.has('official') && need.types.includes('documentation'))
            factor *= 1.1;
        // Freshness when recency was requested.
        if (after !== undefined && date !== undefined && date >= after)
            factor *= 1.1;
        // Completeness.
        const length = (c.content?.length ?? 0) + c.snippet.length;
        factor *= length < 60 ? 0.8 : length > 400 ? 1.05 : 1;
        // Agreement across sources.
        factor *= 1 + Math.min(0.3, (c.ranks.size - 1) * 0.1);
        c.score = (0.55 * (c.score / maxFused) + 0.45 * relevance) * factor;
        kept.push(c);
    }
    return kept.sort((a, b) => b.score - a.score);
}
/** Diversity pass: prefer new information over another copy of the same point. */
export function diversify(ranked, limit) {
    const out = [];
    const prints = [];
    const perHost = new Map();
    const rest = [...ranked];
    while (out.length < limit && rest.length) {
        let bestIndex = 0;
        let bestValue = -Infinity;
        for (let i = 0; i < Math.min(rest.length, limit * 3); i++) {
            const c = rest[i];
            const print = shingles(`${c.title} ${c.snippet}`, 3);
            const similarity = prints.reduce((max, p) => Math.max(max, jaccard(p, print)), 0);
            const sameHost = perHost.get(hostOf(c.url)) ?? 0;
            const value = c.score * (1 - 0.6 * similarity) * (sameHost >= 2 ? 0.7 : 1);
            if (value > bestValue) {
                bestValue = value;
                bestIndex = i;
            }
        }
        const [picked] = rest.splice(bestIndex, 1);
        out.push(picked);
        prints.push(shingles(`${picked.title} ${picked.snippet}`, 3));
        perHost.set(hostOf(picked.url), (perHost.get(hostOf(picked.url)) ?? 0) + 1);
    }
    return out;
}
