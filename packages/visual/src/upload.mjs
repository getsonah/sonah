// upload.mjs: the one shape of a review sent to Sonah's server (the hosted server's upload contract). The laptop client
// posts it to /api/uploads, and the free local page carries it for "Save online" and "Invite your team" (POST /share),
// so both are built here and the shapes never drift. Pure: no file, clock, random or network.

/** The server's cap on an upload, in bytes (POST /api/uploads and POST /share's upload field). */
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/**
 * The body of POST /api/uploads, in this key order: { repo: { owner, name }, branch, base, head, page, facts, meaning,
 * findings, run }. page is the review drawn in mode 'hosted'; facts, meaning, findings and run are the job's own files
 * (facts.json, meaning.json, findings.json, run.json) as parsed; base and head are the facts' range. branch is null
 * when it is not known.
 */
export function uploadBody({ owner, name, branch = null, page, facts, meaning, findings, run }) {
  return { repo: { owner, name }, branch: typeof branch === 'string' && branch ? branch : null,
    base: facts?.range?.base, head: facts?.range?.head, page, facts, meaning, findings, run };
}

const LS = new RegExp('[\\u2028\\u2029]', 'g');
/**
 * JSON text that is safe inside a script element: every "<" (so no "</script" or "<!--" can end or bend it) and the
 * two line separators written as \u escapes. It parses to the same value.
 */
export const scriptJson = (x) => JSON.stringify(x).replace(/</g, '\\u003c').replace(LS, (c) => (c.charCodeAt(0) === 0x2028 ? '\\u2028' : '\\u2029'));

/** The upload as the local page carries and sends it (scriptJson), or null when that text is over UPLOAD_MAX_BYTES. */
export function uploadText(body) {
  const text = scriptJson(body);
  return Buffer.byteLength(text, 'utf8') <= UPLOAD_MAX_BYTES ? text : null;
}
