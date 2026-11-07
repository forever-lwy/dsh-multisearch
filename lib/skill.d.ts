/** The deep-research skill: research workflow instructions, with this deployment's budgets filled in. */
import type { Config } from './config.js';
export declare const SKILL_NAME = "deep-research";
export declare function skillContent(config: Config): string;
export declare function registerSkill(ctx: any, config: Config): void;
