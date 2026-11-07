import { anysearch, brave, brightdata, contextdev, exa, keenable, linkup, nimble, parallel, tavily, yuanbao, you } from './general.js';
import { crawl4ai, firecrawl, jina, scrapingant } from './readers.js';
import { arcticshift, hackernews, weir } from './community.js';
import { consensus, context7, gemini, huggingface, openai, sciverse } from './domain.js';
export { builtinWeb, directHttp, assertPublicUrl } from './readers.js';
export { rerankService } from './domain.js';
/** Keyed adapters in settings order. `builtin` and `http` are added at apply time. */
export const STATIC_ADAPTERS = [
    keenable, anysearch, exa, tavily, parallel, nimble, brave, you, linkup, yuanbao,
    gemini, openai, brightdata, firecrawl, contextdev, jina, scrapingant, crawl4ai,
    weir, arcticshift, hackernews, consensus, sciverse, huggingface, context7,
];
