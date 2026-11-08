/**
 * The deep-research skill as a real SKILL.md under $DSH_HOME/skills, so the host's filesystem
 * skill loader serves it and skill managers can list, disable or trash it like any local skill.
 *
 * The plugin keeps the file in step with its settings only while the file is exactly what the
 * plugin last wrote. Once someone edits it, the plugin leaves it alone; once someone deletes it,
 * the plugin does not bring it back until asked ("restore").
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { SKILL_NAME, skillContent, skillDescription, skillWhenToUse } from './skill.js';
const sha = (text) => createHash('sha256').update(text).digest('hex');
const quote = (text) => JSON.stringify(text); // a JSON string is a valid YAML scalar
export function resolveDshHome(env = process.env) {
    const configured = env.DSH_HOME?.trim();
    return configured ? configured : join(homedir(), '.dsh');
}
/** Full SKILL.md text for the current settings. */
export function generatedSkillFile(config) {
    return [
        '---',
        `name: ${SKILL_NAME}`,
        `description: ${quote(skillDescription(config))}`,
        `whenToUse: ${quote(skillWhenToUse)}`,
        `disable-model-invocation: ${config.research.modelInvocable ? 'false' : 'true'}`,
        'user-invocable: true',
        '---',
        '',
        skillContent(config).trim(),
        '',
    ].join('\n');
}
/** Light check of what the host loader needs: a frontmatter block with a kebab-case name and a description. */
export function validateSkillFile(text) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text);
    if (!match)
        return '文件必须以 --- 包围的 frontmatter 开头';
    const head = match[1];
    const name = /^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(head)?.[1];
    if (!name)
        return 'frontmatter 缺少 name';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
        return `name "${name}" 必须是小写字母、数字和连字符`;
    if (!/^description:\s*\S/m.test(head))
        return 'frontmatter 缺少 description';
    for (const legacy of ['modelInvocable', 'userInvocable', 'disableModelInvocation']) {
        if (new RegExp(`^${legacy}:`, 'm').test(head))
            return `不支持 ${legacy}，请用 disable-model-invocation / user-invocable`;
    }
    if (!match[2].trim())
        return '技能正文不能为空';
    if (text.length > 200_000)
        return '技能文件过长';
    return undefined;
}
export class SkillFile {
    path;
    memoryPath;
    queue = Promise.resolve();
    constructor(home = resolveDshHome()) {
        this.path = join(home, 'skills', SKILL_NAME, 'SKILL.md');
        this.memoryPath = join(home, 'storages', 'dsh-multisearch', 'skill-file.json');
    }
    /** Serialize writes: settings updates and page actions can arrive together. */
    run(task) {
        const next = this.queue.then(task, task);
        this.queue = next.catch(() => undefined);
        return next;
    }
    async read() {
        try {
            return await readFile(this.path, 'utf8');
        }
        catch (error) {
            if (error?.code === 'ENOENT')
                return undefined;
            throw error;
        }
    }
    async memory() {
        try {
            return JSON.parse(await readFile(this.memoryPath, 'utf8'));
        }
        catch {
            return { seeded: false };
        }
    }
    async remember(memory) {
        await mkdir(dirname(this.memoryPath), { recursive: true });
        await writeFile(this.memoryPath, JSON.stringify(memory, null, 2));
    }
    async write(text) {
        await mkdir(dirname(this.path), { recursive: true });
        const temp = `${this.path}.${process.pid}.tmp`;
        await writeFile(temp, text);
        await rename(temp, this.path);
    }
    classify(text, memory) {
        if (text === undefined)
            return 'deleted';
        if (memory.hash === sha(text))
            return 'synced';
        return memory.seeded ? 'modified' : 'foreign';
    }
    async status(config, mode) {
        const generated = generatedSkillFile(config);
        try {
            const [text, memory] = await Promise.all([this.read(), this.memory()]);
            if (mode === 'builtin')
                return { mode, path: this.path, state: 'builtin', generated, ...(text !== undefined ? { content: text } : {}) };
            return { mode, path: this.path, state: this.classify(text, memory), generated, ...(text !== undefined ? { content: text } : {}) };
        }
        catch (error) {
            return { mode, path: this.path, state: 'deleted', generated, error: error instanceof Error ? error.message : String(error) };
        }
    }
    /**
     * File mode: create it once, then follow settings while unmodified.
     * Builtin mode: take back a file the plugin wrote and nobody changed, so the two do not clash.
     */
    sync(config, mode) {
        return this.run(async () => {
            const [text, memory] = await Promise.all([this.read(), this.memory()]);
            if (mode === 'builtin') {
                if (text !== undefined && memory.seeded && memory.hash === sha(text)) {
                    await rm(this.path, { force: true });
                    await rmdir(dirname(this.path)).catch(() => { });
                }
                if (memory.seeded)
                    await this.remember({ seeded: false });
                return 'builtin';
            }
            const generated = generatedSkillFile(config);
            if (text === undefined) {
                if (memory.seeded)
                    return 'deleted';
                await this.write(generated);
                await this.remember({ seeded: true, hash: sha(generated) });
                return 'synced';
            }
            const state = this.classify(text, memory);
            if (state === 'synced' && text !== generated) {
                await this.write(generated);
                await this.remember({ seeded: true, hash: sha(generated) });
            }
            return state;
        });
    }
    /** Save text from the settings page; text equal to the generated one keeps following settings. */
    save(config, text) {
        return this.run(async () => {
            const problem = validateSkillFile(text);
            if (problem)
                throw new Error(problem);
            const memory = await this.memory();
            await this.write(text);
            const generated = generatedSkillFile(config);
            const hash = text === generated ? sha(generated) : memory.hash;
            await this.remember({ seeded: true, ...(hash ? { hash } : {}) });
            return text === generated ? 'synced' : 'modified';
        });
    }
    /** Write the generated text again and resume following settings. */
    restore(config) {
        return this.run(async () => {
            const generated = generatedSkillFile(config);
            await this.write(generated);
            await this.remember({ seeded: true, hash: sha(generated) });
            return 'synced';
        });
    }
}
