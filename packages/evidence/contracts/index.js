// WP-00 owns these exports. Consumers import the frozen contract surface from here so that a
// schema or identity rule has exactly one definition across every package.

export {
  canonicalJson,
  canonicalBytes,
  canonicalSet,
  digestOf,
  encodeObject,
  decodeObject,
  identityDigest,
  isDigest,
  assertDigest,
  MAX_DEPTH,
  ContractError,
} from './canonical.js';

export { resolveTextRef, reconstructChunks } from './textref.js';
export { validate, assertValid, ValidationError } from './validate.js';
export { CONTRACT_ERROR_CODES } from './errors.js';
