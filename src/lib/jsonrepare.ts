import { jsonrepair } from "jsonrepair";
import { createError } from "./errors";

export function repairJson(json: string): string {
  try {
    const repairedJson = jsonrepair(json);
    return JSON.parse(repairedJson);
  } catch (error) {
    throw createError({
      code: "JSON_REPAIR_FAILED",
      cause: error as Error,
      expected: true,
      transient: true,
      data: {
        json,
      },
    });
  }
}
