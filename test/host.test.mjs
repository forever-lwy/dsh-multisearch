import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boot, dshHome, mockFetch, only } from './helpers.mjs'

async function waitFor(check, ms = 2000) {
  const end = Date.now() + ms
  for (;;) {
    if (await check()) return
    if (Date.now() > end) throw new Error('condition not reached')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

const exaHits = urls => ({ results: urls.map((url, i) => ({ url, title: `Exa ${i}`, highlights: [`exa highlight about react hooks ${i}`], publishedDate: '2025-05-01' })) })
const tavilyHits = urls => ({ results: urls.map((url, i) => ({ url, title: `Tavily ${i}`, content: `tavily content about react hooks ${i}` })) })

test('plugin registers search/fetch with guidance, and unregisters on dispose', async t => {
  const { ctx, fiber } = await boot(t, { sources: only(['keenable', 'http']) })
  assert.ok(ctx.tools.get('search'))
  assert.ok(ctx.tools.get('fetch'))
  const schema = ctx.tools.schemas().find(s => s.name === 'search')
  assert.ok(schema.parameters.properties.source_types)
  await fiber.dispose()
  assert.equal(ctx.tools.get('search'), undefined)
})

test('search runs two complementary sources in parallel, merges duplicates and assigns stable refs', async t => {
  const calls = mockFetch(t, [
    ['https://api.exa.ai/search', () => ({ json: exaHits(['https://react.dev/a', 'https://blog.dev/b', 'https://x.org/c']) })],
    ['https://api.tavily.com/search', () => ({ json: tavilyHits(['https://react.dev/a?utm_source=t', 'https://other.dev/d']) })],
  ])
  const { call } = await boot(t, { sources: only(['exa', 'tavily']), routing: { defaultSources: ['exa', 'tavily'] }, overrides: { minResults: 1 } }, { credentials: { EXA_API_KEY: 'exa-secret-key', TAVILY_API_KEY: 'tvly-secret-key' } })
  const first = await call('search', { queries: ['react hooks cleanup'] })
  assert.equal(first.isError, false, first.text)
  assert.equal(calls.length, 2)
  assert.equal(calls.find(c => c.url.includes('exa')).headers['x-api-key'], 'exa-secret-key')
  assert.match(first.text, /\[S1\]/)
  assert.match(first.text, /exa\+tavily|tavily\+exa/, 'merged hit shows both channels')
  assert.match(first.text, /去重后 4 条（原始 5）/)
  assert.match(first.text, /^External web content follows/)
  assert.equal(first.meta.sources.length, 4)
  // Same URL in a later search keeps its reference id.
  const again = await call('search', { queries: ['react hooks cleanup'] })
  const refOf = (text, url) => new RegExp(`\\[(S\\d+)\\][^\\n]*\\n\\s+${url.replace(/[.?]/g, '\\$&')}`).exec(text)?.[1]
  assert.equal(refOf(again.text, 'https://react.dev/a'), refOf(first.text, 'https://react.dev/a'))
})

test('budget trimming leaves candidates reachable through more', async t => {
  const urls = Array.from({ length: 12 }, (_, i) => `https://site${i}.com/page`)
  mockFetch(t, [['https://api.exa.ai/search', () => ({ json: exaHits(urls) })]])
  const { call } = await boot(t, { sources: only(['exa']), overrides: { returnResults: 5, perSourceResults: 12 } }, { credentials: { EXA_API_KEY: 'k-exa-123456' } })
  const first = await call('search', { queries: ['anything'], sources: ['exa'] })
  assert.match(first.text, /还有 7 条候选未显示：search\(\{more: "Q1"\}\)/)
  const more = await call('search', { more: 'Q1' })
  assert.equal(more.isError, false, more.text)
  assert.equal((more.text.match(/^\[S\d+\]/gm) ?? []).length, 5)
  assert.match(more.text, /还有 2 条候选/)
})

test('failures and timeouts are reported per source; results from others still return (partial)', async t => {
  mockFetch(t, [
    ['https://api.exa.ai/search', () => ({ status: 401, json: { error: 'invalid key exa-secret-key' } })],
    ['https://api.tavily.com/search', () => ({ delay: 5000, json: tavilyHits(['https://late.dev']) })],
    ['https://api.keenable.ai/v1/search/public', () => ({ json: { results: [{ url: 'https://k.dev/1', title: 'K', snippet: 'keenable result' }] } })],
  ])
  const { call } = await boot(t, { sources: only(['exa', 'tavily', 'keenable']), overrides: { requestTimeoutMs: 1000, minResults: 1 } }, { credentials: { EXA_API_KEY: 'exa-secret-key', TAVILY_API_KEY: 'tvly-key-123' } })
  const out = await call('search', { queries: ['q'], sources: ['exa', 'tavily', 'keenable'] })
  assert.equal(out.isError, false, out.text)
  assert.match(out.text, /部分完成/)
  assert.match(out.text, /exa「q」error: HTTP 401/)
  assert.doesNotMatch(out.text, /exa-secret-key/, 'credentials are redacted')
  assert.match(out.text, /tavily「q」timeout/)
  assert.match(out.text, /https:\/\/k\.dev\/1/)
})

test('missing type triggers follow-up: suggestion by default, automatic with auto_follow_up', async t => {
  const calls = mockFetch(t, [
    ['https://api.exa.ai/search', () => ({ json: exaHits(['https://a.com/1', 'https://a.com/2', 'https://a.com/3', 'https://a.com/4', 'https://a.com/5']) })],
    ['https://hn.algolia.com/api/v1/search', () => ({ json: { hits: [{ objectID: '42', title: 'Show HN: thing', points: 100, num_comments: 30, created_at: '2025-01-01T00:00:00Z' }] } })],
  ])
  const config = { sources: only(['exa', 'hackernews']), overrides: { parallelSources: 1, minResults: 1 } }
  config.sources.exa.priority = 100
  config.sources.hackernews.priority = 0
  const { call } = await boot(t, config, { credentials: { EXA_API_KEY: 'k-exa-123456' } })
  // exa (high priority) covers academic; only hackernews covers community, so community is missing after round one.
  const suggested = await call('search', { queries: ['tool x review'], source_types: ['academic', 'community'], options: { parallel_sources: 1 } })
  assert.equal(suggested.isError, false, suggested.text)
  assert.match(suggested.text, /来源 exa ·/)
  assert.match(suggested.text, /补搜建议（缺少要求的资料类型）/)
  assert.match(suggested.text, /可尝试来源：hackernews/)
  assert.ok(!calls.some(c => c.url.startsWith('https://hn.algolia.com')), 'no automatic follow-up by default')
  const auto = await call('search', { queries: ['tool x review'], source_types: ['academic', 'community'], auto_follow_up: true, options: { parallel_sources: 1 } })
  assert.match(auto.text, /news\.ycombinator\.com\/item\?id=42/)
  assert.match(auto.text, /已自动补搜：第 1 轮补搜：hackernews/)
  assert.ok(calls.some(c => c.url.startsWith('https://hn.algolia.com')))
})

test('fetch falls back past a login wall, keeps attempts, reuses the cache, and resolves refs', async t => {
  const article = `<html><head><title>Real Article</title></head><body><nav>menu</nav><article><h1>Real Article</h1><p>${'Body text about pricing. '.repeat(30)}</p><h2>Limits</h2><p>Rate limits apply:</p><table><thead><tr><th>Plan</th><th>RPM</th></tr></thead><tbody><tr><td>Pro</td><td>600</td></tr></tbody></table></article><footer>foot</footer></body></html>`
  const calls = mockFetch(t, [
    ['https://api.keenable.ai/v1/fetch/public', () => ({ json: { url: 'https://news.example.com/a', content: 'Please log in to continue reading.', title: 'Login' } })],
    ['https://r.jina.ai/', () => ({ status: 500, json: { code: 500 } })],
    ['https://news.example.com/a', () => ({ text: article })],
  ])
  const { call } = await boot(t, { sources: only(['keenable', 'jina', 'http'], { http: { enabled: true } }), fetching: { allowPrivateNetwork: true }, overrides: { fetchRetries: 0 } })
  const out = await call('fetch', { urls: ['https://news.example.com/a'], keywords: ['Pro'] })
  assert.equal(out.isError, false, out.text)
  assert.match(out.text, /keenable:blocked → jina:error.* → http:ok/)
  assert.match(out.text, /服务 http/)
  assert.match(out.text, /\| Plan \| RPM \|/)
  assert.match(out.text, /## Limits/)
  assert.doesNotMatch(out.text, /menu|foot/)
  const ref = /\[(S\d+)\]/.exec(out.text)[1]
  const before = calls.length
  const again = await call('fetch', { urls: [ref], max_chars: 300 })
  assert.equal(calls.length, before, 'served from cache')
  assert.match(again.text, /缓存/)
  assert.match(again.text, /继续读取：fetch\(\{urls:\["S\d+"\], offset:\d+\}\)/)
})

test('fetch refuses private network targets by default', async t => {
  mockFetch(t, [])
  const { call } = await boot(t, { sources: only(['http']) })
  const out = await call('fetch', { urls: ['http://127.0.0.1:3080/secret'] })
  assert.match(out.text, /拒绝访问本机或内网地址/)
  assert.match(out.text, /状态: failed/)
})

test('crawl map uses the walk when no map service is configured', async t => {
  const page = (links) => `<html><body><main>${'content '.repeat(80)}${links.map(l => `<a href="${l}">${l}</a>`).join(' ')}</main></body></html>`
  mockFetch(t, [
    [url => url === 'https://docs.site.com/', () => ({ text: page(['/docs/a', '/docs/b', 'https://other.com/x', '/blog/c']) })],
    [url => url.startsWith('https://docs.site.com/docs/'), () => ({ text: page(['/docs/c']) })],
  ])
  const { call } = await boot(t, { sources: only(['http']), fetching: { allowPrivateNetwork: true } })
  const out = await call('fetch', { urls: ['https://docs.site.com/'], crawl: { mode: 'map', include_paths: ['/docs/'], max_depth: 2 } })
  assert.equal(out.isError, false, out.text)
  assert.match(out.text, /https:\/\/docs\.site\.com\/docs\/a/)
  assert.match(out.text, /https:\/\/docs\.site\.com\/docs\/c/)
  assert.doesNotMatch(out.text, /other\.com|\/blog\//)
})

test('decision model reranks when enabled and is ignored when its output is invalid', async t => {
  mockFetch(t, [['https://api.exa.ai/search', () => ({ json: exaHits(['https://one.com', 'https://two.com', 'https://three.com']) })]])
  let reply = '{"relevance":{"c1":0.05,"c2":0.1,"c3":0.99}}'
  const llm = { stream: async function* () { yield { type: 'block-start', index: 0, blockType: 'text' }; yield { type: 'text-delta', index: 0, text: reply }; yield { type: 'finish', reason: { kind: 'stop' } } } }
  const { ctx, call } = await boot(t, { sources: only(['exa']), decision: { enabled: true, provider: 'p', model: 'jev', stages: ['rerank'] } }, { credentials: { EXA_API_KEY: 'k-exa-123456' } })
  ctx.provide('llm', llm)
  const ranked = await call('search', { queries: ['x'], sources: ['exa'] })
  const order = [...ranked.text.matchAll(/^\s+(https:\/\/\w+\.com)/gm)].map(m => m[1])
  assert.equal(order[0], 'https://three.com', ranked.text)
  reply = 'not json'
  const fallback = await call('search', { queries: ['x'], sources: ['exa'] })
  assert.equal(fallback.isError, false)
})

test('Tencent WSA request is TC3-signed and parses Pages', async t => {
  const calls = mockFetch(t, [['https://wsa.tencentcloudapi.com', () => ({ json: { Response: { Pages: [JSON.stringify({ title: '标题', url: 'https://gov.cn/a', passage: '摘要', date: '2025-01-01', site: '政府网' })], RequestId: 'r' } } })]])
  const { call } = await boot(t, { sources: only(['yuanbao']) }, { credentials: { TENCENTCLOUD_WSA_SECRET: 'AKIDtest:secretKeyValue' } })
  const out = await call('search', { queries: ['政策 解读'], sources: ['yuanbao'], source_types: ['government'] })
  assert.equal(out.isError, false, out.text)
  const request = calls[0]
  assert.match(request.headers.authorization, /^TC3-HMAC-SHA256 Credential=AKIDtest\/\d{4}-\d{2}-\d{2}\/wsa\/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=[0-9a-f]{64}$/)
  assert.equal(request.headers['x-tc-action'], 'SearchPro')
  assert.equal(request.body.Industry, 'gov')
  assert.match(out.text, /https:\/\/gov\.cn\/a/)
})

test('deep-research skill is a SKILL.md in $DSH_HOME/skills by default; builtin mode registers it in memory', async t => {
  const { readFile, rm } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const file = join(dshHome, 'skills', 'deep-research', 'SKILL.md')
  await rm(join(dshHome, 'skills'), { recursive: true, force: true }); await rm(join(dshHome, 'storages'), { recursive: true, force: true })
  const registered = []
  const { ctx } = await boot(t, { research: { maxSubagents: 4 } })
  ctx.provide('skills', { register: skill => { registered.push(skill); return () => {} } })
  await waitFor(async () => (await readFile(file, 'utf8').catch(() => '')).includes('at most **4** running'))
  const text = await readFile(file, 'utf8')
  assert.match(text, /^---\nname: deep-research\ndescription: "/)
  assert.match(text, /disable-model-invocation: false/)
  assert.equal(registered.length, 0, 'file mode does not also register in memory')
  const builtin = []
  const second = await boot(t, { research: { maxSubagents: 2, skillMode: 'builtin' } })
  second.ctx.provide('skills', { register: skill => { builtin.push(skill); return () => {} } })
  await waitFor(() => builtin.length === 1)
  assert.match(builtin[0].content, /at most \*\*2\*\* running/)
  await waitFor(async () => (await readFile(file, 'utf8').catch(() => 'gone')) === 'gone')
})

test('capability gates: Jina search needs a key while reading does not; self-hosted Crawl4AI cannot search', async t => {
  mockFetch(t, [['https://r.jina.ai/', () => ({ json: { code: 200, data: { title: 'T', url: 'https://a.com/x', content: 'body '.repeat(100) } } })]])
  const { call } = await boot(t, { sources: only(['jina', 'crawl4ai'], { crawl4ai: { options: { mode: 'self-hosted' }, baseURL: 'http://c4a:11235' } }) })
  const out = await call('search', { queries: ['x'], sources: ['jina', 'crawl4ai'] })
  assert.match(out.text, /jina 不可用：搜索需要 Jina API Key/)
  assert.match(out.text, /crawl4ai 不可用：自建 Crawl4AI 不提供搜索/)
  const read = await call('fetch', { urls: ['https://a.com/x'], services: ['jina'] })
  assert.match(read.text, /状态: ok · 服务 jina/)
})

test('Crawl4AI cloud: search and scrape against api.crawl4ai.com; a login wall counts as blocked', async t => {
  const calls = mockFetch(t, [
    [url => url.startsWith('https://api.crawl4ai.com/search'), () => ({ json: { results: [{ title: 'R', url: 'https://r.com/1', snippet: 'crawl4ai result', source: 'gg' }] } })],
    [url => url.startsWith('https://api.crawl4ai.com/scrape') , (_u, _i, body) => body.url.includes('wall') ? { status: 403, json: { error: 'login-wall' } } : { json: { ok: true, markdown: 'page '.repeat(80) } }],
  ])
  const { call } = await boot(t, { sources: only(['crawl4ai']) }, { credentials: { CRAWL4AI_API_KEY: 'sk_live_test123' } })
  const out = await call('search', { queries: ['rust crawler'], sources: ['crawl4ai'] })
  assert.match(out.text, /https:\/\/r\.com\/1/)
  assert.equal(calls[0].headers.authorization, 'Bearer sk_live_test123')
  const ok = await call('fetch', { urls: ['https://r.com/1'] })
  assert.match(ok.text, /状态: ok · 服务 crawl4ai/)
  assert.equal(calls[1].body.format, 'md')
  const wall = await call('fetch', { urls: ['https://r.com/wall'] })
  assert.match(wall.text, /状态: blocked/)
})

test('SciVerse: chunks grouped per paper, DOI links, full text read by doc_id or DOI', async t => {
  const calls = mockFetch(t, [
    ['https://api.sciverse.space/agentic-search', () => ({ json: { hits: [
      { doc_id: 'd1', chunk_id: 'c1', chunk: 'graphene anode retains 90% capacity after 500 cycles', title: 'Graphene anodes', doi: '10.1000/abc', publication_published_year: 2023, citation_count: 12 },
      { doc_id: 'd1', chunk_id: 'c2', chunk: 'cycling at 1C shows slow fade', title: 'Graphene anodes', doi: '10.1000/abc' },
      { doc_id: 'd2', chunk_id: 'c3', chunk: 'silicon composite electrodes', title: 'Silicon composites' },
    ] } })],
    ['https://api.sciverse.space/meta-search', () => ({ json: { results: [{ doc_id: 'd1', title: 'Graphene anodes', doi: '10.1000/abc' }] } })],
    ['https://api.sciverse.space/content', url => ({ json: { text: `Full text of ${new URL(url).searchParams.get('doc_id')} ${'lorem '.repeat(60)}`, more: false } })],
  ])
  const { call } = await boot(t, { sources: only(['sciverse']) }, { credentials: { SCIVERSE_API_TOKEN: 'sv-test-token' } })
  const out = await call('search', { queries: ['graphene battery cycle stability'], source_types: ['academic'], after: '2020-01-01' })
  assert.equal(out.isError, false, out.text)
  assert.equal(calls[0].body.filters.publication_published_year.gte, 2020)
  assert.match(out.text, /https:\/\/doi\.org\/10\.1000\/abc/)
  assert.match(out.text, /https:\/\/api\.sciverse\.space\/content\?doc_id=d2/)
  assert.equal((out.text.match(/^\[S\d+\]/gm) ?? []).length, 2, 'two papers, not three chunks')
  const byDoi = await call('fetch', { urls: ['https://doi.org/10.1000/abc'] })
  assert.match(byDoi.text, /服务 sciverse/)
  assert.match(byDoi.text, /Full text of d1/)
  const byDoc = await call('fetch', { urls: ['https://api.sciverse.space/content?doc_id=d2'] })
  assert.match(byDoc.text, /Full text of d2/)
})

test('Consensus uses the documented query parameters and x-api-key', async t => {
  const calls = mockFetch(t, [['https://api.consensus.app/v1/search', () => ({ json: { results: [{ title: 'Creatine and cognition', url: 'https://consensus.app/papers/x/1/', doi: '10.2903/j.efsa.2024.9100', takeaway: 'No established effect.', journal_name: 'EFSA Journal', publish_year: 2024, citation_count: 5, study_type: 'systematic review' }] } })]])
  const { call } = await boot(t, { sources: only(['consensus'], { consensus: { options: { excludePreprints: true } } }) }, { credentials: { CONSENSUS_API_KEY: 'cons-key-123' } })
  const out = await call('search', { queries: ['creatine working memory'], sources: ['consensus'], after: '2015-01-01' })
  const url = new URL(calls[0].url)
  assert.equal(url.searchParams.get('year_min'), '2015')
  assert.equal(url.searchParams.get('exclude_preprints'), 'true')
  assert.equal(calls[0].headers['x-api-key'], 'cons-key-123')
  assert.match(out.text, /No established effect/)
  assert.match(out.text, /study=systematic review/)
})

test('host-specific readers only see their hosts; Gemini has no fetch even when listed in the order', async t => {
  const calls = mockFetch(t, [
    ['https://arctic-shift.photon-reddit.com/api/posts/ids', () => ({ json: { data: [{ title: 'Bun thread', subreddit: 'javascript', author: 'a', score: 5, created_utc: 1700000000, selftext: 'is bun ready? '.repeat(20) }] } })],
    ['https://arctic-shift.photon-reddit.com/api/comments/tree', () => ({ json: { data: [{ kind: 't1', data: { author: 'b', score: 3, body: 'yes for scripts', replies: { data: { children: [{ kind: 't1', data: { author: 'c', score: 1, body: 'not for native addons' } }] } } } }] } })],
    ['https://r.jina.ai/', () => ({ status: 500, json: { code: 500 } })],
  ])
  const { call } = await boot(t, { sources: only(['arcticshift', 'jina', 'gemini', 'hackernews']), fetching: { order: ['gemini', 'jina'] }, overrides: { fetchRetries: 0 } }, { credentials: { GOOGLE_API_KEY: 'g-key-123456' } })
  const reddit = await call('fetch', { urls: ['https://www.reddit.com/r/javascript/comments/abc123/bun_thread/'] })
  assert.match(reddit.text, /服务 arcticshift/)
  assert.match(reddit.text, /u\/b \(3\): yes for scripts/)
  assert.match(reddit.text, /  - u\/c \(1\): not for native addons/)
  const other = await call('fetch', { urls: ['https://example.org/page'] })
  assert.match(other.text, /尝试 jina:error\(HTTP 500/)
  assert.doesNotMatch(other.text, /gemini/)
  assert.ok(!calls.some(c => c.url.includes('hn.algolia.com') || c.url.includes('generativelanguage')))
})

test('You.com and Linkup read pages through their own endpoints', async t => {
  const calls = mockFetch(t, [
    ['https://ydc-index.io/v1/contents', () => ({ json: [{ url: 'https://a.com/', title: 'A', markdown: 'you content '.repeat(40) }] })],
    ['https://api.linkup.so/v1/fetch', () => ({ json: { markdown: 'linkup content '.repeat(40) } })],
  ])
  const { call } = await boot(t, { sources: only(['you', 'linkup']) }, { credentials: { YDC_API_KEY: 'ydc-key-123', LINKUP_API_KEY: 'lk-key-123' } })
  const a = await call('fetch', { urls: ['https://a.com/'], services: ['you'] })
  assert.match(a.text, /服务 you/)
  assert.deepEqual(calls[0].body.urls, ['https://a.com/'])
  const b = await call('fetch', { urls: ['https://b.com/'], services: ['linkup'] })
  assert.match(b.text, /服务 linkup/)
  assert.equal(calls[1].body.renderJs, true)
})

test('Yuanbao accepts a service API KEY as Bearer', async t => {
  const calls = mockFetch(t, [['https://api.wsa.cloud.tencent.com/SearchPro', () => ({ json: { Response: { Pages: [JSON.stringify({ title: 't', url: 'https://qq.com/a', passage: 'p' })] } } })]])
  const { call } = await boot(t, { sources: only(['yuanbao']) }, { credentials: { TENCENTCLOUD_WSA_SECRET: 'sk-wsa-key' } })
  const out = await call('search', { queries: ['三星堆'], sources: ['yuanbao'] })
  assert.match(out.text, /https:\/\/qq\.com\/a/)
  assert.equal(calls[0].headers.authorization, 'Bearer sk-wsa-key')
})

test('a volatile settings update rebuilds tool names and the skill text without a remount', async t => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { SystemPrompt } = await import('@deepseek-ai/dsh-system-prompt')
  const { ToolRuntime } = await import('@deepseek-ai/dsh-tools')
  const Plugin = await import('../lib/index.js')
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  new SystemPrompt(ctx, { includeHarnessIdentity: false, includeRuntimeContext: false })
  new ToolRuntime(ctx)
  const skills = []
  ctx.provide('skills'); ctx.set('skills', { register: skill => { skills.push(skill); return () => { skills.splice(skills.indexOf(skill), 1) } } })
  // Stand-ins for the loader's volatile references (builtin mode keeps the skill in memory for this check).
  const values = Plugin.snapshotConfig(Plugin.Config({ research: { skillMode: 'builtin' } }))
  const raw = Object.fromEntries(Object.keys(values).map(key => [key, { get: () => values[key] }]))
  await (await ctx.plugin({ name: 'wrap', inject: ['tools', 'systemPrompt'], apply: child => Plugin.apply(child, raw) })).await()
  assert.ok(ctx.tools.get('search'))
  await waitFor(() => skills.length === 1)
  assert.match(skills[0].content, /at most \*\*3\*\* running/)
  values.tools = { ...values.tools, searchName: 'web_lookup' }
  values.research = { ...values.research, maxSubagents: 5 }
  ctx.emit('loader/volatile-update', ['tools', 'research'])
  assert.equal(ctx.tools.get('search'), undefined)
  assert.ok(ctx.tools.get('web_lookup'))
  assert.ok(ctx.tools.get('fetch'))
  await waitFor(() => skills.length === 1 && /at most \*\*5\*\* running/.test(skills[0].content))
})

test('settings service reports readiness and writes only credentials the settings use', async t => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { TypertRegistry } = await import('@deepseek-ai/dsh-typert-registry')
  const Plugin = await import('../lib/index.js')
  const { PageCache } = await import('../lib/store.js')
  const { DecisionModel } = await import('../lib/decision.js')
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  new TypertRegistry(ctx)
  const store = new Map()
  ctx.provide('credentials'); ctx.set('credentials', {
    describe: async ref => ({ configured: store.has(String(ref)), writable: true }),
    resolve: async ref => store.has(String(ref)) ? { value: store.get(String(ref)) } : undefined,
    set: async (ref, value) => { store.set(String(ref), value) },
    unset: async ref => { store.delete(String(ref)) },
  })
  const config = Plugin.snapshotConfig(Plugin.Config({ sources: { exa: { enabled: true } } }))
  const engine = new Plugin.Engine({ config: () => config, resolveKey: async ref => store.get(ref), web: () => undefined, decision: new DecisionModel(() => config, () => undefined), cache: new PageCache() })
  const service = new Plugin.MultisearchService(ctx, engine, () => config)
  const signal = new AbortController().signal
  let status = await service.status({}, signal)
  const exa = status.sources.find(s => s.id === 'exa')
  assert.deepEqual(exa.credential, { ref: 'EXA_API_KEY', optional: false, configured: false, writable: true })
  assert.deepEqual(exa.searchReady, { ok: false, reason: '缺少凭据' })
  assert.equal(status.sources.find(s => s.id === 'brave').search, true)
  assert.equal(status.sources.find(s => s.id === 'brave').fetch, false)
  assert.deepEqual(await service.setCredential({ ref: 'EXA_API_KEY', value: ' exa-key ' }, signal), { configured: true })
  assert.equal(store.get('EXA_API_KEY'), 'exa-key')
  status = await service.status({}, signal)
  assert.equal(status.sources.find(s => s.id === 'exa').searchReady.ok, true)
  await assert.rejects(service.setCredential({ ref: 'OPENAI_API_KEY_OTHER', value: 'x' }, signal), /不属于本插件/)
  assert.deepEqual(await service.clearCredential({ ref: 'EXA_API_KEY' }, signal), { configured: false })
})

test('live-test fixes: Bright Data parsed_light, Nimble without rendering, Arctic Shift title fallback', async t => {
  const calls = mockFetch(t, [
    ['https://api.brightdata.com/request', () => ({ json: { general: {}, input: {}, organic: [{ link: 'https://bd.com/a', title: 'BD', description: 'bright data organic result' }] } })],
    ['https://sdk.nimbleway.com/v2/extract', () => ({ json: { data: { markdown: 'nimble page '.repeat(40) }, status_code: 200 } })],
    [url => url.includes('/api/posts/search') && url.includes('query='), () => ({ status: 422, json: { data: null, error: 'Timeout. Maybe slow down a bit' } })],
    [url => url.includes('/api/posts/search') && url.includes('title='), () => ({ json: { data: [{ permalink: '/r/rust/comments/abc/tokio/', title: 'Tokio thread', selftext: 'scheduler', created_utc: 1700000000 }] } })],
  ])
  const { call } = await boot(t, { sources: only(['brightdata', 'nimble', 'arcticshift'], { brightdata: { options: { serpZone: 'serp_zone' } } }) }, { credentials: { BRIGHTDATA_API_KEY: 'bd-key-123456', NIMBLE_API_KEY: 'nb-key-123456' } })
  const bd = await call('search', { queries: ['rust edition'], sources: ['brightdata'] })
  assert.match(bd.text, /https:\/\/bd\.com\/a/)
  const bdCall = calls.find(c => c.url.startsWith('https://api.brightdata.com'))
  assert.equal(bdCall.body.data_format, 'parsed_light')
  assert.doesNotMatch(bdCall.body.url, /brd_json/)
  await call('fetch', { urls: ['https://n.com/'], services: ['nimble'] })
  assert.equal(calls.find(c => c.url.startsWith('https://sdk.nimbleway.com')).body.render, false)
  const reddit = await call('search', { queries: ['tokio'], sources: ['arcticshift'], sites: ['reddit.com/r/rust'] })
  assert.match(reddit.text, /comments\/abc\/tokio/)
})

test('per-source switches: a source with search or fetch turned off is never routed to', async t => {
  const calls = mockFetch(t, [
    ['https://api.exa.ai/search', () => ({ json: { results: [{ url: 'https://e.com/a', title: 'E', highlights: ['exa result about hooks'] }] } })],
    ['https://api.tavily.com/search', () => ({ json: { results: [{ url: 'https://t.com/a', title: 'T', content: 'tavily result about hooks' }] } })],
    ['https://api.exa.ai/contents', () => ({ json: { results: [{ url: 'https://p.com/', text: 'exa page '.repeat(60) }] } })],
    ['https://api.tavily.com/extract', () => ({ json: { results: [{ url: 'https://p.com/', raw_content: 'tavily page '.repeat(60) }] } })],
  ])
  const { call, ctx } = await boot(t, {
    sources: only(['exa', 'tavily'], { exa: { fetch: false }, tavily: { search: false } }),
    routing: { defaultSources: ['exa', 'tavily'] }, fetching: { order: ['exa', 'tavily'] }, overrides: { minResults: 1, fetchRetries: 0 },
  }, { credentials: { EXA_API_KEY: 'exa-key-123456', TAVILY_API_KEY: 'tvly-key-123456' } })
  const found = await call('search', { queries: ['react hooks'] })
  assert.match(found.text, /e\.com\/a/)
  assert.ok(!calls.some(c => c.url.startsWith('https://api.tavily.com/search')))
  const explicit = await call('search', { queries: ['react hooks'], sources: ['tavily'] })
  assert.match(explicit.text, /已关闭搜索/)
  const page = await call('fetch', { urls: ['https://p.com/'] })
  assert.match(page.text, /服务 tavily/)
  assert.ok(!calls.some(c => c.url.startsWith('https://api.exa.ai/contents')))
  void ctx
})

test('Parallel goes through the free Search MCP: one session, no key by default', async t => {
  const { resetMcpSessions } = await import('../lib/sources/mcp.js')
  resetMcpSessions()
  const sse = message => ({ text: `event: message\ndata: ${JSON.stringify(message)}\n\n`, headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'sess-1' } })
  const calls = mockFetch(t, [['https://mcp.parallel.ai/mcp', (url, init, body) => {
    if (body.method === 'initialize') return sse({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', capabilities: {} } })
    if (body.method === 'notifications/initialized') return { status: 202, text: '' }
    if (body.params.name === 'web_search') return sse({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: '{}' }], structuredContent: { results: [{ url: 'https://par.com/a', title: 'P', publish_date: '2025-02-01', excerpts: ['parallel excerpt about rust editions'] }] } } })
    return sse({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify({ results: [{ url: 'https://par.com/a', title: 'P', full_content: 'parallel full page '.repeat(40), excerpts: [] }], errors: [] }) }] } })
  }]])
  const { call } = await boot(t, { sources: only(['parallel']) }, { credentials: { PARALLEL_API_KEY: 'par-key-123456' } })
  const out = await call('search', { queries: ['rust editions'], sources: ['parallel'], sites: ['doc.rust-lang.org/book'] })
  assert.match(out.text, /https:\/\/par\.com\/a/)
  const page = await call('fetch', { urls: ['https://par.com/a'], services: ['parallel'] })
  assert.match(page.text, /服务 parallel/)
  assert.equal(calls.filter(c => c.body?.method === 'initialize').length, 1, 'session reused')
  assert.ok(calls.every(c => !c.headers.authorization), 'no key sent unless sendKey')
  assert.ok(calls.filter(c => c.body?.method === 'tools/call').every(c => c.headers['mcp-session-id'] === 'sess-1'))
  const search = calls.find(c => c.body?.params?.name === 'web_search')
  assert.deepEqual(search.body.params.arguments.search_queries, ['rust editions site:doc.rust-lang.org'])
})

test('TinyFish maps filters to query parameters and per-URL errors to page states', async t => {
  const calls = mockFetch(t, [
    ['https://api.search.tinyfish.ai/', () => ({ json: { results: [{ position: 1, url: 'https://paper.org/x', title: 'Paper', snippet: 'tiny result', year: 2024, venue: 'NeurIPS', cited_by_count: 12, authors: ['A', 'B'] }] } })],
    ['https://api.fetch.tinyfish.ai/', (url, init, body) => body.urls[0].includes('login')
      ? { json: { results: [], errors: [{ url: body.urls[0], error: 'login_required' }] } }
      : { json: { results: [{ url: body.urls[0], final_url: body.urls[0], title: 'T', text: 'tinyfish page '.repeat(50) }], errors: [] } }],
  ])
  const { call } = await boot(t, { sources: only(['tinyfish']), overrides: { fetchRetries: 0 } }, { credentials: { TINYFISH_API_KEY: 'tf-key-123456' } })
  const out = await call('search', { queries: ['diffusion models'], sources: ['tinyfish'], source_types: ['academic'], after: '2023-01-01', sites: ['arxiv.org'] })
  assert.match(out.text, /https:\/\/paper\.org\/x/)
  const q = new URL(calls[0].url).searchParams
  assert.equal(q.get('domain_type'), 'research_paper')
  assert.equal(q.get('pub_year_min'), '2023')
  assert.equal(q.get('include_domains'), 'arxiv.org')
  assert.equal(calls[0].headers['x-api-key'], 'tf-key-123456')
  const ok = await call('fetch', { urls: ['https://site.com/a'], services: ['tinyfish'] })
  assert.match(ok.text, /服务 tinyfish/)
  assert.equal(calls.at(-1).body.format, 'markdown')
  const wall = await call('fetch', { urls: ['https://site.com/login'], services: ['tinyfish'] })
  assert.match(wall.text, /blocked/)
})
