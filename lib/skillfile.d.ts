import type { Config } from './config.js';
export type SkillFileState = 'synced' | 'modified' | 'deleted' | 'foreign' | 'builtin';
export interface SkillFileStatus {
    mode: 'file' | 'builtin';
    path: string;
    state: SkillFileState;
    /** Current file text, when the file exists. */
    content?: string;
    /** What the plugin would write for the current settings. */
    generated: string;
    error?: string;
}
export declare function resolveDshHome(env?: NodeJS.ProcessEnv): string;
/** Full SKILL.md text for the current settings. */
export declare function generatedSkillFile(config: Config): string;
/** Light check of what the host loader needs: a frontmatter block with a kebab-case name and a description. */
export declare function validateSkillFile(text: string): string | undefined;
export declare class SkillFile {
    readonly path: string;
    private readonly memoryPath;
    private queue;
    constructor(home?: string);
    /** Serialize writes: settings updates and page actions can arrive together. */
    private run;
    private read;
    private memory;
    private remember;
    private write;
    private classify;
    status(config: Config, mode: 'file' | 'builtin'): Promise<SkillFileStatus>;
    /**
     * File mode: create it once, then follow settings while unmodified.
     * Builtin mode: take back a file the plugin wrote and nobody changed, so the two do not clash.
     */
    sync(config: Config, mode: 'file' | 'builtin'): Promise<SkillFileState>;
    /** Save text from the settings page; text equal to the generated one keeps following settings. */
    save(config: Config, text: string): Promise<SkillFileState>;
    /** Write the generated text again and resume following settings. */
    restore(config: Config): Promise<SkillFileState>;
}
