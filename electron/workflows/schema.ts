type Schema = Record<string, unknown>;

const types = ["object", "array", "string", "number", "integer", "boolean", "null"] as const;

type TypeName = (typeof types)[number];

const keywords = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "pattern",
  "anyOf",
  "oneOf",
  "allOf",
  "description",
  "title",
  "default",
  "examples",
]);

export const supported_keywords = [...keywords];

const is_schema = (value: unknown): value is Schema => typeof value === "object" && value !== null && !Array.isArray(value);

const type_list = (schema: Schema): TypeName[] | null => {
  const raw = schema.type;
  if (raw === undefined) {
    return null;
  }
  return (Array.isArray(raw) ? raw : [raw]) as TypeName[];
};

const count = (value: unknown): boolean => typeof value === "number" && Number.isInteger(value) && value >= 0;

const check_node = (schema: unknown, at: string): string | null => {
  if (!is_schema(schema)) {
    return `${at} must be a schema object`;
  }
  for (const key of Object.keys(schema)) {
    if (!keywords.has(key)) {
      return `${at} uses ${key}, which the result validator does not support; supported keywords: ${supported_keywords.join(", ")}`;
    }
  }
  const listed = type_list(schema);
  if (listed) {
    if (!listed.length || listed.some((name) => !types.includes(name))) {
      return `${at}.type must be one of ${types.join(", ")} or an array of them`;
    }
  }
  if (schema.properties !== undefined) {
    if (!is_schema(schema.properties)) {
      return `${at}.properties must be an object of schemas`;
    }
    for (const [name, child] of Object.entries(schema.properties)) {
      const problem = check_node(child, `${at}.properties.${name}`);
      if (problem) return problem;
    }
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || schema.required.some((name) => typeof name !== "string")) {
      return `${at}.required must be an array of property names`;
    }
    const known = is_schema(schema.properties) ? Object.keys(schema.properties) : [];
    const missing = schema.required.filter((name) => !known.includes(name as string));
    if (missing.length && schema.additionalProperties === false) {
      return `${at}.required names ${missing.join(", ")}, which ${at}.properties does not define while additionalProperties is false, so no value can satisfy it`;
    }
  }
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") {
    const problem = check_node(schema.additionalProperties, `${at}.additionalProperties`);
    if (problem) return problem;
  }
  if (schema.items !== undefined) {
    const problem = check_node(schema.items, `${at}.items`);
    if (problem) return problem;
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length)) {
    return `${at}.enum must be a non-empty array, an empty enum accepts no value`;
  }
  for (const key of ["minItems", "maxItems", "minLength", "maxLength"]) {
    if (schema[key] !== undefined && !count(schema[key])) {
      return `${at}.${key} must be a non-negative integer`;
    }
  }
  for (const key of ["minimum", "maximum"]) {
    if (schema[key] !== undefined && typeof schema[key] !== "number") {
      return `${at}.${key} must be a number`;
    }
  }
  if (count(schema.minItems) && count(schema.maxItems) && (schema.minItems as number) > (schema.maxItems as number)) {
    return `${at}: minItems is larger than maxItems, so no array can satisfy it`;
  }
  if (count(schema.minLength) && count(schema.maxLength) && (schema.minLength as number) > (schema.maxLength as number)) {
    return `${at}: minLength is larger than maxLength, so no string can satisfy it`;
  }
  if (typeof schema.minimum === "number" && typeof schema.maximum === "number" && schema.minimum > schema.maximum) {
    return `${at}: minimum is larger than maximum, so no number can satisfy it`;
  }
  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== "string") {
      return `${at}.pattern must be a string`;
    }
    try {
      new RegExp(schema.pattern, "u");
    } catch (error) {
      return `${at}.pattern is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    const list = schema[key];
    if (list === undefined) continue;
    if (!Array.isArray(list) || !list.length) {
      return `${at}.${key} must be a non-empty array of schemas`;
    }
    for (const [index, child] of list.entries()) {
      const problem = check_node(child, `${at}.${key}[${index}]`);
      if (problem) return problem;
    }
  }
  return null;
};

export const check_schema = (schema: unknown): string | null => {
  if (!is_schema(schema)) {
    return "schema must be a JSON Schema object";
  }
  if (schema.type !== "object" || !is_schema(schema.properties)) {
    return "the schema root must be { type: 'object', properties: { ... } }";
  }
  const required = Array.isArray(schema.required) ? schema.required : [];
  const missing = required.filter((name) => typeof name === "string" && !Object.hasOwn(schema.properties as Schema, name));
  if (missing.length) {
    return `schema.required names ${missing.join(", ")}, which schema.properties does not define`;
  }
  return check_node(schema, "schema");
};

const type_of = (value: unknown): TypeName => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  if (typeof value === "object") return "object";
  return typeof value as TypeName;
};

const type_matches = (wanted: TypeName, actual: TypeName): boolean => wanted === actual || (wanted === "number" && actual === "integer");

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

const pointer_part = (key: string | number): string => `/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;

const where = (pointer: string): string => pointer || "the result";

const validate_node = (schema: Schema, value: unknown, pointer: string, errors: string[]): void => {
  const listed = type_list(schema);
  const actual = type_of(value);
  if (listed && !listed.some((name) => type_matches(name, actual))) {
    errors.push(`${where(pointer)} must be ${listed.join(" or ")}, got ${actual}`);
    return;
  }
  if (schema.const !== undefined && !same(schema.const, value)) {
    errors.push(`${where(pointer)} must be ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => same(entry, value))) {
    errors.push(`${where(pointer)} must be one of ${schema.enum.map((entry) => JSON.stringify(entry)).join(", ")}`);
  }
  if (typeof value === "string") {
    if (count(schema.minLength) && value.length < (schema.minLength as number)) errors.push(`${where(pointer)} must have at least ${schema.minLength} characters`);
    if (count(schema.maxLength) && value.length > (schema.maxLength as number)) errors.push(`${where(pointer)} must have at most ${schema.maxLength} characters`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${where(pointer)} must match the pattern ${schema.pattern}`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(`${where(pointer)} must be at least ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(`${where(pointer)} must be at most ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (count(schema.minItems) && value.length < (schema.minItems as number)) errors.push(`${where(pointer)} must have at least ${schema.minItems} items`);
    if (count(schema.maxItems) && value.length > (schema.maxItems as number)) errors.push(`${where(pointer)} must have at most ${schema.maxItems} items`);
    if (is_schema(schema.items)) {
      for (const [index, item] of value.entries()) validate_node(schema.items, item, `${pointer}${pointer_part(index)}`, errors);
    }
  }
  if (actual === "object") {
    const record = value as Record<string, unknown>;
    const properties = is_schema(schema.properties) ? schema.properties : {};
    for (const name of Array.isArray(schema.required) ? schema.required : []) {
      if (typeof name === "string" && !Object.hasOwn(record, name)) errors.push(`${where(pointer)} is missing the required property ${name}`);
    }
    for (const [name, child] of Object.entries(record)) {
      const declared = properties[name];
      if (is_schema(declared)) {
        validate_node(declared, child, `${pointer}${pointer_part(name)}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${where(pointer)} has the property ${name}, which the schema does not allow`);
      } else if (is_schema(schema.additionalProperties)) {
        validate_node(schema.additionalProperties, child, `${pointer}${pointer_part(name)}`, errors);
      }
    }
  }
  const branch_errors = (branch: unknown): string[] => {
    const found: string[] = [];
    if (is_schema(branch)) validate_node(branch, value, pointer, found);
    return found;
  };
  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) errors.push(...branch_errors(branch));
  }
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((branch) => !branch_errors(branch).length)) {
    errors.push(`${where(pointer)} matches none of the anyOf alternatives`);
  }
  if (Array.isArray(schema.oneOf)) {
    const matching = schema.oneOf.filter((branch) => !branch_errors(branch).length).length;
    if (matching !== 1) errors.push(`${where(pointer)} must match exactly one oneOf alternative, it matches ${matching}`);
  }
};

export const validate_result = (schema: Schema, value: unknown): string[] => {
  const errors: string[] = [];
  validate_node(schema, value, "", errors);
  return errors;
};
