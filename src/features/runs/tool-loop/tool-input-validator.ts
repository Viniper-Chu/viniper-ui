import { JsonSchema } from "../../../core/provider-contracts";

export interface ToolInputValidation {
  valid: boolean;
  message?: string;
}

export function validateToolInput(schema: JsonSchema, input: Record<string, unknown>): ToolInputValidation {
  for (const key of schema.required ?? []) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) {
      return { valid: false, message: `缺少必填参数 ${key}。` };
    }
  }

  if (schema.additionalProperties === false) {
    const known = new Set(Object.keys(schema.properties ?? {}));
    const unexpected = Object.keys(input).find((key) => !known.has(key));
    if (unexpected) return { valid: false, message: `包含未声明参数 ${unexpected}。` };
  }

  for (const [key, value] of Object.entries(input)) {
    const expected = schema.properties?.[key]?.type;
    if (!expected) continue;
    const actual = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
    if (actual !== expected) {
      return { valid: false, message: `参数 ${key} 应为 ${expected}，实际为 ${actual}。` };
    }
  }
  return { valid: true };
}
