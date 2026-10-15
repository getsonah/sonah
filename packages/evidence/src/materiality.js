// C-06 materiality adapter. It applies the frozen rules below and returns the matched rule ID with the rank. The
// regexes live here once and are never re-typed: two copies of a precedence rule is how a "deterministic" rank starts
// drifting.

// The frozen path rules of the materiality rank: a closed, deterministic rank, never a model output or a verdict.
export const MATERIALITY_RULES = Object.freeze(Object.fromEntries(Object.entries({
  dependencies: /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|requirements(?:[-.][\w-]+)?\.txt|pyproject\.toml|poetry\.lock|uv\.lock|Pipfile(?:\.lock)?|Cargo\.(?:toml|lock)|go\.(?:mod|sum)|Gemfile(?:\.lock)?|composer\.(?:json|lock)|pom\.xml|build\.gradle(?:\.kts)?|gradle\.lockfile|packages\.lock\.json|[^/]+\.(?:csproj|fsproj))$/i,
  schema: /(^|\/)(schemas?|migrations?)(\/|[._-]|$)|\.(schema|migration)\.[^/]+$|\.prisma$|(^|\/)(openapi|swagger)\.(json|ya?ml)$/i,
  api: /(^|\/)(routes?|api|handlers?|public-api|public_api)(\/|[._-]|$)|(^|\/)\+server\.(js|ts)$/i,
  config: /(^|\/)(\.github\/workflows|\.circleci|config|configs|configuration)(\/|$)|(^|\/)(\.gitlab-ci\.ya?ml|Jenkinsfile|azure-pipelines\.ya?ml|Dockerfile(?:\.[\w-]+)?|(?:docker-)?compose\.ya?ml|[^/]+\.config\.[\w]+|(?:config|settings)\.(json|ya?ml|toml|ini|js|ts|cjs|mjs)|tsconfig(?:\.[\w-]+)?\.json|\.eslintrc(?:\.[\w]+)?|\.prettierrc(?:\.[\w]+)?)$/i,
  auth: /(^|\/)(auth|authentication|authorization|oauth|secrets?|credentials?|permissions?)(\/|[._-]|$)|(^|\/)\.env(?:\.[^/]+)?$|\.(pem|key|p12|pfx)$/i,
  module: /\.(js|mjs|cjs|jsx|ts|tsx|py|go|rs|rb|java|kt|swift|c|h|cpp|cc|cs|php|vue|svelte|sh|sql)$/i,
  style: /\.(css|scss|sass|less|styl)$/i,
  copy: /(^|\/)(docs?|copy|locales?|i18n|translations?)(\/|$)|\.(md|mdx|rst|txt)$/i,
}).map(([name, rule]) => [name, Object.freeze(rule)])));

export const MATERIALITY_RULE_IDS = Object.freeze([
  'deletion', 'dependencies', 'schema', 'api', 'config', 'auth',
  'new-module', 'style-or-copy', 'unknown-structural',
]);

// C-06 fixes this order across ALL paths, so a decision touching both a route and a lockfile
// reports `dependencies`. Precedence must not depend on which path was listed first.
const PATH_RULES = Object.freeze(['dependencies', 'schema', 'api', 'config', 'auth']);

/**
 * Returns { materiality, rule } from validated decision actions.
 * `actions` are the decision's grounded invocations only: reads and explored alternatives
 * cannot make a decision touch a material file (MT-07).
 */
export function materialityOf(decision, actions) {
  const r = MATERIALITY_RULES;
  const norm = (p) => String(p ?? '').replace(/\\/g, '/');
  const paths = actions.flatMap((a) => (a.paths ?? []).map((p) => norm(p.path))).filter(Boolean);

  if (actions.some((a) => a.operation === 'delete')) return { materiality: 'material', rule: 'deletion' };

  for (const id of PATH_RULES) {
    if (paths.some((p) => r[id].test(p))) return { materiality: 'material', rule: id };
  }

  if (actions.some((a) => a.operation === 'write' && (a.paths ?? []).some((p) => r.module.test(norm(p.path)))))
    return { materiality: 'structural', rule: 'new-module' };

  // M33 brittleness M8: no rule reads the decision's dimension text (the `placement` and `naming` phrase rules decided
  // nothing); what no path or action rule classifies is structural.

  const withPaths = actions.filter((a) => (a.paths ?? []).length);
  if (paths.length && withPaths.length === actions.length && paths.every((p) => r.style.test(p) || r.copy.test(p)))
    return { materiality: 'cosmetic', rule: 'style-or-copy' };

  return { materiality: 'structural', rule: 'unknown-structural' };
}
