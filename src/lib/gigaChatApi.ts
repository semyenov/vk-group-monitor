import fetch, { FetchError } from "node-fetch";
import { randomUUID } from "crypto";
import { httpsAgent } from "./httpAgent";
import { createConsola } from "consola";
import { createError } from "./errors";

const logger = createConsola({ defaults: { tag: "GigaChatApi" } });

export async function updateGigachatAccessToken(
  gigaChatApiKey: string,
): Promise<string | null> {
  logger.debug("updateGigachatAccessToken");

  try {
    const response = await fetch(
      "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
      {
        method: "POST",
        agent: httpsAgent,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${gigaChatApiKey}`,
          RqUID: randomUUID(),
        },
        body: new URLSearchParams([["scope", "GIGACHAT_API_PERS"]]),
      },
    );

    const json = (await response.json()) as { access_token: string };
    logger.debug("updateGigachatAccessToken response", json);
    return json["access_token"];
  } catch (error) {
    throw createError({
      code: "GIGACHAT_API_ACCESS_TOKEN_ERROR",
      cause: error instanceof Error ? error : new Error(String(error)),
      expected: true,
      transient: false,
      data: {},
    });
  }
}

export async function getGigaChatTokensCount(
  text: string,
  clientId: string,
  gigaChatApiKey: string,
  gigachatAccessToken: string,
): Promise<
  {
    index: number;
    text: string;
    tokens: number;
    characters: number;
  }[]
> {
  logger.debug("getGigaChatTokensCount", text);

  const input = text
    .split("\n\n")
    .map((line, index) => ({
      index,
      text: line.trim(),
      characters: line.length,
      tokens: 0,
    }))
    .filter((item) => item.text.length > 0);

  const body = JSON.stringify({
    model: "GigaChat",
    input: input.map((item) => item.text),
  });

  try {
    const response = await fetch(
      "https://gigachat.devices.sberbank.ru/api/v1/tokens/count",
      {
        method: "POST",
        agent: httpsAgent,
        headers: [
          ["X-Client-Id", clientId],
          ["X-Request-Id", randomUUID()],
          ["Content-Type", "application/json"],
          ["Authorization", `Bearer ${gigachatAccessToken}`],
        ],
        body,
      },
    );

    const json = (await response.json()) as {
      object: string;
      characters: number;
      tokens: number;
    }[];

    logger.debug("getGigaChatTokensCount response", json);

    json.forEach((data, index) => {
      if (input[index]) {
        input[index].tokens = data.tokens;
      }
    });

    return input.filter((item) => item.tokens > 0);
  } catch (error) {
    throw createError({
      code: "GIGACHAT_API_GET_TOKENS_COUNT_ERROR",
      cause: error instanceof Error ? error : new Error(String(error)),
      expected: true,
      transient: false,
      data: {},
    });
  }
}

export async function getGigaChatRewritePost(
  text: string,
  messages: { role: string; content: string }[],
  clientId: string,
  gigaChatApiKey: string,
  gigachatAccessToken: string,
): Promise<string | null> {
  logger.debug("getGigaChatRewritePost", text);

  const tokens = await getGigaChatTokensCount(
    text,
    clientId,
    gigaChatApiKey,
    gigachatAccessToken,
  );
  const maxTokens = 120000;
  const maxCharacters = 1000000;

  let currentTokens = 0;
  let currentCharacters = 0;
  let currentText = "";

  for (const token of tokens) {
    if (
      currentTokens + token.tokens > maxTokens ||
      currentCharacters + token.characters > maxCharacters
    ) {
      break;
    }

    currentTokens += token.tokens;
    currentCharacters += token.characters;
    currentText += token.text + "\n\n";
  }

  const body = JSON.stringify({
    model: "GigaChat",
    stream: false,
    update_interval: 0,
    messages: [
      ...messages,
      {
        role: "user",
        content: "Статья:\n\n" + currentText.trim(),
      },
    ],
  });

  try {
    const response = await fetch(
      "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
      {
        method: "POST",
        agent: httpsAgent,
        headers: [
          ["X-Client-Id", clientId],
          ["X-Request-Id", randomUUID()],
          ["Content-Type", "application/json"],
          ["Authorization", `Bearer ${gigachatAccessToken}`],
        ],
        body,
      },
    );

    const json = (await response.json()) as {
      choices: { message: { content: string } }[];
    };

    logger.debug("getGigaChatRewritePost response", json);

    return json.choices.map((choice) => choice.message.content).join("\n");
  } catch (error) {
    if (
      error instanceof FetchError &&
      error.code === "401"
    ) {
      logger.debug("getGigaChatRewritePost 401 error");
      const gigachatAccessToken = await updateGigachatAccessToken(
        gigaChatApiKey,
      );
      if (!gigachatAccessToken) {
        throw createError({
          code: "GIGACHAT_API_ACCESS_TOKEN_ERROR",
          cause: error instanceof Error ? error : new Error(String(error)),
          expected: true,
          transient: false,
        });
      }

      return getGigaChatRewritePost(
        text,
        messages,
        clientId,
        gigaChatApiKey,
        gigachatAccessToken,
      );
    }

    throw createError({
      code: "GIGACHAT_API_REWRITE_POST_ERROR",
      cause: error instanceof Error ? error : new Error(String(error)),
      expected: true,
      transient: false,
      data: {},
    });
  }
}
