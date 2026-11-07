import type { SourceAdapter } from '../types.js';
export { builtinWeb, directHttp, assertPublicUrl } from './readers.js';
export { rerankService } from './domain.js';
/** Keyed adapters in settings order. `builtin` and `http` are added at apply time. */
export declare const STATIC_ADAPTERS: SourceAdapter[];
