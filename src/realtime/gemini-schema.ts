/**
 * Converts a JSON Schema (as used by MCP / OpenAI tools) into the strict OpenAPI-style
 * `Schema` that Gemini Live accepts in function declarations. Gemini rejects unknown
 * keywords ($schema, additionalProperties, oneOf, const, …) with "Request contains an
 * invalid argument" when the model first tries to use the tools, so anything outside the
 * supported subset is dropped or simplified here.
 */
type Json = Record<string, unknown>;

const TYPES: Record<string, string> = {
  string: 'STRING',
  number: 'NUMBER',
  integer: 'INTEGER',
  boolean: 'BOOLEAN',
  array: 'ARRAY',
  object: 'OBJECT',
};
const MAX_DEPTH = 6;

export function toGeminiSchema(input: unknown): Json {
  const root = (input && typeof input === 'object' ? input : {}) as Json;
  const defs = { ...((root.$defs as Json) ?? {}), ...((root.definitions as Json) ?? {}) };
  const out = convert(root, defs, 0);
  // Function parameters must be an object.
  if (out.type !== 'OBJECT') return { type: 'OBJECT', properties: {} };
  return out;
}

function convert(node: unknown, defs: Json, depth: number): Json {
  if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return { type: 'STRING' };
  let s = node as Json;

  // Resolve local references (#/$defs/X or #/definitions/X).
  if (typeof s.$ref === 'string') {
    const name = s.$ref.split('/').pop() ?? '';
    s = { ...((defs[name] as Json) ?? {}), description: s.description ?? (defs[name] as Json)?.description };
  }
  // Pick the first usable alternative of anyOf/oneOf/allOf (ignoring "null").
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    const alts = s[key];
    if (Array.isArray(alts) && alts.length) {
      const nonNull = alts.filter((a) => !(a && typeof a === 'object' && (a as Json).type === 'null'));
      const chosen = (nonNull[0] ?? alts[0]) as Json;
      const merged = convert({ ...chosen, description: s.description ?? chosen.description }, defs, depth + 1);
      if (nonNull.length < alts.length) merged.nullable = true;
      return merged;
    }
  }

  // Type, including ["string", "null"] style unions.
  let type = s.type;
  let nullable = false;
  if (Array.isArray(type)) {
    nullable = type.includes('null');
    type = type.find((t) => t !== 'null');
  }
  if (typeof type !== 'string' || !TYPES[type]) {
    type = s.properties ? 'object' : s.items ? 'array' : Array.isArray(s.enum) ? 'string' : 'string';
  }
  const out: Json = { type: TYPES[type as string] };
  if (nullable || s.nullable === true) out.nullable = true;
  if (typeof s.description === 'string' && s.description) out.description = s.description.slice(0, 1000);
  else if (typeof s.title === 'string' && s.title) out.description = s.title;

  // enum (Gemini only supports string enums) and const
  const enumValues = Array.isArray(s.enum) ? s.enum : s.const !== undefined ? [s.const] : undefined;
  if (enumValues?.length && out.type === 'STRING') out.enum = enumValues.filter((v) => v !== null).map(String);

  if (out.type === 'STRING' && typeof s.format === 'string' && ['enum', 'date-time'].includes(s.format)) out.format = s.format;
  if ((out.type === 'NUMBER' || out.type === 'INTEGER') && typeof s.minimum === 'number') out.minimum = s.minimum;
  if ((out.type === 'NUMBER' || out.type === 'INTEGER') && typeof s.maximum === 'number') out.maximum = s.maximum;

  if (out.type === 'ARRAY') {
    out.items = convert(s.items ?? { type: 'string' }, defs, depth + 1);
    if (typeof s.minItems === 'number') out.minItems = String(s.minItems);
    if (typeof s.maxItems === 'number') out.maxItems = String(s.maxItems);
  }

  if (out.type === 'OBJECT') {
    const props = (s.properties ?? {}) as Record<string, unknown>;
    const converted: Json = {};
    for (const [k, v] of Object.entries(props)) converted[k] = convert(v, defs, depth + 1);
    // Gemini rejects an OBJECT without properties in nested positions; describe it as a string instead.
    if (!Object.keys(converted).length && depth > 0) {
      return { type: 'STRING', description: `${out.description ?? ''} (JSON object as text)`.trim(), ...(out.nullable ? { nullable: true } : {}) };
    }
    out.properties = converted;
    const required = Array.isArray(s.required) ? s.required.filter((r) => typeof r === 'string' && r in converted) : [];
    if (required.length) out.required = required;
  }
  return out;
}
