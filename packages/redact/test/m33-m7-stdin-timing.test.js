// M33 brittleness M7: the stdin-secret rule (redact/index.js, rule 5, stdin) stays linear. CPU-bound like the other
// *timing* tests, on the shared clock (linear-clock.js) that scales the bound by the slowdown it measures under load.
import { test } from 'node:test';
import { redact } from '../index.js';
import { assertLinear } from './linear-clock.js';

test('M7: the rule is linear — a megabyte of pipes, here-documents (closed and not) and continued lines', () => {
  const MB = 1 << 20;
  const fill = (unit) => unit.repeat(Math.ceil(MB / unit.length)).slice(0, MB);
  const inputs = {
    'pipes into sudo -S': fill('echo a | sudo -S b\n'),
    'here-documents never closed': fill('sudo -S x <<E\n'),
    'here-documents closed far below': `${fill('sudo -S x <<Z\n')}\nZ`,
    'a pipe upstream of each, closed': fill('cat <<E | grep -s x\nE\n'),
    'continued lines': fill('echo a \\\n'),
    'escaped line breaks': fill('\\necho x | passwd '),
    'groups never closed': fill('(echo a; '),
  };
  for (const [name, text] of Object.entries(inputs)) {
    for (const [field, scrub] of Object.entries({
      cmd: () => redact({ ask: [], ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: text }] }),
      ask: () => redact({ ask: [{ turn: 1, text }], ledger: [] }),
      body: () => redact({ ask: [], ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'a.sh', after: { text, truncated: false, lines: 1 } }] }),
    })) {
      assertLinear(scrub, 1500, `${name} / ${field}`);
    }
  }
});
