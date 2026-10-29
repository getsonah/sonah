// D171 fix round: a preload for the entry runs of d171-update-check.test.js (`node --import <this> bin/sonah.js …`).
// It replaces node:dns `lookup`, the host lookup of the update check's request, so that no entry run reaches npm's
// registry, even when the check's switches or its cache are broken (a mutant). Each lookup's host name is appended to
// the file D171_LOOKUP_LOG names, and D171_LOOKUP says how it answers: `fail` (the default) at once with ENOTFOUND, as
// with no network; `hang` never, holding the process for 30 seconds, as a system resolver that does not answer does.
// An IP address (a local server's `listen('127.0.0.1')`) needs no resolver: it is answered as itself and not logged.
import dns from 'node:dns';
import { appendFileSync } from 'node:fs';
import { isIP } from 'node:net';

dns.lookup = (hostname, options, callback) => {
  const done = typeof options === 'function' ? options : callback;
  const family = isIP(hostname);
  if (family) {
    process.nextTick(() => (options?.all ? done(null, [{ address: hostname, family }]) : done(null, hostname, family)));
    return;
  }
  if (process.env.D171_LOOKUP_LOG) appendFileSync(process.env.D171_LOOKUP_LOG, `${hostname}\n`);
  if (process.env.D171_LOOKUP === 'hang') { setTimeout(() => {}, 30_000); return; }
  process.nextTick(() => done(Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' })));
};
