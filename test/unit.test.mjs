import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Config, PRESETS, effectiveTuning, planRoute, inferTypes, mergeHits, fuse, rerank, keywordExcerpt, rangeExcerpt, urlKey, skillContent } from '../lib/index.js'
import { ALL_SPECS, snapshotConfig, sourceSettings } from '../lib/config.js'

const parsed = (input = {}) => snapshotConfig(Config(input))
const need = (over = {}) => ({ queries: ['q'], altQueries: [], types: [], preferOfficial: false, sites: [], excludeSites: [], ...over })

test('config schema fills every default and source section', () => {
  const config = parsed()
  assert.equal(config.profile, 'balanced')
  assert.equal(config.tools.searchName, 'search')
  assert.equal(config.research.maxSubagents, 3)
  for (const spec of ALL_SPECS) assert.ok(config.sources[spec.id], spec.id)
  assert.equal(config.sources.keenable.enabled, true)
  assert.equal(config.sources.exa.enabled, false)
  assert.equal(config.sources.exa.apiKey, 'EXA_API_KEY')
  assert.deepEqual(sourceSettings(config, 'exa').types, ['web', 'documentation', 'code', 'academic', 'company', 'news'])
})

test('tuning precedence: call > user setting > preset, clamped by hard limits', () => {
  const config = parsed({ overrides: { returnResults: 10, outputTokens: 5000 }, limits: { maxReturnResults: 12 } })
  const t = effectiveTuning(config, 'balanced', { returnResults: 50 })
  assert.equal(t.returnResults, 12, 'clamped to hard limit')
  assert.equal(t.outputTokens, 5000, 'user setting over preset')
  assert.equal(t.parallelSources, PRESETS.balanced.parallelSources, 'preset default')
  assert.equal(effectiveTuning(config, 'deep', {}).parallelSources, PRESETS.deep.parallelSources)
  assert.equal(PRESETS.balanced.parallelSources, 2)
  assert.equal(PRESETS.balanced.outputTokens, 4000)
})

test('urlKey collapses tracking params, www, fragments and twitter/x', () => {
  assert.equal(urlKey('https://www.Example.com/a/?utm_source=x&b=2&a=1#top'), urlKey('http://example.com/a?a=1&b=2'))
  assert.equal(urlKey('https://twitter.com/u/status/1'), urlKey('https://x.com/u/status/1'))
  assert.notEqual(urlKey('https://example.com/a?id=1'), urlKey('https://example.com/a?id=2'))
})

test('inferTypes reads sites, wording and CJK', () => {
  assert.deepEqual(new Set(inferTypes(need({ queries: ['react useEffect cleanup docs'] }))), new Set(['documentation']))
  assert.ok(inferTypes(need({ sites: ['arxiv.org'] })).includes('academic'))
  assert.ok(inferTypes(need({ queries: ['大模型 推理 优化'] })).includes('chinese'))
  assert.ok(inferTypes(need({ queries: ['what does reddit think of x'] })).includes('community'))
})

function routable(config, ids, usable = () => true) {
  return ALL_SPECS.map(spec => ({ spec, settings: { ...sourceSettings(config, spec.id), enabled: ids.includes(spec.id) }, usable: usable(spec.id) }))
}

test('routing: documentation need picks docs sources; explicit sources are honored; missing keys reported', () => {
  const config = parsed()
  const sources = routable(config, ['exa', 'tavily', 'context7', 'brave', 'keenable', 'hackernews'])
  const docs = planRoute({ need: need({ queries: ['next.js middleware matcher'], types: ['documentation'] }), explicit: [], config, sources, count: 2 })
  assert.equal(docs.mode, 'rules')
  assert.ok(docs.chosen.some(c => c.id === 'context7'), JSON.stringify(docs.chosen))
  const explicit = planRoute({ need: need(), explicit: ['brave', 'exa', 'nope'], config, sources: routable(config, ['brave', 'exa'], id => id !== 'exa'), count: 2 })
  assert.deepEqual(explicit.chosen.map(c => c.id), ['brave'])
  assert.deepEqual(explicit.unavailable.map(u => u.id).sort(), ['exa', 'nope'])
  const community = planRoute({ need: need({ types: ['community'] }), explicit: [], config, sources, count: 1 })
  assert.equal(community.chosen[0].id, 'hackernews')
})

test('routing: default combination keeps config order and avoids a shared engine', () => {
  const config = parsed({ routing: { defaultSources: ['brightdata', 'gemini', 'exa'] } })
  const sources = routable(config, ['brightdata', 'gemini', 'exa'])
  const plan = planRoute({ need: need({ queries: ['hello world'] }), explicit: [], config, sources, count: 2 })
  assert.equal(plan.mode, 'default')
  // brightdata and gemini both sit on Google; the second pick should be exa.
  assert.deepEqual(plan.chosen.map(c => c.id), ['brightdata', 'exa'])
})

test('merge: same page across sources collapses; reprints collapse; different versions stay apart', () => {
  const lists = [
    { source: 'a', query: 'q', weight: 1, hits: [
      { url: 'https://site.com/post?utm_source=x', title: 'Big Launch Announcement Today', snippet: 'Company X launched product Y with new features for developers worldwide today.' },
      { url: 'https://docs.lib.dev/v1.2/guide', title: 'Guide v1.2', snippet: 'Install lib 1.2 with npm' },
    ] },
    { source: 'b', query: 'q', weight: 1, hits: [
      { url: 'https://site.com/post', title: 'Big Launch Announcement Today', snippet: 'short' },
      { url: 'https://mirror.net/copy', title: 'Big Launch Announcement Today', snippet: 'Company X launched product Y with new features for developers worldwide today.' },
      { url: 'https://docs.lib.dev/v2.0/guide', title: 'Guide v2.0', snippet: 'Install lib 2.0 with npm' },
    ] },
  ]
  const { candidates, stats } = mergeHits(lists)
  assert.equal(stats.rawHits, 5)
  const keys = [...candidates.keys()]
  assert.equal(keys.length, 3, keys.join(' '))
  const post = candidates.get(urlKey('https://site.com/post'))
  assert.deepEqual([...post.ranks.keys()].sort(), ['a', 'b'])
  assert.deepEqual(post.alsoAt, ['https://mirror.net/copy'])
  assert.ok(post.snippet.length > 20, 'keeps the longer snippet')
})

test('rerank applies hard constraints and preferences', () => {
  const lists = [{ source: 'a', query: 'q', weight: 1, hits: [
    { url: 'https://blog.example.com/react-hooks', title: 'react hooks tips', snippet: 'react hooks useEffect cleanup explained in depth with many examples and caveats for production apps', publishedAt: '2020-01-01' },
    { url: 'https://react.dev/reference/useEffect', title: 'useEffect – React', snippet: 'useEffect cleanup function reference for react hooks', publishedAt: '2025-06-01' },
    { url: 'https://spam.com/x', title: 'x', snippet: 'unrelated', publishedAt: '2025-06-01' },
  ] }]
  const { candidates } = mergeHits(lists)
  fuse(candidates.values(), new Map([['a', 1]]))
  const ranked = rerank([...candidates.values()], { need: need({ queries: ['react useEffect cleanup'], preferOfficial: true, after: '2024-01-01', excludeSites: ['spam.com'] }), officialDomains: ['react.dev'], keepThreshold: 0.3 })
  assert.equal(ranked.length, 2, 'excluded site dropped')
  assert.equal(ranked[0].url, 'https://react.dev/reference/useEffect')
  assert.ok(ranked[0].flags.has('official'))
  assert.ok(ranked[1].flags.has('out-of-range'))
})

test('keyword excerpt keeps heading, condition and full table with header', () => {
  const doc = [
    '# Pricing', '', 'Intro text.', '', '## Limits', '', 'Rate limits apply per key:', '',
    '| Plan | RPM |', '| --- | --- |', '| Free | 10 |', '| Pro | 600 |', '',
    'Note: limits are halved during incidents.', '', '## Other', '', 'Unrelated paragraph about billing '.repeat(20),
  ].join('\n')
  const out = keywordExcerpt(doc, ['Pro'], 0, 5000)
  assert.equal(out.matches, 1)
  assert.match(out.text, /## Limits/)
  assert.match(out.text, /\| Plan \| RPM \|/)
  assert.match(out.text, /Rate limits apply per key:/)
  assert.match(out.text, /Note: limits are halved/)
  assert.doesNotMatch(out.text, /Unrelated paragraph/)
  const none = keywordExcerpt(doc, ['zzz'], 0, 5000)
  assert.equal(none.matches, 0)
})

test('range excerpt ends on a block boundary and reports the next offset', () => {
  const doc = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ${'x'.repeat(80)}`).join('\n\n')
  const first = rangeExcerpt(doc, 0, 500)
  assert.ok(first.text.endsWith('\n') || first.text.endsWith('x'))
  assert.ok(first.nextOffset > 0)
  const next = rangeExcerpt(doc, first.nextOffset, 500)
  assert.ok(next.text.trimStart().startsWith('Paragraph'))
})

test('skill content carries the configured research budget', () => {
  const text = skillContent(parsed({ research: { maxSubagents: 5, maxPages: 12 } }))
  assert.match(text, /at most \*\*5\*\*/)
  assert.match(text, /at most \*\*12\*\* in total/)
})

test('default combination fills only with general web sources; docs-like subdomains count as official', () => {
  const config = parsed({ routing: { defaultSources: ['keenable'] } })
  const sources = routable(config, ['keenable', 'context7', 'huggingface', 'brave'])
  const plan = planRoute({ need: need({ queries: ['hello there'] }), explicit: [], config, sources, count: 2 })
  assert.deepEqual(plan.chosen.map(c => c.id), ['keenable', 'brave'])
  const lists = [{ source: 'a', query: 'q', weight: 1, hits: [
    { url: 'https://dev.to/x/post', title: 'post', snippet: 'q' }, { url: 'https://docs.python.org/3/library/os.html', title: 'os', snippet: 'q' },
  ] }]
  const { candidates } = mergeHits(lists)
  fuse(candidates.values(), new Map())
  const ranked = rerank([...candidates.values()], { need: need(), officialDomains: [], keepThreshold: 0.3 })
  assert.equal(ranked.find(c => c.url.includes('dev.to')).flags.has('official'), false)
  assert.equal(ranked.find(c => c.url.includes('python.org')).flags.has('official'), true)
})

test('DuckDuckGo HTML parsing unwraps redirect links and skips ads', async () => {
  const { parseDuckDuckGo } = await import('../lib/html.js')
  const html = `<div class="result result--ad"><a class="result__a" href="https://ad.example/">Ad</a></div>
  <div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fbun.sh%2Fdocs&rut=x">Bun docs</a><a class="result__snippet">Bun is a fast runtime</a></div>`
  assert.deepEqual(parseDuckDuckGo(html), [{ url: 'https://bun.sh/docs', title: 'Bun docs', snippet: 'Bun is a fast runtime' }])
})

test('skill file: seeded once, follows settings while untouched, keeps edits, respects deletion, restores', async () => {
  const { mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { SkillFile, generatedSkillFile, validateSkillFile } = await import('../lib/skillfile.js')
  const home = await mkdtemp(join(tmpdir(), 'dms-skill-'))
  const file = new SkillFile(home)
  const a = parsed({ research: { maxSubagents: 2 } }), b = parsed({ research: { maxSubagents: 6, modelInvocable: false } })
  assert.equal(await file.sync(a, 'file'), 'synced')
  assert.equal(await readFile(file.path, 'utf8'), generatedSkillFile(a))
  assert.equal(await file.sync(b, 'file'), 'synced')
  const followed = await readFile(file.path, 'utf8')
  assert.match(followed, /at most \*\*6\*\* running/)
  assert.match(followed, /disable-model-invocation: true/)
  // An edit made elsewhere (a skill manager, an editor) is kept.
  await writeFile(file.path, followed.replace('# Deep research', '# My research'))
  assert.equal(await file.sync(a, 'file'), 'modified')
  assert.match(await readFile(file.path, 'utf8'), /# My research/)
  assert.equal((await file.status(a, 'file')).state, 'modified')
  // Saving from the settings page validates first.
  await assert.rejects(file.save(a, 'no frontmatter'), /frontmatter/)
  assert.equal(await file.save(a, generatedSkillFile(a)), 'synced')
  // Deleted (trashed) stays deleted until restored.
  await rm(file.path)
  assert.equal(await file.sync(b, 'file'), 'deleted')
  assert.equal(await file.restore(b), 'synced')
  assert.equal(await readFile(file.path, 'utf8'), generatedSkillFile(b))
  // Builtin mode takes back an untouched file, and file mode seeds it again afterwards.
  assert.equal(await file.sync(b, 'builtin'), 'builtin')
  await assert.rejects(readFile(file.path, 'utf8'))
  assert.equal(await file.sync(b, 'file'), 'synced')
  // A same-named skill the plugin never wrote is left alone.
  const other = new SkillFile(await mkdtemp(join(tmpdir(), 'dms-skill-')))
  const { mkdir } = await import('node:fs/promises')
  await mkdir(join(other.path, '..'), { recursive: true })
  await writeFile(other.path, '---\nname: deep-research\ndescription: someone else\n---\n\nbody\n')
  assert.equal(await other.sync(a, 'file'), 'foreign')
  assert.match(await readFile(other.path, 'utf8'), /someone else/)
  assert.equal(validateSkillFile('---\nname: Bad Name\ndescription: x\n---\nbody'), 'name "Bad Name" 必须是小写字母、数字和连字符')
  assert.equal(validateSkillFile('---\nname: ok\ndescription: x\nmodelInvocable: true\n---\nbody'), '不支持 modelInvocable，请用 disable-model-invocation / user-invocable')
})

test('rerank presets and chat completions URL', async () => {
  const { rerankTarget } = await import('../lib/presets.js')
  const { chatCompletionsUrl } = await import('../lib/decision.js')
  assert.deepEqual(rerankTarget({ provider: 'siliconflow' }), { url: 'https://api.siliconflow.cn/v1/rerank', apiKey: 'SILICONFLOW_API_KEY', model: 'BAAI/bge-reranker-v2-m3' })
  assert.deepEqual(rerankTarget({ provider: 'siliconflow', model: 'BAAI/bge-reranker-v2-gemma' }).model, 'BAAI/bge-reranker-v2-gemma')
  assert.deepEqual(rerankTarget(parsed().rerank), { url: 'https://api.jina.ai/v1/rerank', apiKey: 'JINA_API_KEY', model: 'jina-reranker-v2-base-multilingual' })
  assert.equal(chatCompletionsUrl('https://api.siliconflow.cn/v1/'), 'https://api.siliconflow.cn/v1/chat/completions')
  assert.equal(chatCompletionsUrl('https://x.com/v1/chat/completions'), 'https://x.com/v1/chat/completions')
})

test('decision APIs: endpoint, both request formats, and either reply layout', async () => {
  const { decisionsUrl, decisionWire } = await import('../lib/presets.js')
  const { openAIRequest, systemOneRequest, parseAnswers } = await import('../lib/decisions-api.js')
  assert.equal(decisionsUrl('https://api.openai.com/v1/', 'openai'), 'https://api.openai.com/v1/decisions')
  assert.equal(decisionsUrl('https://api.typesafe.ai/v1', 'systemone'), 'https://api.typesafe.ai/v1/systemone')
  assert.equal(decisionsUrl('https://nano-gpt.com/api/v1/decisions', 'systemone'), 'https://nano-gpt.com/api/v1/decisions')
  assert.equal(decisionWire({ backend: 'decisions', protocol: 'systemone', baseURL: 'https://openrouter.ai/api/v1' }), 'POST https://openrouter.ai/api/v1/systemone')
  assert.equal(decisionWire({ backend: 'openai', baseURL: 'https://x.com/v1' }), 'POST https://x.com/v1/chat/completions')
  const questions = [
    { id: 'go', type: 'bool', instructions: 'More?', true: 'yes', false: 'no' },
    { id: 'c1', type: 'score', instructions: 'Relevant?', levels: [{ label: 'low' }, { label: 'mid', description: 'some' }, { label: 'high' }] },
    { id: 'kind', type: 'choice', instructions: 'Kind?', choices: [{ value: 'news', description: 'a news story' }, { value: 'paper' }] },
  ]
  const oa = openAIRequest('gpt-6-luna', { a: 1 }, questions)
  assert.equal(oa.input, '{"a":1}')
  assert.deepEqual(oa.questions.map(q => [q.type, q.name]), [['predicate', 'go'], ['score', 'c1'], ['choice', 'kind']])
  assert.match(oa.questions[0].instructions, /True means: yes\nFalse means: no/)
  assert.deepEqual(oa.questions[1].levels[1], { label: 'mid', description: 'some' })
  const so = systemOneRequest('typesafe/jev-1.14', { a: 1 }, questions)
  assert.deepEqual(so.state, { a: 1 })
  assert.deepEqual(so.questions.go, { type: 'noul', instructions: 'More?', criteria: { true: 'yes', false: 'no' } })
  assert.deepEqual(so.questions.c1.criteria, ['low', 'mid: some', 'high'])
  assert.deepEqual(so.questions.kind.criteria, { news: 'a news story', paper: 'paper' })
  const fromArray = parseAnswers({ answers: [
    { type: 'predicate', name: 'go', probability: 0.8 }, { type: 'score', name: 'c1', score: 1.5, confidence: 0.6 }, { type: 'refusal', name: 'kind' },
  ] }, questions)
  assert.deepEqual([...fromArray], [['go', 0.8], ['c1', 0.75]])
  const fromObject = parseAnswers({ answers: { go: { type: 'noul', noul: 0.1 }, c1: { type: 'score', score: 2 }, kind: { type: 'choice', choice: 'paper' } } }, questions)
  assert.deepEqual([...fromObject], [['go', 0.1], ['c1', 1], ['kind', 'paper']])
})

test('fetch total budget: per-profile defaults, 0 turns it off, hard ceiling', async () => {
  const { Config, effectiveTuning, snapshotConfig } = await import('../lib/config.js')
  const config = snapshotConfig(Config({}))
  assert.deepEqual(['fast', 'balanced', 'deep'].map(p => effectiveTuning(config, p, {}).fetchTotalTokens), [6000, 8000, 10000])
  assert.equal(effectiveTuning(snapshotConfig(Config({ overrides: { fetchTotalTokens: 0 } })), 'deep', {}).fetchTotalTokens, 0)
  assert.equal(effectiveTuning(config, 'deep', { fetchTotalTokens: 10_000_000 }).fetchTotalTokens, 200_000)
})

test('source count: profile, decision model and call parameter, always within the configured range', async () => {
  const { Config, effectiveTuning, snapshotConfig, sourceCount } = await import('../lib/config.js')
  const config = snapshotConfig(Config({ routing: { minSources: 2, maxSources: 4 } }))
  const fast = effectiveTuning(config, 'fast', {})
  assert.deepEqual(sourceCount(config, fast, {}), { count: 2, min: 2, max: 4, by: 'profile' })
  const deep = effectiveTuning(config, 'deep', {})
  assert.equal(sourceCount(config, deep, {}).count, 4)
  const scores = new Map([['exa', 0.9], ['tavily', 0.75], ['consensus', 0.62], ['hackernews', 0.3], ['context7', 0.65], ['you', 0.7]])
  assert.deepEqual(sourceCount(config, fast, {}, scores), { count: 4, min: 2, max: 4, by: 'decision' })
  assert.equal(sourceCount(config, fast, {}, new Map([['exa', 0.2]])).count, 2)
  const call = effectiveTuning(config, 'fast', { parallelSources: 1 })
  assert.deepEqual(sourceCount(config, call, { parallelSources: 1 }, scores), { count: 2, min: 2, max: 4, by: 'call' })
  // Defaults keep the old behaviour without a decision model; the hard limit still caps the range.
  const plain = snapshotConfig(Config({ limits: { maxParallelSources: 3 } }))
  assert.deepEqual(sourceCount(plain, effectiveTuning(plain, 'fast', {}), {}), { count: 1, min: 1, max: 3, by: 'profile' })
})
