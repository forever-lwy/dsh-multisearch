/** Read part of a long page: keyword windows that keep the context a fact depends on, or a block-aligned range. */
/** Split markdown into blocks; code fences and tables stay whole so headers and premises are never cut off. */
export function splitBlocks(markdown) {
    const blocks = [];
    const lines = markdown.split('\n');
    let offset = 0;
    let i = 0;
    const push = (start, end, kind) => {
        const text = markdown.slice(start, end);
        if (text.trim())
            blocks.push({ start, end, kind, text });
    };
    while (i < lines.length) {
        const line = lines[i];
        const lineStart = offset;
        if (/^\s*(```|~~~)/.test(line)) {
            const fence = line.trim().slice(0, 3);
            let j = i + 1;
            let end = offset + line.length + 1;
            while (j < lines.length) {
                end += lines[j].length + 1;
                if (lines[j].trim().startsWith(fence)) {
                    j++;
                    break;
                }
                j++;
            }
            push(lineStart, Math.min(end, markdown.length), 'code');
            offset = end;
            i = j;
            continue;
        }
        if (/^\s*\|/.test(line)) {
            let j = i;
            let end = offset;
            while (j < lines.length && /^\s*\|/.test(lines[j])) {
                end += lines[j].length + 1;
                j++;
            }
            push(lineStart, Math.min(end, markdown.length), 'table');
            offset = end;
            i = j;
            continue;
        }
        if (/^#{1,6}\s/.test(line)) {
            push(lineStart, offset + line.length, 'heading');
            offset += line.length + 1;
            i++;
            continue;
        }
        if (line.trim() === '') {
            offset += line.length + 1;
            i++;
            continue;
        }
        let j = i;
        let end = offset;
        while (j < lines.length && lines[j].trim() !== '' && !/^\s*(```|~~~|\|)/.test(lines[j]) && !/^#{1,6}\s/.test(lines[j])) {
            end += lines[j].length + 1;
            j++;
        }
        push(lineStart, Math.min(end, markdown.length), 'text');
        offset = end;
        i = j;
    }
    return blocks;
}
const CONDITION = /^(but|however|unless|except|note|warning|caution|only if|if |when |provided|注意|但是|然而|除非|仅当|如果|前提|警告)/i;
export function keywordExcerpt(markdown, keywords, contextChars, maxChars) {
    const blocks = splitBlocks(markdown);
    const needles = keywords.map(k => k.trim().toLowerCase()).filter(Boolean);
    const selected = new Set();
    let matches = 0;
    blocks.forEach((block, index) => {
        const lower = block.text.toLowerCase();
        if (!needles.some(needle => lower.includes(needle)))
            return;
        matches++;
        selected.add(index);
        // Nearest heading above gives the section the fact belongs to.
        for (let h = index - 1; h >= 0; h--)
            if (blocks[h].kind === 'heading') {
                selected.add(h);
                break;
            }
        // Introductory sentence, condition or table/code premise right before.
        const prev = blocks[index - 1];
        if (prev && prev.kind !== 'heading' && (prev.text.trimEnd().endsWith(':') || prev.text.length < 300 || CONDITION.test(block.text.trim())))
            selected.add(index - 1);
        // Caveat or continuation right after.
        const next = blocks[index + 1];
        if (next && (block.text.trimEnd().endsWith(':') || CONDITION.test(next.text.trim()) || next.kind === 'code'))
            selected.add(index + 1);
        // Widen to the requested context size.
        let size = block.text.length;
        for (let step = 1; size < contextChars && step < 6; step++) {
            for (const n of [index - step, index + step]) {
                const neighbor = blocks[n];
                if (neighbor && size < contextChars) {
                    selected.add(n);
                    size += neighbor.text.length;
                }
            }
        }
    });
    if (matches === 0)
        return { text: '', matches: 0, ranges: [], truncated: false };
    const ordered = [...selected].sort((a, b) => a - b);
    const ranges = [];
    for (const index of ordered) {
        const block = blocks[index];
        const last = ranges[ranges.length - 1];
        if (last && index > 0 && ordered.includes(index - 1))
            last[1] = block.end;
        else
            ranges.push([block.start, block.end]);
    }
    let text = '';
    let truncated = false;
    const kept = [];
    for (const [start, end] of ranges) {
        const piece = `${start > 0 ? `[… offset ${start}]\n` : ''}${markdown.slice(start, end).trim()}\n`;
        if (text.length + piece.length > maxChars) {
            const room = maxChars - text.length;
            if (room > 400) {
                text += `${piece.slice(0, room)}…\n`;
                kept.push([start, start + room]);
            }
            truncated = true;
            break;
        }
        text += `${piece}\n`;
        kept.push([start, end]);
    }
    return { text: text.trim(), matches, ranges: kept, truncated };
}
/** A range starting at `offset`, extended to the end of the block it would cut (up to 15% extra). */
export function rangeExcerpt(markdown, offset, maxChars) {
    const start = Math.max(0, Math.min(offset, markdown.length));
    let end = Math.min(markdown.length, start + maxChars);
    if (end < markdown.length) {
        const slack = Math.floor(maxChars * 0.15);
        const window = markdown.slice(end, end + slack);
        const fence = markdown.slice(start, end).split(/^\s*```/m).length % 2 === 0;
        const boundary = fence ? window.search(/\n\s*```\s*\n/) : window.search(/\n\s*\n/);
        if (boundary >= 0)
            end += boundary + 1;
        else {
            const back = markdown.lastIndexOf('\n\n', end);
            if (back > start + maxChars * 0.7)
                end = back;
        }
    }
    return { text: markdown.slice(start, end), start, end, nextOffset: end < markdown.length ? end : undefined };
}
