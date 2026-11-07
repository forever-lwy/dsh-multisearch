import { urlKey } from './text.js';
const MAX_REFS = 2000;
const MAX_SEARCHES = 100;
export class TaskStore {
    refsByKey = new Map();
    entries = new Map();
    searches = new Map();
    nextRef = 1;
    nextSearch = 1;
    lastUsed = Date.now();
    refFor(candidate) {
        const key = urlKey(candidate.url);
        let ref = this.refsByKey.get(key);
        let entry = ref ? this.entries.get(ref) : undefined;
        if (!entry) {
            ref = `S${this.nextRef++}`;
            entry = { ref, url: candidate.url, title: candidate.title, snippet: candidate.snippet, sources: [], publishedAt: candidate.publishedAt, status: 'unread' };
            this.refsByKey.set(key, ref);
            this.entries.set(ref, entry);
            if (this.entries.size > MAX_REFS) {
                const oldest = this.entries.keys().next().value;
                this.refsByKey.delete(urlKey(this.entries.get(oldest).url));
                this.entries.delete(oldest);
            }
        }
        else {
            if (candidate.snippet.length > entry.snippet.length)
                entry.snippet = candidate.snippet;
            entry.publishedAt ??= candidate.publishedAt;
        }
        for (const source of candidate.sources ?? [])
            if (!entry.sources.includes(source))
                entry.sources.push(source);
        return entry;
    }
    get(ref) {
        return this.entries.get(ref.toUpperCase());
    }
    byUrl(url) {
        const ref = this.refsByKey.get(urlKey(url));
        return ref ? this.entries.get(ref) : undefined;
    }
    saveSearch(need, ranked, shown) {
        const record = { id: `Q${this.nextSearch++}`, need, ranked, shown, createdAt: Date.now() };
        this.searches.set(record.id, record);
        if (this.searches.size > MAX_SEARCHES)
            this.searches.delete(this.searches.keys().next().value);
        return record;
    }
    /** Saved searches of this task, newest first. */
    recentSearches() {
        return [...this.searches.values()].reverse();
    }
    search(id) {
        return this.searches.get(id.toUpperCase());
    }
}
/** Pages shared across tasks, keyed by URL, honoring the configured freshness. */
export class PageCache {
    capacity;
    pages = new Map();
    constructor(capacity = 300) {
        this.capacity = capacity;
    }
    get(url, ttlMs) {
        const key = urlKey(url);
        const page = this.pages.get(key);
        if (!page)
            return undefined;
        if (Date.now() - page.fetchedAt > ttlMs) {
            this.pages.delete(key);
            return undefined;
        }
        this.pages.delete(key);
        this.pages.set(key, page);
        return page;
    }
    set(page) {
        const key = urlKey(page.url);
        this.pages.delete(key);
        this.pages.set(key, page);
        while (this.pages.size > this.capacity)
            this.pages.delete(this.pages.keys().next().value);
    }
}
/** One TaskStore per session (task); idle stores expire. */
export class StoreRegistry {
    idleMs;
    capacity;
    stores = new Map();
    constructor(idleMs = 6 * 3600_000, capacity = 200) {
        this.idleMs = idleMs;
        this.capacity = capacity;
    }
    for(taskId) {
        let store = this.stores.get(taskId);
        if (!store) {
            store = new TaskStore();
            this.stores.set(taskId, store);
            const now = Date.now();
            for (const [id, s] of this.stores)
                if (now - s.lastUsed > this.idleMs)
                    this.stores.delete(id);
            while (this.stores.size > this.capacity)
                this.stores.delete(this.stores.keys().next().value);
        }
        store.lastUsed = Date.now();
        return store;
    }
}
