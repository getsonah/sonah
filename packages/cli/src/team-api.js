// D224 (item 10, C2): the calls the team commands make to a Sonah Team server (sonah-hosted HOSTING.md section 2, "A
// laptop's token", and its device code), with Node's fetch. Ported from the private laptop client's api.mjs, with the
// calls C2 needs: the device code's exchange, and the token's own route (whose it is; revoking it).
//   POST   /api/device/exchange  { code, name }  -> 201 { token, login, server }  (no token sent; `server` is not read)
//   GET    /api/token            bearer          -> 200 { login, team: { name } | null, seat: 'paid' | 'free' | null }
//   DELETE /api/token            bearer          -> 204: the calling token is revoked
// D227 (item 10, C4) adds the push run's two (sonah-hosted FIXLOOP.md "Shapes", UPLOADS.md):
//   GET    /api/fixes?owner&repo  bearer          -> 200 { repo, total, fixes }: the comments that wait for the token's
//                                                   person in that repository (401 bad_token, 403 not_member, 429)
//   POST   /api/uploads           bearer, a review -> 201 { url, version, prs, dropped }
// D229 (item 10, C6) adds the fix loop's two, which `sonah fix` calls (sonah-hosted FIXLOOP.md "Shapes"):
//   GET    /api/fixes/<comment id>           bearer -> 200 what one fix needs (404 not_found, 409 not_fixable)
//   POST   /api/fixes/<comment id>/launched  bearer -> 200: Claude Code started on it, with the session it went to.
//                                                   Sonah sends it best effort, and the fix goes on without it.
// The token goes only to the server it belongs to, only in the Authorization header, never in a URL; a redirect is
// never followed, so the token cannot be carried anywhere else. An error holds no word of the server's answer but its
// error code, and only when the code is one (lower-case letters and `_`, at most 40): never the token, never a body.
//
// No work at import.
import { isCommentId, isLogin, isSessionId } from '../../visual/src/fix-prompt.mjs';
import { TEAM_API_ERRORS, TEAM_SEATS } from '../../evidence/src/ledger.js';
import { isToken } from './team-home.js';

/** The User-Agent of every call (the server does not read it). */
export const TEAM_USER_AGENT = 'getsonah';
/** How long each call waits for the server's answer, in ms. */
export const TEAM_API_TIMEOUT_MS = Object.freeze({ exchange: 30_000, token: 15_000, fixes: 15_000, upload: 120_000,
  launched: 5000 });
/** The longest answer body Sonah reads; a longer one is not of any route's shape. D227: GET /api/fixes lists up to 100
 *  comments, each with a title of up to 1,000 characters, so its answer may be longer. D229: GET /api/fixes/<comment
 *  id> answers one fix whole, and the item of it may name up to 1,000 functions, whose keys are up to 1,024 characters
 *  and whose paths are up to 4,096 (fix-prompt.mjs, and the server's own FNS_MAX), with the words of up to 21 comments
 *  besides, so an answer `checkFix` reads whole runs past five megabytes. The body is read either way (`call` takes its
 *  text before the cap); what the cap says is whether Sonah reads it as JSON, so a cap under the route's own answer
 *  would refuse a fix the person has no other way to take up. */
const MAX_ANSWER_CHARS = 64 * 1024;
const MAX_FIXES_CHARS = 1024 * 1024;
const MAX_FIX_CHARS = 8 * 1024 * 1024;
/** A team's name as the server can hold one (a team named by its email domain can be one of 253 characters). */
const MAX_TEAM_NAME = 253;
const CODE = /^[a-z_]{1,40}$/;

/** A call that went wrong: its `kind` (ledger.js TEAM_API_ERRORS), and for `redirect` and `refused` the answer's
 *  `status`, with the server's error `code` when it is one. */
export class TeamApiError extends Error {
  constructor(kind, { status = null, code = null } = {}) {
    if (!TEAM_API_ERRORS.includes(kind)) throw new Error('not a kind of TEAM_API_ERRORS');
    super(`team server: ${kind}${status === null ? '' : ` ${status}`}${code === null ? '' : ` ${code}`}`);
    this.name = 'TeamApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
  }
}

const KIND_PROBLEMS = Object.freeze({ unreachable: 'team_unreachable', redirect: 'team_redirect',
  answer: 'team_answer' });
/** The problem a call's error names (ledger.js TEAM_PROBLEMS): the refusals a command says in its own words, else the
 *  error's kind. Anything that is not a TeamApiError is not a problem of the server's: null. */
export function teamProblemOf(error) {
  if (!(error instanceof TeamApiError)) return null;
  if (error.kind !== 'refused') return KIND_PROBLEMS[error.kind];
  if (error.status === 401) return 'team_bad_token';
  if (error.status === 429) return 'team_rate_limited';
  if (error.status === 400 && error.code === 'bad_code') return 'team_bad_code';
  if (error.status === 409 && error.code === 'too_many_tokens') return 'team_too_many_tokens';
  return 'team_refused';
}

const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const teamName = (x) => typeof x === 'string' && x.length >= 1 && x.length <= MAX_TEAM_NAME;

/** The client of one server (`visualServer`'s form); `token` is sent on every call but the exchange. */
export function teamApi({ server, token = null, fetch = globalThis.fetch }) {
  async function call(method, path, { body, auth = true, timeoutMs, query = null, maxChars = MAX_ANSWER_CHARS }) {
    const headers = { accept: 'application/json', 'user-agent': TEAM_USER_AGENT };
    if (auth) {
      if (!isToken(token)) throw new Error('no token');
      headers.authorization = `Bearer ${token}`;
    }
    let payload;
    if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    let response;
    try {
      const url = new URL(path, `${server}/`);
      for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
      response = await fetch(url, { method, headers, body: payload, redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new TeamApiError('unreachable');
    }
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel().catch(() => {});
      throw new TeamApiError('redirect', { status: response.status });
    }
    let text;
    try { text = await response.text(); } catch { throw new TeamApiError('unreachable'); }
    let json = null;
    if (text.length <= maxChars) try { json = JSON.parse(text); } catch { /* not JSON */ }
    if (!response.ok) {
      const code = plainObject(json) && typeof json.error === 'string' && CODE.test(json.error) ? json.error : null;
      throw new TeamApiError('refused', { status: response.status, code });
    }
    return { status: response.status, json };
  }
  return {
    /** POST /api/device/exchange: `{ token, login }` (the login null when it is not one); the answer's `server` is not
     *  read, so the token is kept for the server Sonah sent the code to. */
    async exchange(code, name) {
      const { json } = await call('POST', 'api/device/exchange', { body: { code, name }, auth: false,
        timeoutMs: TEAM_API_TIMEOUT_MS.exchange });
      if (!plainObject(json) || !isToken(json.token)) throw new TeamApiError('answer');
      return { token: json.token, login: isLogin(json.login) ? json.login : null };
    },
    /** GET /api/token: whose the token is, `{ login, team: <its name> | null, seat: 'paid' | 'free' | null }`. */
    async whoami() {
      const { json } = await call('GET', 'api/token', { timeoutMs: TEAM_API_TIMEOUT_MS.token });
      if (!plainObject(json) || !isLogin(json.login)) throw new TeamApiError('answer');
      const team = json.team === null ? null : plainObject(json.team) && teamName(json.team.name) ? json.team.name
        : undefined;
      const seat = json.seat === null || TEAM_SEATS.includes(json.seat) ? json.seat : undefined;
      if (team === undefined || seat === undefined || (team === null) !== (seat === null))
        throw new TeamApiError('answer');
      return { login: json.login, team, seat };
    },
    /** DELETE /api/token: the token is revoked (204). */
    async revoke() {
      const { status } = await call('DELETE', 'api/token', { timeoutMs: TEAM_API_TIMEOUT_MS.token });
      if (status !== 204 && status !== 200) throw new TeamApiError('answer');
    },
    /** D227: GET /api/fixes?owner&repo: the answer's JSON as it came (fix-waiting.js `checkList` checks its shape). */
    async fixes({ owner, name }, { timeoutMs = TEAM_API_TIMEOUT_MS.fixes } = {}) {
      return (await call('GET', 'api/fixes', { query: { owner, repo: name }, timeoutMs, maxChars: MAX_FIXES_CHARS }))
        .json;
    },
    /** D229: GET /api/fixes/<comment id>: the answer's JSON as it came (fix-command.js `checkFix` checks its shape).
     *  The id is one of a comment's shape, so no call of this can name another route. */
    async one(id, { timeoutMs = TEAM_API_TIMEOUT_MS.fixes } = {}) {
      if (!isCommentId(id)) throw new Error('not a comment id');
      return (await call('GET', `api/fixes/${id}`, { timeoutMs, maxChars: MAX_FIX_CHARS })).json;
    },
    /** D229: POST /api/fixes/<comment id>/launched with `{ session, forkOf }`: the server is told that Claude Code
     *  started on this comment. Its answer is not read; the call is made best effort. */
    async launched(id, { session, forkOf }, { timeoutMs = TEAM_API_TIMEOUT_MS.launched } = {}) {
      if (!isCommentId(id)) throw new Error('not a comment id');
      if (!isSessionId(session) || (forkOf !== null && !isSessionId(forkOf))) throw new Error('not a session id');
      await call('POST', `api/fixes/${id}/launched`, { body: { session, forkOf }, timeoutMs });
    },
    /** D227: POST /api/uploads with a review (upload.mjs `uploadBody`, and its `sessions`): `{ url }`, the review's
     *  page on the server when the answer names one by http or https, else null. Any 2xx is taken: the server keeps
     *  the upload. */
    async upload(body, { timeoutMs = TEAM_API_TIMEOUT_MS.upload } = {}) {
      const { json } = await call('POST', 'api/uploads', { body, timeoutMs });
      const url = plainObject(json) && typeof json.url === 'string' && json.url.length <= 2048
        && /^https?:\/\/\S+$/.test(json.url) ? json.url : null;
      return { url };
    },
  };
}
