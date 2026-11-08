/** The deep-research skill: research workflow instructions, with this deployment's budgets filled in. */
import type { Config } from './config.js'

export const SKILL_NAME = 'deep-research'

export function skillContent(config: Config): string {
  const r = config.research
  const s = config.tools.searchName || 'search'
  const f = config.tools.fetchName || 'fetch'
  return `# Deep research

Use this workflow only because the user explicitly asked for deep research (or enabled it). Ordinary questions should use \`${s}\` / \`${f}\` directly.

## Budget (set by the user in the search plugin; do not exceed)

- Sub-agents: at most **${r.maxSubagents}** running research directions at once. Decide the actual number from the task; 0 is fine for narrow questions.
- Research rounds: at most **${r.maxRounds}** (one round = plan → search/read → gap check).
- Pages read with \`${f}\`: at most **${r.maxPages}** in total across all agents.
- \`${s}\` + \`${f}\` calls: at most **${r.maxCalls}** in total.
- Wall time: about **${r.timeMinutes} minutes**.

You (the main model) own this budget: split it across directions up front, track what each direction spent, and stop early when the question is answered. When a limit is reached, finish with what you have and say what is missing.

## 1. Clarify the goal

- Restate the research question, the hard constraints (time range, region, version, sources that must or must not count) and what evidence would settle it (primary documents, data, peer-reviewed studies, official statements…).
- If a constraint that changes the answer is ambiguous and the user is reachable, ask once; otherwise state your assumption.
- Turn the question into 2–${Math.max(2, r.maxSubagents + 1)} research directions, each with its own sub-question and starting queries (vary wording and language).

## 2. Assign the work

- If sub-agents are available, give each direction to one sub-agent with: the sub-question, scope and exclusions, its share of the call/page budget, and the deliverable format below. Tell it to use \`${s}\` with structured fields (goal, source_types, prefer_official, sites, time_range, version, alt_queries) and \`${f}\` with reference ids.
- Sub-agents share the parent task's search memory: reference ids (S1, S2…) and already-read pages are reused, so tell them which ids are already covered.
- Without sub-agent support, run the directions yourself, one after another.

## 3. Search and verify

- Start broad with \`${s}\` (profile "balanced"; use "deep" for hard directions), then read the key originals with \`${f}\` — prefer \`keywords\` to pull the relevant sections, and \`offset\` to continue long documents. One \`${f}\` call shares a size budget across its pages, so read a few pages per call; a page marked unfinished continues from cache with \`offset\`.
- Treat "service-generated overview" text as leads, never as evidence. Every claim in the final answer needs a source you actually read or a search snippet you mark as unverified.
- Prefer primary and official sources; record dates and versions; keep counter-evidence and disagreements instead of discarding them.
- Use \`${s}\` \`more\` to see remaining candidates before running new searches.

## 4. Check gaps

After each round, list: which sub-questions are answered, which conflicts remain, and what the tools' follow-up suggestions say (missing types, untried sources, alternative queries). Then decide: adjust queries, target specific sources/sites, read more originals, or stop. Stop when the answer is supported, when new material repeats what you have, or when the budget is spent.

## 5. Synthesize

Each sub-agent returns, concisely:
- findings as short claims, each with source URL(s), date/version, and confidence;
- conflicts and how they differ (time, version, conditions);
- open questions and what was tried.

You merge these into the final answer: lead with the conclusion, then the supporting evidence by theme, then disagreements and limits. Cite URLs as markdown links. Report how much of the budget was used.
`
}

export const skillDescription = (config: Config) =>
  `Multi-step deep research with ${config.tools.searchName || 'search'}/${config.tools.fetchName || 'fetch'}: plan directions, split work across up to ${config.research.maxSubagents} sub-agents, verify sources, check gaps and synthesize.`

export const skillWhenToUse = 'Only when the user explicitly asks for deep research / a thorough investigation, or enables this skill. Not for ordinary lookups.'

/** In-memory registration, used in builtin mode or when the skill file cannot be written. */
export function registerSkill(ctx: any, config: Config): () => void {
  if (!ctx.skills?.register) return () => {}
  return ctx.skills.register({
    name: SKILL_NAME,
    description: skillDescription(config),
    whenToUse: skillWhenToUse,
    source: 'runtime',
    content: skillContent(config),
    invocation: { modelInvocable: config.research.modelInvocable, userInvocable: true },
  })
}
