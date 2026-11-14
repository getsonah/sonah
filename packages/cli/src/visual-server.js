// D221: the server address a review may be sent to, as a page's "Save online" and "Invite your team" name it, and as
// the team commands' files hold it (team-home.js: the connection's server, a hooked repository's, a run's;
// push-queue.js: a ticket's). D225 review (second look 1): it stands in a module of Node's own modules alone, so
// that the hidden
// `sonah pre-push`, which reads the connection and writes a run at every push, does not load visual-command.js and
// the code snapshot, the code pass and the repository links behind it. visual-command.js re-exports it, so every other
// reader reads it where it always did.
//
// No work at import.

const LOOPBACK = Object.freeze(['localhost', '127.0.0.1', '[::1]']);
/**
 * D221: the server address "Save online" and "Invite your team" may send a review to, as the page names it: an https
 * URL (http only for this computer: localhost, 127.0.0.1 or [::1]), with no user, password, query or fragment, as its
 * origin and path with no trailing slash; null for anything else: over plain http the review would cross the network
 * unencrypted.
 */
export function visualServer(text) {
  if (typeof text !== 'string' || text === '' || /[\s\0?#]/.test(text)) return null;
  let url;
  try { url = new URL(text); } catch { return null; }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.includes(url.hostname))) return null;
  if (url.username || url.password) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}
