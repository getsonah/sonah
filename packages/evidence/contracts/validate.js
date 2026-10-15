// A small, strict, zero-dependency validator for the frozen contract schemas.
//
// This is deliberately NOT a general JSON Schema engine. It supports exactly the keyword subset
// the C-01..C-10 schemas use, and it is strict by default in the ways C-01 demands:
//   - `additionalProperties` defaults to FALSE (C-01: "unknown properties fail validation")
//   - no implicit coercion: "1" is never 1, 0 is never false
//   - `integer` means finite safe integer, never a float (C-01: "no floats")
//   - a nullable field is `type: [..., "null"]` and must be present as explicit null
//   - an optional field is ABSENT; a present `undefined` is a violation
//
// Errors are structural: a JSON-pointer path plus a frozen keyword. Paths name schema fields,
// never source text, so a validation error is safe to log (PR-04).

const SAFE = Number.isSafeInteger;

export class ValidationError extends Error {
  constructor(errors) {
    super(`schema validation failed (${errors.length})`);
    this.name = 'ValidationError';
    this.errors = Object.freeze(errors.map((e) => Object.freeze({ ...e })));
  }
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'number') return SAFE(value) ? 'integer' : 'number';
  return t; // string | boolean | object | undefined | function | symbol | bigint
}

function matchesType(value, expected) {
  if (expected === 'integer') return typeof value === 'number' && SAFE(value) && !Object.is(value, -0);
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'null') return value === null;
  return typeOf(value) === expected;
}

function resolveRef(ref, root) {
  if (!ref.startsWith('#/')) return null;
  let node = root;
  for (const rawPart of ref.slice(2).split('/')) {
    const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node == null || typeof node !== 'object') return null;
    node = node[part];
  }
  return node ?? null;
}

function check(value, schema, root, path, errors) {
  if (schema == null || typeof schema !== 'object') return;

  if (schema.$ref) {
    const target = resolveRef(schema.$ref, root);
    if (!target) { errors.push({ path, keyword: '$ref', detail: schema.$ref }); return; }
    check(value, target, root, path, errors);
    return;
  }

  if (schema.oneOf) {
    const matches = schema.oneOf.filter((sub) => {
      const probe = [];
      check(value, sub, root, path, probe);
      return probe.length === 0;
    });
    if (matches.length !== 1) errors.push({ path, keyword: 'oneOf', detail: `matched ${matches.length}` });
    return;
  }

  if (schema.const !== undefined) {
    // Strict identity; no coercion. Objects are not compared structurally (unused by these schemas).
    if (value !== schema.const) errors.push({ path, keyword: 'const', detail: String(schema.const) });
    return;
  }

  if (schema.enum) {
    if (!schema.enum.some((m) => m === value)) errors.push({ path, keyword: 'enum' });
    return;
  }

  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.some((t) => matchesType(value, t))) {
      errors.push({ path, keyword: 'type', detail: allowed.join('|'), actual: typeOf(value) });
      return; // further keywords would be meaningless against the wrong type
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && [...value].length < schema.minLength)
      errors.push({ path, keyword: 'minLength' });
    // C-01: "Character limits elsewhere count Unicode scalar values" — count code points, not UTF-16 units.
    if (schema.maxLength !== undefined && [...value].length > schema.maxLength)
      errors.push({ path, keyword: 'maxLength' });
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value))
      errors.push({ path, keyword: 'pattern' });
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path, keyword: 'minimum' });
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path, keyword: 'maximum' });
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push({ path, keyword: 'minItems' });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push({ path, keyword: 'maxItems' });
    if (schema.items) value.forEach((item, i) => check(item, schema.items, root, `${path}/${i}`, errors));
    if (schema.uniqueItems) {
      const seen = new Set();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) { errors.push({ path, keyword: 'uniqueItems' }); break; }
        seen.add(key);
      }
    }
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const props = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      // Present-but-undefined is not presence. C-01: optional fields are absent, never undefined.
      if (!Object.hasOwn(value, key) || value[key] === undefined) errors.push({ path: `${path}/${key}`, keyword: 'required' });
    }
    // C-01 default: unknown properties fail validation unless explicitly permitted.
    if (schema.additionalProperties !== true) {
      for (const key of Object.keys(value)) {
        // Own-property lookup, not `in`: `in` walks the prototype chain, so "__proto__",
        // "constructor", "toString" and every other Object.prototype member name would pass
        // the unknown-property gate that C-01 and CT-03 require to reject them.
        if (!Object.hasOwn(props, key)) errors.push({ path: `${path}/${key}`, keyword: 'additionalProperties' });
      }
    }
    for (const [key, sub] of Object.entries(props)) {
      if (Object.hasOwn(value, key) && value[key] !== undefined) check(value[key], sub, root, `${path}/${key}`, errors);
    }
  }
}

/** Returns a frozen array of structural errors; empty means valid. */
export function validate(value, schema) {
  const errors = [];
  check(value, schema, schema, '', errors);
  return Object.freeze(errors);
}

/** Throws ValidationError unless `value` satisfies `schema`. */
export function assertValid(value, schema) {
  const errors = validate(value, schema);
  if (errors.length) throw new ValidationError(errors);
  return value;
}
