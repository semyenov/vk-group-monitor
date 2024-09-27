import ModuleError from "module-error";

export const ERROR_MESSAGES = {
  VK_MONITOR_UPDATE_GROUPS_ERROR: "update groups",
  VK_MONITOR_LEVEL_GET_POST_ERROR: "level get $ID post",
  VK_MONITOR_LEVEL_PUT_POST_ERROR: "level put $ID post",
  VK_MONITOR_LEVEL_GET_GROUP_ERROR: "level get $ID group",
  VK_MONITOR_LEVEL_PUT_GROUP_ERROR: "level put $ID group",
  VK_MONITOR_UPDATE_GIGACHAT_ACCESS_TOKEN_ERROR: "update gigachat access token",
  GIGACHAT_API_KEY_NOT_SET_ERROR: "gigachat api key is not set in configuration",
  GIGACHAT_API_ACCESS_TOKEN_ERROR: "gigachat access token is not available",
  GIGACHAT_API_GET_TOKENS_COUNT_ERROR: "gigachat get tokens count",
  GIGACHAT_API_REWRITE_POST_ERROR: "gigachat rewrite post",
  GROUP_IDS_NOT_SET_ERROR: "group ids is not set or invalid in configuration",
  DB_DIR_NOT_SET_ERROR: "db dir is not set in configuration",
  VK_ACCESS_TOKEN_NOT_SET_ERROR: "vk access token is not set in configuration",
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;

export function createError(params: {
  code: ErrorCode;
  data: Record<string, any>;
  cause?: Error;
  expected?: boolean;
  transient?: boolean;
}) {
  const message: string = params.data.message || ERROR_MESSAGES[params.code];
  return new ModuleError(message, {
    code: params.code,
    cause: params.cause,
    expected: params.expected,
    transient: params.transient,
  });
}
