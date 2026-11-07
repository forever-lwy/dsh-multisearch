/**
 * Browser half: Settings → 多源搜索, also shown as this bundle's page on the Plugins page.
 * Registered only while the Host row serves its settings namespace.
 */
import type { Context } from '@deepseek-ai/cordis';
import { MultisearchSettings } from './Settings.js';
export declare const name = "dsh-multisearch-client";
export declare const inject: string[];
/** npm package name: the key of this bundle's page on the Plugins page. */
export declare const PACKAGE = "@forever-lwy/dsh-multisearch";
/** Host row id from cordis.patch.yml, also its settings namespace. */
export declare const ENTRY = "multisearch";
export declare function apply(ctx: Context): Promise<void>;
export { MultisearchSettings };
