// Closed safe diagnostics: provider bodies and transport exceptions may contain credentials.
export const GITHUB_ERROR_CODES = Object.freeze([
  'invalid_input', 'github_unavailable', 'github_response_invalid', 'stale_revision',
  'unreviewed_scope', 'publication_disabled', 'quality_gate_unmet', 'disclosure_rejected',
  'operation_busy', 'operation_conflict', 'operation_uncertain', 'operation_store_failed',
]);
export class GitHubError extends Error {
  constructor(code) {
    super(GITHUB_ERROR_CODES.includes(code) ? code : 'github_unavailable');
    this.name = 'GitHubError'; this.code = this.message;
  }
}
export const fail = (code) => { throw new GitHubError(code); };
