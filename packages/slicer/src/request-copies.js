// D150 (the owner's call on the blob byte check): a Claude Code request blob is a copy of what the recording already holds
// when every block of its message has a STRUCTURAL twin in the same recording — a twin of the same role and field shape,
// whose bytes are equal after a canonical JSON form (object keys sorted at every depth). Never a string found anywhere:
//   user        a text block (or a string content) ↔ a `user` row's message content (a string, or a text block) labelled
//               human or harness, or an attachment row's `rendered[].content` rendered in role `user` (`renderedRole`);
//               a tool result ↔ a recorded `tool_result` block; any other block ↔ a recorded block of a `user` row;
//   assistant   a tool call ↔ the recorded `tool_use` block, as recorded or with its input as sent (the same row's
//               `wireToolInputs[<id>]`); any other block (text, thinking) ↔ a recorded block of an `assistant` row;
//   system      a text block (or a string content) ↔ an attachment row's `rendered[].content` or a string field of its
//               payload, or a `system` row's `content`: the row that carries those exact bytes.
// Pure: no I/O, no clock, no model. `createHash` digests, kept in memory only.
import { createHash } from 'node:crypto';
import { LABELS } from './labels.js';

const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Canonical JSON: object keys sorted at every depth (code-unit order). */
const canonical = (value) => JSON.stringify(value, (key, item) => (plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map((k) => [k, item[k]])) : item));
const digest = (text) => createHash('sha256').update(text).digest('base64');
const blockKey = (block) => digest(`b:${canonical(block)}`);
const stringKey = (text) => digest(`s:${text}`);
/** A text block of exactly `{ type: 'text', text }`, or a string content as one: its text, else null. */
const textOf = (block) => (typeof block === 'string' ? block
  : plain(block) && block.type === 'text' && typeof block.text === 'string' && Object.keys(block).length === 2
    ? block.text : null);
const WORDS_LABELS = Object.freeze([LABELS.human, LABELS.harness]);

/**
 * The structural twins of one recording, from its rows and their final label values (`[row, value]`, every row but a
 * request blob, in recorded order), and the test of one blob's message against them.
 */
export function requestCopyIndex(rows) {
  const user = { words: new Set(), results: new Set(), blocks: new Set(), rendered: new Set() };
  const assistant = { calls: new Set(), blocks: new Set() };
  const system = new Set();
  const wordsLabel = (value) => value !== null && plain(value) && WORDS_LABELS.includes(value.label);
  for (const [d, value] of rows) {
    if (!plain(d)) continue;
    const content = plain(d.message) ? d.message.content : undefined;
    if (d.type === 'user') {
      const whole = plain(value) && !Object.hasOwn(value, 'parts') ? value : null;
      if (typeof content === 'string' && wordsLabel(whole)) user.words.add(stringKey(content));
      if (!Array.isArray(content)) continue;
      content.forEach((block, i) => {
        const part = Array.isArray(value?.parts) ? value.parts[i] ?? null : whole;
        if (plain(block) && block.type === 'tool_result') user.results.add(blockKey(block));
        else if (textOf(block) !== null && !(typeof block === 'string')) {
          if (wordsLabel(part)) user.words.add(stringKey(block.text));
        } else user.blocks.add(blockKey(block));
      });
    } else if (d.type === 'assistant') {
      if (typeof content === 'string') assistant.blocks.add(blockKey({ type: 'text', text: content }));
      if (!Array.isArray(content)) continue;
      const wire = plain(d.wireToolInputs) ? d.wireToolInputs : null;
      for (const block of content) {
        if (plain(block) && block.type === 'tool_use') {
          assistant.calls.add(blockKey(block));
          if (wire && typeof block.id === 'string' && Object.hasOwn(wire, block.id))
            assistant.calls.add(blockKey({ ...block, input: wire[block.id] }));
        } else assistant.blocks.add(blockKey(block));
      }
    } else if (d.type === 'attachment') {
      for (const item of Array.isArray(d.rendered) ? d.rendered : []) {
        if (!plain(item) || typeof item.content !== 'string') continue;
        system.add(stringKey(item.content));
        if (d.renderedRole === 'user') user.rendered.add(stringKey(item.content));
      }
      if (plain(d.attachment))
        for (const item of Object.values(d.attachment)) if (typeof item === 'string') system.add(stringKey(item));
    } else if (d.type === 'system' && typeof d.content === 'string') system.add(stringKey(d.content));
  }
  /** Whether one block of a message of `role` has its structural twin here. */
  const twin = (role, block) => {
    const text = textOf(block);
    if (role === 'user') {
      if (text !== null) return user.words.has(stringKey(text)) || user.rendered.has(stringKey(text));
      if (plain(block) && block.type === 'tool_result') return user.results.has(blockKey(block));
      return user.blocks.has(blockKey(block));
    }
    if (role === 'assistant') {
      if (plain(block) && block.type === 'tool_use') return assistant.calls.has(blockKey(block));
      return assistant.blocks.has(blockKey(typeof block === 'string' ? { type: 'text', text: block } : block));
    }
    if (role === 'system') return text !== null && system.has(stringKey(text));
    return false;
  };
  return {
    /** Whether every block of `message` (`{ role, content }`, a string content one text block) has its twin here. */
    copies(message) {
      const blocks = typeof message.content === 'string' ? [message.content] : message.content;
      return Array.isArray(blocks) && blocks.length > 0 && blocks.every((block) => twin(message.role, block));
    },
  };
}
