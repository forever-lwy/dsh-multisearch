// The shipped lib/client.js on the real slot renderer in jsdom.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { act, cordis, dom, loaded, loadBrowserModule, React, renderer } from './harness.mjs'

const h = React.createElement
const w = dom.window
const tick = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
const click = node => act(async () => { node.dispatchEvent(new w.MouseEvent('click', { bubbles: true })) })
const setValue = async (node, value) => {
  const proto = node.tagName === 'SELECT' ? w.HTMLSelectElement.prototype : node.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(node, value)
  await act(async () => { node.dispatchEvent(new w.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })) })
}

function observable(initial) {
  let value = initial
  const listeners = new Set()
  return { getSnapshot: () => value, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) }, set: next => { value = next; for (const l of [...listeners]) l() } }
}

const ctx = new cordis.Context()
await ctx.plugin(renderer)
const localeRevision = observable({ revision: 0 })
const dictionaries = {}
const bind = ns => key => dictionaries[ns]?.[key] ?? `${ns}:${key}`
ctx.provide('locale'); ctx.set('locale', { register: (ns, lang, dict) => { if (lang === 'zh') dictionaries[ns] = dict; return () => {} }, bind })
ctx.slots.installLocale({ ...localeRevision, bind })
const currentBinding = observable({ key: 's1', ctx, hooks: {}, keyedHooks: {}, props: { sessionId: 's1' } })
ctx.slots.installScope('session', { current: currentBinding, bindingSource: () => currentBinding,
  renderArea: (value, { empty, children }) => value.key === undefined ? (empty?.() ?? null) : h(React.Fragment, null, children) })
ctx.slots.provideRoot({ hooks: {} })

const value = { profile: 'balanced', tools: { search: true, fetch: true, searchName: 'search', fetchName: 'fetch', guidance: true }, overrides: {}, limits: { maxQueries: 6 },
  routing: { autoRoute: true, defaultSources: ['exa', 'keenable'], rules: [], overlapPenalty: 25, officialDomains: [] }, fetching: { order: ['keenable', 'jina'], allowPrivateNetwork: false, minContentChars: 200, preferRender: [] },
  rerank: { mode: 'rules', url: 'u', apiKey: 'JINA_API_KEY', model: 'm' }, decision: { enabled: false, provider: '', model: '', reasoning: '', stages: ['rerank'], timeoutMs: 15000, keepThreshold: 0.35, maxCandidates: 30 },
  research: { maxSubagents: 3, maxRounds: 4, maxPages: 30, timeMinutes: 30, maxCalls: 60, modelInvocable: true },
  sources: { exa: { enabled: false, apiKey: 'EXA_API_KEY', priority: 70, baseURL: '', types: [], options: {} } } }
const form = observable({ status: 'ready', value, base: {}, user: {}, revision: 7, writable: true })
const writes = []
form.mutate = async (ops, revision) => { writes.push({ ops, revision }); return true }
ctx.provide('configForms'); ctx.set('configForms', {
  get: entry => { assert.equal(entry, 'multisearch'); return form },
  whileServed: (namespaces, register) => { assert.deepEqual(namespaces, ['multisearch']); return register(new Set(namespaces)) },
})
ctx.provide('remote'); ctx.set('remote', { $mount: async info => { assert.ok(info.methods['multisearch/status']); return () => {} } })

ctx.slots.register({ name: 'root', children: { 'settings.section': { kind: 'list', scope: 'root' }, 'plugins.bundle.config': { kind: 'keyed', scope: 'root' } } },
  ({ renderSlot }) => h('div', null, h('div', { id: 'settings' }, renderSlot('settings.section', { close() {} }))))

loadBrowserModule(fileURLToPath(new URL('../lib/client.js', import.meta.url)))
const client = loaded['@forever-lwy/dsh-multisearch']
assert.deepEqual(client.inject, ['slots', 'locale', 'configForms', 'remote'])
await ctx.plugin(client)
const container = document.getElementById('app')
await act(async () => { ctx.uiRenderer.mount(container) })
await tick()

test('Settings gains a 多源搜索 section rendered by the real renderer', () => {
  assert.equal(dictionaries.dshMultisearch.nav, '多源搜索')
  const page = document.querySelector('#settings .dms-settings')
  assert.ok(page, document.body.innerHTML.slice(0, 400))
  assert.match(page.textContent, /概览/)
  assert.match(page.textContent, /插件服务未连接/, 'without the Host remote the page says so instead of failing')
})

test('the page edits sources, saves leaf writes at the read revision, and stores keys through the remote', async () => {
  const status = {
    sources: [{ id: 'exa', label: 'Exa', blurb: 'semantic', search: true, fetch: true, map: false, defaultTypes: ['web'], defaultPriority: 70, defaultOptions: {}, defaultEnabled: false,
      credential: { ref: 'EXA_API_KEY', optional: false, configured: false, writable: true }, searchReady: { ok: false, reason: '缺少凭据' }, fetchReady: { ok: false, reason: '缺少凭据' } }],
    extraCredentials: [], resourceTypes: ['web', 'academic'], presets: { balanced: { returnResults: 8, rerank: true } }, defaultFetchOrder: ['keenable'],
  }
  const keyWrites = []
  const remote = {
    status: async () => status, models: async () => ({ providers: [] }),
    setCredential: async (ref, value) => { keyWrites.push([ref, value]); return { configured: true } },
    clearCredential: async () => ({ configured: false }),
  }
  const host = document.createElement('div'); document.body.appendChild(host)
  const local = (await import('react-dom/client')).createRoot(host)
  await act(async () => local.render(h(client.MultisearchSettings, { form, remote: () => remote })))
  await tick()
  assert.match(host.textContent, /Exa/)
  const tab = [...host.querySelectorAll('[role=tab]')].find(b => b.textContent === '搜索源与密钥')
  await click(tab)
  const card = host.querySelector('.dms-card')
  assert.match(card.textContent, /搜索：缺少凭据/)
  await click(card.querySelector('.dms-card-head input[type=checkbox]'))
  const save = host.querySelector('[data-action=save]')
  assert.equal(save.disabled, false)
  await click(save)
  assert.deepEqual(writes.at(-1), { ops: [{ op: 'set', path: ['sources', 'exa', 'enabled'], value: true }], revision: 7 })
  // Each capability has its own switch.
  const fetchSwitch = card.querySelector('input[data-cap=fetch]')
  assert.ok(card.querySelector('input[data-cap=search]').checked)
  await click(fetchSwitch)
  await click(host.querySelector('[data-action=save]'))
  assert.deepEqual(writes.at(-1).ops, [{ op: 'set', path: ['sources', 'exa', 'fetch'], value: false }])
  const key = card.querySelector('input[type=password]')
  await setValue(key, 'exa-secret')
  await click([...card.querySelectorAll('button')].find(b => b.textContent === '保存密钥'))
  assert.deepEqual(keyWrites, [['EXA_API_KEY', 'exa-secret']])
  assert.match(card.textContent, /已保存/)
  // Overrides: a blank field unsets, a value sets.
  await click([...host.querySelectorAll('[role=tab]')].find(b => b.textContent === '常规与档位'))
  const returnResults = [...host.querySelectorAll('.dms-field')].find(f => f.textContent.startsWith('返回条数')).querySelector('input')
  assert.equal(returnResults.placeholder, '8')
  await setValue(returnResults, '12')
  await click(host.querySelector('[data-action=save]'))
  assert.deepEqual(writes.at(-1).ops, [{ op: 'set', path: ['overrides', 'returnResults'], value: 12 }])
  // Invalid JSON blocks saving.
  await click([...host.querySelectorAll('[role=tab]')].find(b => b.textContent === '路由与抓取'))
  const rules = [...host.querySelectorAll('.dms-field')].find(f => f.textContent.startsWith('自定义匹配规则')).querySelector('textarea')
  const before = writes.length
  await setValue(rules, '[{oops')
  await click(host.querySelector('[data-action=save]'))
  assert.equal(writes.length, before)
  assert.match(host.textContent, /JSON 无效/)
  await act(async () => local.unmount())
})
