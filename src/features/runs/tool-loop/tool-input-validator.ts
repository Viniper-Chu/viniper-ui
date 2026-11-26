import { JsonSchema, JsonSchemaProperty } from "../../../core/provider-contracts";

export interface ToolInputValidation {
  valid: boolean;
  message?: string;
}

/**
 * Safely normalize lossless scalar/container mismatches produced by small local
 * models (e.g. single string passed where string[] is expected, "true"/"false"
 * for boolean, numeric strings for number/integer, or numbers where math string
 * coefficients are expected). Mutates a cloned copy or in place before validation.
 */
export function coerceToolInput(schema: JsonSchema | JsonSchemaProperty, input: Record<string, unknown>): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || !schema.properties) return input;
  for (const [key, prop] of Object.entries(schema.properties)) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
    input[key] = coerceValue(prop, input[key]);
  }
  return input;
}

function coerceValue(prop: JsonSchemaProperty, value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (prop.type === "array" && !Array.isArray(value)) {
    const itemType = (prop.items as JsonSchemaProperty | undefined)?.type;
    if (typeof value === "string" && value.trim() && (!itemType || itemType === "string")) {
      return [value];
    }
    if (typeof value === "object" && itemType === "object") {
      return [coerceToolInput(prop.items as JsonSchemaProperty, { ...(value as Record<string, unknown>) })];
    }
    return value;
  }
  if (prop.type === "array" && Array.isArray(value) && prop.items) {
    const itemProp = prop.items as JsonSchemaProperty;
    return value.map((item) => coerceValue(itemProp, item));
  }
  if (prop.type === "object" && typeof value === "object" && !Array.isArray(value)) {
    return coerceToolInput(prop, value as Record<string, unknown>);
  }
  if (prop.type === "boolean" && typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  if ((prop.type === "number" || prop.type === "integer") && typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && (prop.type === "number" || Number.isInteger(parsed))) return parsed;
  }
  if (prop.type === "string" && (typeof value === "number" || typeof value === "boolean") && Number.isFinite(Number(value))) {
    return String(value);
  }
  return value;
}

export function validateToolInput(schema: JsonSchema | JsonSchemaProperty, input: Record<string, unknown>, pathPrefix = ""): ToolInputValidation {
  coerceToolInput(schema, input);
  for (const key of schema.required ?? []) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) {
      return { valid: false, message: `缺少必填参数 ${pathPrefix}${key}。` };
    }
  }

  if (schema.additionalProperties === false) {
    const known = new Set(Object.keys(schema.properties ?? {}));
    const unexpected = Object.keys(input).find((key) => !known.has(key));
    if (unexpected) return { valid: false, message: `包含未声明参数 ${pathPrefix}${unexpected}。` };
  }

  for (const [key, value] of Object.entries(input)) {
    const prop = schema.properties?.[key];
    const expected = prop?.type;
    if (!expected || value === undefined) continue;
    const label = `${pathPrefix}${key}`;
    const actual = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
    const typeMatches = expected === "integer"
      ? typeof value === "number" && Number.isInteger(value)
      : actual === expected;
    if (!typeMatches) {
      return { valid: false, message: `参数 ${label} 应为 ${expected}，实际为 ${actual}。` };
    }
    if (expected === "object" && prop.properties && value && typeof value === "object" && !Array.isArray(value)) {
      const nested = validateToolInput(prop, value as Record<string, unknown>, `${label}.`);
      if (!nested.valid) return nested;
    }
    if (expected === "array" && prop.items && Array.isArray(value)) {
      const itemProp = prop.items as JsonSchemaProperty;
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        const itemActual = Array.isArray(item) ? "array" : item === null ? "null" : typeof item;
        const itemOk = itemProp.type === "integer"
          ? typeof item === "number" && Number.isInteger(item)
          : itemActual === itemProp.type;
        if (!itemOk) {
          return { valid: false, message: `参数 ${label}[${i}] 应为 ${itemProp.type}，实际为 ${itemActual}。` };
        }
        if (itemProp.type === "object" && itemProp.properties && item && typeof item === "object" && !Array.isArray(item)) {
          const nested = validateToolInput(itemProp, item as Record<string, unknown>, `${label}[${i}].`);
          if (!nested.valid) return nested;
        }
      }
    }
  }
  return { valid: true };
}
