// C-02 strict JSON. JSON.parse silently keeps the last of two repeated object keys, so a
// payload that repeats one can turn a conflicting status, index, exit code or identity into an
// apparently typed receipt. A faithful serializer never repeats a key; such text is not typed.

/** True unless `raw` is one JSON value with no repeated object key at any depth. */
export function duplicateJsonKeys(raw) {
  if (typeof raw !== 'string') return true;
  const n = raw.length;
  let at = 0;
  // JSON whitespace only (RFC 8259); anything else between tokens is not strict JSON.
  const space = () => { let c = raw.charCodeAt(at); while (c === 32 || c === 10 || c === 13 || c === 9) c = raw.charCodeAt(++at); };
  // Skips one string from its opening quote; returns its start. Only keys are decoded.
  const skipString = () => {
    const start = at++;
    while (at < n) {
      const c = raw.charCodeAt(at);
      if (c === 92) { at += 2; continue; }
      at++;
      if (c === 34) return start;
    }
    throw Error('json string');
  };
  const key = () => {
    const start = skipString();
    const text = raw.slice(start, at);
    return text.includes('\\') ? JSON.parse(text) : text.slice(1, -1);
  };
  const value = (depth) => {
    if (depth > 128) throw Error('json depth');
    space();
    const c = raw.charCodeAt(at);
    if (c === 34) { skipString(); return false; }
    if (c === 91) {
      at++; space();
      while (raw.charCodeAt(at) !== 93) {
        if (value(depth + 1)) return true;
        space(); if (raw.charCodeAt(at) === 44) { at++; continue; }
        if (raw.charCodeAt(at) !== 93) throw Error('json array');
      }
      at++; return false;
    }
    if (c === 123) {
      at++; space(); const keys = new Set();
      while (raw.charCodeAt(at) !== 125) {
        if (raw.charCodeAt(at) !== 34) throw Error('json key');
        const name = key();
        if (keys.has(name)) return true;
        keys.add(name); space();
        if (raw.charCodeAt(at++) !== 58) throw Error('json colon');
        if (value(depth + 1)) return true;
        space(); if (raw.charCodeAt(at) === 44) { at++; space(); continue; }
        if (raw.charCodeAt(at) !== 125) throw Error('json object');
      }
      at++; return false;
    }
    const begin = at;
    for (let d = raw.charCodeAt(at); at < n && d !== 32 && d !== 10 && d !== 13 && d !== 9
      && d !== 44 && d !== 93 && d !== 125; d = raw.charCodeAt(++at));
    if (begin === at) throw Error('json value');
    return false;
  };
  try { const duplicated = value(0); space(); return duplicated || at !== n; }
  catch { return true; }
}

/**
 * Decode `raw` for a typed use. `json` says whether JSON.parse accepted it; `strict` says it
 * also repeats no key. Only a strict value may supply status, index, ownership or identity.
 */
export function strictJson(raw) {
  if (typeof raw !== 'string') return { json: false, strict: false, value: raw };
  let value;
  try { value = JSON.parse(raw); } catch { return { json: false, strict: false, value: raw }; }
  return duplicateJsonKeys(raw) ? { json: true, strict: false, value: raw } : { json: true, strict: true, value };
}
