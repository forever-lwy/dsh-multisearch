/** Task-scoped memory: stable reference ids, candidates of each search, fetched pages; plus a shared page cache. */
import type { Candidate, ReadStatus, SearchNeed } from './types.js'
import { urlKey } from './text.js'

export interface PageRecord {
  url: string
  finalUrl?: string
  title?: string
  content: string
  service: string
  fetchedAt: number
  status: 'ok' | 'partial'
  truncated: boolean
  publishedAt?: string
  generated?: boolean
}

export interface RefEntry {
  ref: string
  url: string
  title: string
  snippet: string
  sources: string[]
  publishedAt?: string
  status: ReadStatus
  page?: PageRecord
}

export interface SearchRecord {
  id: string
  need: SearchNeed
  /** Candidate refs in final ranked order, including those not shown. */
  ranked: string[]
  shown: number
  createdAt: number
}

const MAX_REFS = 2000
const MAX_SEARCHES = 100

export class TaskStore {
  private refsByKey = new Map<string, string>()
  private entries = new Map<string, RefEntry>()
  private searches = new Map<string, SearchRecord>()
  private nextRef = 1
  private nextSearch = 1
  lastUsed = Date.now()

  refFor(candidate: Pick<Candidate, 'url' | 'title' | 'snippet' | 'publishedAt'> & { sources?: string[] }): RefEntry {
    const key = urlKey(candidate.url)
    let ref = this.refsByKey.get(key)
    let entry = ref ? this.entries.get(ref) : undefined
    if (!entry) {
      ref = `S${this.nextRef++}`
      entry = { ref, url: candidate.url, title: candidate.title, snippet: candidate.snippet, sources: [], publishedAt: candidate.publishedAt, status: 'unread' }
      this.refsByKey.set(key, ref)
      this.entries.set(ref, entry)
      if (this.entries.size > MAX_REFS) {
        const oldest = this.entries.keys().next().value!
        this.refsByKey.delete(urlKey(this.entries.get(oldest)!.url))
        this.entries.delete(oldest)
      }
    } else {
      if (candidate.snippet.length > entry.snippet.length) entry.snippet = candidate.snippet
      entry.publishedAt ??= candidate.publishedAt
    }
    for (const source of candidate.sources ?? []) if (!entry.sources.includes(source)) entry.sources.push(source)
    return entry
  }

  get(ref: string): RefEntry | undefined {
    return this.entries.get(ref.toUpperCase())
  }

  byUrl(url: string): RefEntry | undefined {
    const ref = this.refsByKey.get(urlKey(url))
    return ref ? this.entries.get(ref) : undefined
  }

  saveSearch(need: SearchNeed, ranked: string[], shown: number): SearchRecord {
    const record: SearchRecord = { id: `Q${this.nextSearch++}`, need, ranked, shown, createdAt: Date.now() }
    this.searches.set(record.id, record)
    if (this.searches.size > MAX_SEARCHES) this.searches.delete(this.searches.keys().next().value!)
    return record
  }

  /** Saved searches of this task, newest first. */
  recentSearches(): SearchRecord[] {
    return [...this.searches.values()].reverse()
  }

  search(id: string): SearchRecord | undefined {
    return this.searches.get(id.toUpperCase())
  }
}

/** Pages shared across tasks, keyed by URL, honoring the configured freshness. */
export class PageCache {
  private pages = new Map<string, PageRecord>()
  constructor(private readonly capacity = 300) {}

  get(url: string, ttlMs: number): PageRecord | undefined {
    const key = urlKey(url)
    const page = this.pages.get(key)
    if (!page) return undefined
    if (Date.now() - page.fetchedAt > ttlMs) { this.pages.delete(key); return undefined }
    this.pages.delete(key)
    this.pages.set(key, page)
    return page
  }

  set(page: PageRecord): void {
    const key = urlKey(page.url)
    this.pages.delete(key)
    this.pages.set(key, page)
    while (this.pages.size > this.capacity) this.pages.delete(this.pages.keys().next().value!)
  }
}

/** One TaskStore per session (task); idle stores expire. */
export class StoreRegistry {
  private stores = new Map<string, TaskStore>()
  constructor(private readonly idleMs = 6 * 3600_000, private readonly capacity = 200) {}

  for(taskId: string): TaskStore {
    let store = this.stores.get(taskId)
    if (!store) {
      store = new TaskStore()
      this.stores.set(taskId, store)
      const now = Date.now()
      for (const [id, s] of this.stores) if (now - s.lastUsed > this.idleMs) this.stores.delete(id)
      while (this.stores.size > this.capacity) this.stores.delete(this.stores.keys().next().value!)
    }
    store.lastUsed = Date.now()
    return store
  }
}
