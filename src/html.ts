/** HTML → markdown for the direct and built-in fetchers: keep main content, drop chrome and active content. */
import TurndownService from 'turndown'
// @ts-expect-error domino ships no types
import domino from '@mixmark-io/domino'

const DROP = 'script,style,noscript,template,iframe,object,embed,svg,canvas,form,button,select,input,textarea,nav,footer,aside,header[role=banner],[aria-hidden=true],[hidden],.cookie,.cookies,#cookie-banner,.advert,.ads,.sidebar'

let service: TurndownService | undefined
function turndown(): TurndownService {
  if (service) return service
  service = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' })
  // Tables as simple pipe rows: keeps header cells, which excerpts must preserve.
  service.addRule('tableCell', {
    filter: ['th', 'td'],
    replacement: (content: string, node: any) => {
      const text = content.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()
      return `${node.previousElementSibling ? ' ' : '| '}${text} |`
    },
  })
  service.addRule('tableRow', {
    filter: 'tr',
    replacement: (content: string, node: any) => {
      const isHeader = node.parentNode?.nodeName === 'THEAD' || (!node.previousElementSibling && node.querySelector?.('th'))
      const cells = node.children?.length ?? 1
      return `\n${content}${isHeader ? `\n|${' --- |'.repeat(cells)}` : ''}`
    },
  })
  service.addRule('table', { filter: 'table', replacement: (content: string) => `\n\n${content.trim()}\n\n` })
  service.addRule('img', { filter: 'img', replacement: (_c: string, node: any) => {
    const alt = (node.getAttribute?.('alt') ?? '').trim()
    return alt ? `[image: ${alt}]` : ''
  } })
  return service
}

export interface HtmlDocument {
  title?: string
  markdown: string
  links: { url: string; text: string }[]
  publishedAt?: string
}

function pickMain(document: any): any {
  const candidates = ['main article', 'article', 'main', '[role=main]', '#content', '.content', '.post', '.markdown-body', '#main']
  for (const selector of candidates) {
    const found = Array.from(document.querySelectorAll(selector)) as any[]
    let best: any
    let bestLength = 0
    for (const node of found) {
      const length = (node.textContent ?? '').length
      if (length > bestLength) { best = node; bestLength = length }
    }
    if (best && bestLength > 400) return best
  }
  return document.body ?? document.documentElement
}

export function htmlToMarkdown(html: string, baseUrl: string): HtmlDocument {
  const document = domino.createDocument(html)
  const title = (document.querySelector('meta[property="og:title"]')?.getAttribute('content')
    ?? document.querySelector('title')?.textContent ?? '').trim() || undefined
  const publishedAt = document.querySelector('meta[property="article:published_time"]')?.getAttribute('content')
    ?? document.querySelector('time[datetime]')?.getAttribute('datetime') ?? undefined
  const links: { url: string; text: string }[] = []
  for (const anchor of Array.from(document.querySelectorAll('a[href]')) as any[]) {
    const href = anchor.getAttribute('href') ?? ''
    if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) continue
    try {
      links.push({ url: new URL(href, baseUrl).toString(), text: (anchor.textContent ?? '').trim().slice(0, 120) })
    } catch { /* ignore malformed */ }
  }
  for (const node of Array.from(document.querySelectorAll(DROP)) as any[]) node.parentNode?.removeChild(node)
  const main = pickMain(document)
  let markdown = ''
  try {
    markdown = turndown().turndown(main?.innerHTML ?? '')
  } catch {
    markdown = (main?.textContent ?? '').replace(/[ \t]+/g, ' ')
  }
  markdown = markdown.replace(/\n{3,}/g, '\n\n').trim()
  return { title, markdown, links, publishedAt: publishedAt || undefined }
}

/** Markdown links, for crawling over services that return markdown only. */
export function markdownLinks(markdown: string, baseUrl: string): { url: string; text: string }[] {
  const out: { url: string; text: string }[] = []
  for (const match of markdown.matchAll(/\[([^\]]{0,200})\]\((\S+?)(?:\s+"[^"]*")?\)/g)) {
    try {
      out.push({ url: new URL(match[2]!, baseUrl).toString(), text: match[1]!.trim() })
    } catch { /* ignore */ }
  }
  return out
}
