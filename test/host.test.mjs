import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boot, mockFetch, only } from './helpers.mjs'

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

test('deep-research skill registers with the configured budget', async t => {
  const registered = []
  const { ctx } = await boot(t, { research: { maxSubagents: 4 } })
  ctx.provide('skills', { register: skill => { registered.push(skill); return () => {} } })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(registered.length, 1)
  assert.equal(registered[0].name, 'deep-research')
  assert.match(registered[0].content, /at most \*\*4\*\* running research directions/)
})
