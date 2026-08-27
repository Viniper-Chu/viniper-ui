import { FrozenRunContext, FrozenRunContextInput } from "../../core/composition-contracts";

export function freezeRunContext(input: FrozenRunContextInput): FrozenRunContext {
  return deepFreeze(clone(input)) as FrozenRunContext;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
