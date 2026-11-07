// Boot the real slot renderer (dsh-client-ui-renderer) inside jsdom with a
// real Cordis Context, plus a minimal Session scope adapter.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'

const require = createRequire(import.meta.url)
export const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' })
const w = dom.window
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'Event', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'StorageEvent'])
  if (w[key] !== undefined) Object.defineProperty(globalThis, key, { value: key === 'getComputedStyle' || key.endsWith('AnimationFrame') ? w[key].bind(w) : w[key], configurable: true, writable: true })
globalThis.navigator ??= w.navigator
if (!w.PointerEvent) { w.PointerEvent = class PointerEvent extends w.MouseEvent {}; globalThis.PointerEvent = w.PointerEvent }
globalThis.IS_REACT_ACT_ENVIRONMENT = true
w.matchMedia ??= query => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })

export const React = await import('react')
export const { act } = React
const jsxRuntime = await import('react/jsx-runtime')
const reactDom = await import('react-dom')
const reactDomClient = await import('react-dom/client')
export const cordis = await import('@deepseek-ai/cordis')
const slotsCore = await import('@deepseek-ai/dsh-client-ui-slots')

const zod = await import('zod')
const h = React.createElement

export const primitives = {}

const modules = {
  react: React, 'react/jsx-runtime': jsxRuntime, 'react-dom': reactDom, 'react-dom/client': reactDomClient,
  '@deepseek-ai/cordis': cordis, '@deepseek-ai/dsh-client-ui-slots': slotsCore, zod,
  '@deepseek-ai/dsh-client-ui-primitives': primitives,
}
const loaded = {}
w.__ModuleLoader__ = { load: ({ id, factory }) => { loaded[id] = factory(name => {
  if (!(name in modules)) throw new Error(`unexpected require ${name} from ${id}`)
  return modules[name]
}) } }
export function loadBrowserModule(path) {
  new w.Function(readFileSync(path, 'utf8'))()
}
loadBrowserModule(require.resolve('@deepseek-ai/dsh-client-ui-renderer/package.json').replace(/package\.json$/, 'lib/client.js'))
export const renderer = loaded['@deepseek-ai/dsh-client-ui-renderer']
export { loaded }
