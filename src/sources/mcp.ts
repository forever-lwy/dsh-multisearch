/** Minimal MCP client over Streamable HTTP: initialize once per endpoint, then tools/call. */
import { randomBytes } from 'node:crypto'
import { SourceError } from '../http.js'
import type { HttpClient } from '../types.js'

const PROTOCOL = '2025-06-18'
/** Stable for the plugin process; free tiers use it for rate limiting and log correlation. */
export const MCP_SESSION_TAG = randomBytes(16).toString('hex')

interface McpTarget {
  http: HttpClient
  endpoint: string
  headers: Record<string, string>
  signal: AbortSignal
  timeoutMs: number
}

const sessions = new Map<string, Promise<string | undefined>>()
let nextId = 1

function messages(text: string, contentType: string): any[] {
  if (!/event-stream/i.test(contentType)) {
    try { const value = JSON.parse(text); return Array.isArray(value) ? value : [value] } catch { return [] }
  }
  const out: any[] = []
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (!data) continue
    try { out.push(JSON.parse(data)) } catch { /* keep-alive or partial event */ }
  }
  return out
}

function classify(status: number, message: string): SourceError {
  const code = status === 401 || status === 403 ? 'auth' : status === 402 || /\b402\b|insufficient credit/i.test(message) ? 'quota'
    : status === 429 || /\b429\b|rate.?limit/i.test(message) ? 'rate_limited' : status >= 500 ? 'upstream' : 'bad_request'
  return new SourceError(message, code, status || undefined)
}

async function post(target: McpTarget, body: unknown, session?: string) {
  const res = await target.http.text(target.endpoint, {
    method: 'POST', body, signal: target.signal, timeoutMs: target.timeoutMs,
    headers: { accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL, ...target.headers, ...(session ? { 'mcp-session-id': session } : {}) },
  })
  return res
}

async function open(target: McpTarget): Promise<string | undefined> {
  const id = nextId++
  const res = await post(target, { jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'dsh-multisearch', version: '0.1' } } })
  if (res.status >= 400) throw classify(res.status, `MCP initialize HTTP ${res.status}: ${res.text.slice(0, 200)}`)
  const reply = messages(res.text, res.contentType).find(m => m?.id === id)
  if (reply?.error) throw classify(0, `MCP initialize: ${reply.error.message ?? 'error'}`)
  const session = res.headers?.['mcp-session-id']
  await post(target, { jsonrpc: '2.0', method: 'notifications/initialized' }, session)
  return session
}

/** Call one tool; returns its structured content, or the JSON parsed from its text content. */
export async function callTool(target: McpTarget, name: string, args: Record<string, unknown>): Promise<any> {
  const key = `${target.endpoint}\n${target.headers.authorization ?? ''}`
  for (let attempt = 0; attempt < 2; attempt++) {
    let pending = sessions.get(key)
    if (!pending) {
      pending = open(target)
      sessions.set(key, pending)
      pending.catch(() => sessions.delete(key))
    }
    const session = await pending
    const id = nextId++
    const res = await post(target, { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, session)
    // An expired or unknown session answers 404 (spec) or 400; open a new one once.
    if ((res.status === 404 || res.status === 400) && session && attempt === 0) { sessions.delete(key); continue }
    if (res.status >= 400) throw classify(res.status, `MCP HTTP ${res.status}: ${res.text.slice(0, 200)}`)
    const reply = messages(res.text, res.contentType).find(m => m?.id === id)
    if (!reply) throw new SourceError('MCP: no reply to tools/call', 'bad_response')
    if (reply.error) throw classify(0, `MCP ${name}: ${reply.error.message ?? 'error'}`)
    const result = reply.result ?? {}
    const text = (Array.isArray(result.content) ? result.content : []).filter((c: any) => c?.type === 'text').map((c: any) => String(c.text ?? '')).join('\n')
    if (result.isError) throw classify(0, `${name}: ${text.slice(0, 300) || 'tool error'}`)
    if (result.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent
    try { return JSON.parse(text) } catch { return { text } }
  }
  throw new SourceError('MCP session could not be established', 'upstream')
}

/** For tests: forget cached sessions. */
export function resetMcpSessions(): void { sessions.clear() }
