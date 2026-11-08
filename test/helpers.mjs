import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import * as Plugin from '../lib/index.js'
import { ALL_SPECS } from '../lib/config.js'

// The skill file goes to $DSH_HOME/skills; never let tests touch the real home.
export const dshHome = process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dms-home-'))

/**
 * Replace global fetch with a router: `routes` is a list of [predicate(url, init), handler(url, init, body)].
 * Handlers return {status?, json?, text?, headers?, delay?} or throw. Unmatched requests fail loudly.
 */
export function mockFetch(t, routes) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    let body
    try { body = init.body ? JSON.parse(init.body) : undefined } catch { body = init.body }
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body })
    const route = routes.find(([match]) => typeof match === 'string' ? url.startsWith(match) : match(url, init))
    if (!route) throw new TypeError(`fetch failed: unmocked ${url}`)
    const spec = await route[1](url, init, body)
    if (spec.delay) await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, spec.delay)
      init.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal.reason ?? new DOMException('aborted', 'AbortError')) }, { once: true })
    })
    const text = spec.json !== undefined ? JSON.stringify(spec.json) : spec.text ?? ''
    const response = new Response(text, { status: spec.status ?? 200, headers: { 'content-type': spec.json !== undefined ? 'application/json' : 'text/html; charset=utf-8', ...spec.headers } })
    if (spec.url) Object.defineProperty(response, 'url', { value: spec.url })
    return response
  }
  t.after(() => { globalThis.fetch = original })
  return calls
}

/** Boot the real tool and prompt runtimes plus the plugin with `config`. */
export async function boot(t, config = {}, { credentials = {}, web } = {}) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  new SystemPrompt(ctx, { includeHarnessIdentity: false, includeRuntimeContext: false })
  new ToolRuntime(ctx)
  await ctx.plugin(NativeToolExecutor)
  ctx.provide('credentials', { describe: async () => ({ configured: false, writable: true }), resolve: async ref => credentials[ref] ? { value: credentials[ref], source: 'test' } : undefined })
  if (web) ctx.provide('web', web)
  const fiber = await ctx.plugin(Plugin, config)
  await fiber.await()
  if (fiber.state !== 2) throw new Error(`plugin did not start: state ${fiber.state}`)
  let n = 0
  const call = async (name, args, signal = new AbortController().signal) => {
    const batch = await ctx.tools.execute({ calls: [{ type: 'tool-call', id: `call-${++n}`, name, arguments: JSON.stringify(args) }], signal })
    const result = batch.results[0].result
    return { ...result, text: result.content.filter(b => b.type === 'text').map(b => b.text).join('\n') }
  }
  return { ctx, fiber, call }
}

/** Sources config enabling exactly `ids` (all others off). */
export function only(ids, extra = {}) {
  const sources = {}
  for (const id of ALL_SPECS.map(spec => spec.id)) {
    sources[id] = { enabled: ids.includes(id), ...(extra[id] ?? {}) }
  }
  return sources
}
