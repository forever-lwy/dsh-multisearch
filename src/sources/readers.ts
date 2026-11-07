/** Page readers and crawlers, plus the built-in DSH web seam and a direct HTTP reader. */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { SourceAdapter } from '../types.js'
import { SourceError, http } from '../http.js'
import { htmlToMarkdown } from '../html.js'
import { arr, clip, hit, hits, joinUrl, num, requireKey, str, withSiteOperators } from './util.js'

export const jina: SourceAdapter = {
  spec: {
    id: 'jina', label: 'Jina Reader', engine: 'jina', priority: 52,
    caps: { search: true, fetch: true, pdf: true, render: true }, types: ['web'],
    filters: { site: true }, credential: 'JINA_API_KEY', keyOptional: true, defaultEnabled: true,
    blurb: '把已知 URL 转成适合模型阅读的正文（支持 PDF）；搜索需要 Key',
  },
  async search(q, env) {
    const key = requireKey(env.apiKey, 'Jina Search')
    const data = await env.http.json('https://s.jina.ai/', {
      query: { q: q.query, num: Math.min(20, q.maxResults) },
      headers: { authorization: `Bearer ${key}`, 'x-respond-with': 'no-content', ...(q.need.sites[0] ? { 'x-site': q.need.sites[0] } : {}) },
      signal: q.signal, timeoutMs: q.timeoutMs,
    })
    return { hits: hits(arr(data.data).map(r => hit(r.url, { title: str(r.title), snippet: clip(str(r.description) ?? str(r.content), 600), publishedAt: str(r.date) }))) }
  },
  async fetch(r, env) {
    const data = await env.http.json(`${(env.baseURL || 'https://r.jina.ai').replace(/\/+$/, '')}/${r.url}`, {
      headers: {
        'x-return-format': 'markdown', ...(env.apiKey ? { authorization: `Bearer ${env.apiKey}` } : {}),
        ...(r.live ? { 'x-no-cache': 'true' } : {}), 'x-retain-images': 'none', 'x-remove-selector': 'nav, header, footer, aside, [role=navigation], .navbox, #toc',
      },
      signal: r.signal, timeoutMs: r.timeoutMs,
    })
    const page = data.data ?? {}
    const status = num(page.metadata?.statusCode) ?? num(data.code)
    return { url: r.url, finalUrl: str(page.url), title: str(page.title), content: str(page.content) ?? '', publishedAt: str(page.publishedTime), statusCode: status === 200 ? 200 : status }
  },
}

export const firecrawl: SourceAdapter = {
  spec: {
    id: 'firecrawl', label: 'Firecrawl', engine: 'firecrawl', priority: 52,
    caps: { search: true, fetch: true, map: true, pdf: true, render: true }, types: ['web', 'documentation'],
    filters: { site: true, time: true, region: true }, credential: 'FIRECRAWL_API_KEY',
    blurb: '把网页、文档站和 PDF 转成 Markdown，支持站点 URL 发现，适合文档采集',
  },
  async search(q, env) {
    const key = requireKey(env.apiKey, 'Firecrawl')
    const data = await env.http.json(joinUrl(env.baseURL, 'https://api.firecrawl.dev', '/v2/search'), {
      body: {
        query: withSiteOperators(q.query, q.need), limit: Math.min(20, q.maxResults),
        ...(q.need.timeRange ? { tbs: `qdr:${q.need.timeRange[0]}` } : {}), ...(q.need.region ? { location: q.need.region } : {}),
      },
      headers: { authorization: `Bearer ${key}` }, signal: q.signal, timeoutMs: q.timeoutMs,
    })
    const list: any[] = Array.isArray(data.data) ? data.data : [...arr(data.data?.web), ...arr(data.data?.news)]
    return { hits: hits(list.map(r => hit(r.url, { title: str(r.title), snippet: clip(str(r.description) ?? str(r.snippet), 600), publishedAt: str(r.date) }))) }
  },
  async fetch(r, env) {
    const key = requireKey(env.apiKey, 'Firecrawl')
    const data = await env.http.json(joinUrl(env.baseURL, 'https://api.firecrawl.dev', '/v2/scrape'), {
      body: { url: r.url, formats: ['markdown'], onlyMainContent: true, ...(r.live ? { maxAge: 0 } : {}) },
      headers: { authorization: `Bearer ${key}` }, signal: r.signal, timeoutMs: r.timeoutMs,
    })
    if (data.success === false) throw new SourceError(`Firecrawl: ${str(data.error) ?? 'scrape failed'}`, 'upstream')
    const meta = data.data?.metadata ?? {}
    return { url: r.url, finalUrl: str(meta.sourceURL) ?? str(meta.url), title: str(meta.title), content: str(data.data?.markdown) ?? '', statusCode: num(meta.statusCode), contentType: str(meta.contentType) }
  },
  async map(r, env) {
    const key = requireKey(env.apiKey, 'Firecrawl')
    const data = await env.http.json(joinUrl(env.baseURL, 'https://api.firecrawl.dev', '/v2/map'), {
      body: { url: r.url, limit: r.maxPages * 3, includeSubdomains: !r.sameDomain },
      headers: { authorization: `Bearer ${key}` }, signal: r.signal, timeoutMs: r.timeoutMs,
    })
    return arr(data.links).map(link => typeof link === 'string' ? { url: link } : { url: String(link?.url ?? ''), title: str(link?.title) }).filter(link => link.url)
  },
}

export const scrapingant: SourceAdapter = {
  spec: {
    id: 'scrapingant', label: 'ScrapingAnt', engine: 'scrapingant', priority: 45,
    caps: { fetch: true, render: true }, types: ['web'], filters: {}, credential: 'SCRAPINGANT_API_KEY',
    blurb: '浏览器渲染加代理抓取，适合依赖 JavaScript 加载、直接请求拿不到正文的网站',
    options: { proxyCountry: '' },
  },
  async fetch(r, env) {
    const key = requireKey(env.apiKey, 'ScrapingAnt')
    const data = await env.http.json(joinUrl(env.baseURL, 'https://api.scrapingant.com', '/v2/markdown'), {
      query: { url: r.url, browser: true, proxy_country: String(env.options.proxyCountry || '') || undefined },
      headers: { 'x-api-key': key }, signal: r.signal, timeoutMs: r.timeoutMs,
    })
    return { url: r.url, finalUrl: str(data.url), content: str(data.markdown) ?? str(data.content) ?? '' }
  },
}

export const crawl4ai: SourceAdapter = {
  spec: {
    id: 'crawl4ai', label: 'Crawl4AI（自建）', engine: 'crawl4ai', priority: 45,
    caps: { fetch: true, render: true }, types: ['web'], filters: {}, credential: 'CRAWL4AI_API_TOKEN', keyOptional: true,
    blurb: '自建浏览器抓取与正文清洗服务，需要在设置中填写服务地址',
    options: { filter: 'fit' },
  },
  async fetch(r, env) {
    if (!env.baseURL) throw new SourceError('Crawl4AI 未配置服务地址', 'no_credential')
    const data = await env.http.json(joinUrl(env.baseURL, '', '/md'), {
      body: { url: r.url, f: String(env.options.filter || 'fit'), ...(r.focus ? { q: r.focus } : {}), c: r.live ? '0' : '1' },
      headers: env.apiKey ? { authorization: `Bearer ${env.apiKey}` } : {}, signal: r.signal, timeoutMs: r.timeoutMs,
    })
    if (data.success === false) throw new SourceError(`Crawl4AI: ${str(data.error) ?? 'crawl failed'}`, 'upstream')
    const markdown = typeof data.markdown === 'string' ? data.markdown : str(data.markdown?.fit_markdown) ?? str(data.markdown?.raw_markdown)
    return { url: r.url, content: markdown ?? '' }
  },
}

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./]
function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) return PRIVATE_V4.some(pattern => pattern.test(address))
  const lower = address.toLowerCase()
  return lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80') || lower.startsWith('::ffff:') && isPrivateAddress(lower.slice(7))
}

/** Refuse loopback and private-network targets unless explicitly allowed. */
export async function assertPublicUrl(target: string, allowPrivate: boolean): Promise<URL> {
  let url: URL
  try { url = new URL(target) } catch { throw new SourceError(`无效 URL：${target}`, 'invalid_url') }
  if (!/^https?:$/.test(url.protocol)) throw new SourceError(`仅支持 http/https：${target}`, 'invalid_url')
  if (allowPrivate) return url
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) throw new SourceError('拒绝访问本机或内网地址', 'blocked_url')
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map(entry => entry.address)
  if (addresses.some(isPrivateAddress)) throw new SourceError('拒绝访问本机或内网地址', 'blocked_url')
  return url
}

export function directHttp(allowPrivate: () => boolean): SourceAdapter {
  return {
    spec: {
      id: 'http', label: '直接请求', engine: 'http', priority: 40,
      caps: { fetch: true }, types: ['web'], filters: {}, defaultEnabled: true,
      blurb: '插件自己发起 HTTP 请求并转换正文，无需 Key，不渲染 JavaScript',
    },
    async fetch(r) {
      await assertPublicUrl(r.url, allowPrivate())
      const res = await http.text(r.url, { signal: r.signal, timeoutMs: r.timeoutMs, maxBytes: 6 * 1024 * 1024 })
      await assertPublicUrl(res.url, allowPrivate())
      const type = res.contentType.toLowerCase()
      if (type.includes('application/pdf')) throw new SourceError('PDF 需要支持 PDF 的读取服务', 'unsupported_type', res.status)
      if (type.includes('html') || /^\s*<(!doctype|html)/i.test(res.text)) {
        const doc = htmlToMarkdown(res.text, res.url)
        return { url: r.url, finalUrl: res.url, title: doc.title, content: doc.markdown, statusCode: res.status, contentType: type, publishedAt: doc.publishedAt }
      }
      if (/^(text\/|application\/(json|xml|x-yaml|javascript))/.test(type) || type === '') return { url: r.url, finalUrl: res.url, content: res.text, statusCode: res.status, contentType: type }
      throw new SourceError(`不支持的内容类型 ${type}`, 'unsupported_type', res.status)
    },
  }
}

/** DSH's own `ctx.web` seam: whichever search/fetch provider the deployment configured. */
export function builtinWeb(getWeb: () => any): SourceAdapter {
  return {
    spec: {
      id: 'builtin', label: 'DSH 内置网页服务', engine: 'builtin', priority: 40,
      caps: { search: true, fetch: true }, types: ['web'], filters: {}, defaultEnabled: true,
      blurb: 'DSH 自带的搜索/抓取后端（如 DeepSeek 搜索），作为兜底来源',
    },
    async search(q) {
      const web = getWeb()
      if (!web) throw new SourceError('DSH web 服务不可用', 'unavailable')
      const result = await web.search({ query: withSiteOperators(q.query, q.need), maxResults: q.maxResults }, AbortSignal.any([q.signal, AbortSignal.timeout(q.timeoutMs)]))
      return {
        hits: hits(arr(result.sources).map(s => hit(s.url, { title: str(s.title), snippet: clip(str(s.summary) ?? str(s.snippet), 600), publishedAt: str(s.publishedAt) }))),
        generated: str(result.content),
      }
    },
    async fetch(r) {
      const web = getWeb()
      if (!web) throw new SourceError('DSH web 服务不可用', 'unavailable')
      const result = await web.fetch({ url: r.url }, AbortSignal.any([r.signal, AbortSignal.timeout(r.timeoutMs)]))
      if (result.body.kind === 'html') {
        const doc = htmlToMarkdown(result.body.content, result.url)
        return { url: r.url, finalUrl: result.url, title: doc.title, content: doc.markdown, statusCode: result.statusCode, truncated: result.truncated }
      }
      return { url: r.url, finalUrl: result.url, content: result.body.content, statusCode: result.statusCode, truncated: result.truncated }
    },
  }
}
