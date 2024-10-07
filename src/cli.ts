#!/usr/bin/env node
import yaml from "js-yaml";
import { readFile, stat } from "node:fs/promises";
import { join } from "pathe";

import { VKGroupMonitor } from "./index";
import {
  createApp,
  createRouter,
  defineEventHandler,
  getRouterParam,
  serveStatic,
  toNodeListener,
} from "h3";
import { listen } from "listhen";
import { createBasicAuthMiddleware } from "h3-basic-auth";

import type { VKGroupMonitorConfig } from "./lib/types";
import fs from "unstorage/drivers/fs";
import { readFileSync } from "node:fs";
import { createServeStaticHandler } from "./lib/static";

const args = process.argv.slice(2);
const configFilePath = args[0] || "./config.yaml";

const config: VKGroupMonitorConfig = {
  vkAccessToken: process.env.VK_ACCESS_TOKEN || "",
  groupIds: process.env.GROUP_IDS?.split(",").map(Number) || [],
  pollInterval: Number(process.env.POLL_INTERVAL) || 60000,
  postsPerRequest: Number(process.env.POSTS_PER_REQUEST) || 10,
  gigachatApiKey: process.env.GIGACHAT_API_KEY || "",
  dbDir: process.env.DB_DIR || "./db",
  publicDir: process.env.PUBLIC_DIR || "./public",
  auth: {
    username: process.env.AUTH_USERNAME || "admin",
    password: process.env.AUTH_PASSWORD || "password",
    sessionSecret: process.env.AUTH_SESSION_SECRET || "secret",
  },
  parameters: {
    temperature: 0.7,
    max_tokens: 1500,
    top_p: 1.0,
    frequency_penalty: 0.0,
    presence_penalty: 0.0,
  },
  messages: [
    {
      role: "system",
      content: "You are a helpful assistant.",
    },
    {
      role: "user",
      content: "Rewrite the following text in a more concise and engaging way.",
    },
  ],
};

const loadConfig = (filePath: string) => {
  try {
    const fileContents = readFileSync(filePath, "utf8");
    const data = yaml.load(fileContents) as Record<string, any>;
    for (const [key, value] of Object.entries(data)) {
      if (key in config) {
        config[key] = value;
      }
    }
  } catch (e) {
    console.error("Ошибка при загрузке конфигурации:", e);
    throw e;
  }
};

loadConfig(configFilePath);
const monitor = new VKGroupMonitor(config);

monitor.on("postProcessed", (processedPost) => {
  console.log("\n---");
  console.log("Группа:", processedPost.groupId);
  console.log("Номер поста:", processedPost.id);
  console.log("Оригинал;\n----");
  console.log(processedPost.original);
  console.log("----\n");
  console.log("Переписанный;\n----");
  console.log(processedPost.rewritten);
  console.log("----\n");
});

monitor.on("error", (error: Error) => {
  console.error("Произошла ошибка:", error);
});

monitor
  .start()
  .catch((error) => console.error("Ошибка при запуске VKGroupMonitor:", error));

const app = createApp();
const router = createRouter();

router.get(
  "/api/posts",
  defineEventHandler(async (_event) => {
    const posts = await monitor.getPosts();
    return {
      success: true,
      data: posts.map((post) => ({
        ...post,
        rewritten: post.rewritten.map((post) => monitor.validatePost(post)),
      })),
    };
  }),
);

router.get(
  "/api/posts/:id",
  defineEventHandler(async (event) => {
    const postId = getRouterParam(event, "id");
    if (!postId) {
      return {
        success: false,
        error: "Post ID is required",
      };
    }

    const post = await monitor.getPost(Number(postId));
    if (!post) {
      return {
        success: false,
        error: "Post not found",
      };
    }

    return {
      success: true,
      data: {
        ...post,
        rewritten: post.rewritten.map((post) => monitor.validatePost(post)),
      },
    };
  }),
);

router.post(
  "/api/posts/:id/rewrite",
  defineEventHandler(async (event) => {
    const postId = getRouterParam(event, "id");
    if (!postId) {
      return {
        success: false,
        error: "Post ID is required",
      };
    }

    const post = await monitor.getPost(Number(postId));
    if (!post) {
      return {
        success: false,
        error: "Post not found",
      };
    }

    const rewrittenPost = await monitor.processPost(post);
    if (!rewrittenPost) {
      return {
        success: false,
        error: "Failed to rewrite post",
      };
    }

    return {
      success: true,
      data: {
        ...rewrittenPost,
        rewritten: rewrittenPost.rewritten.map((post) =>
          monitor.validatePost(post)
        ),
      },
    };
  }),
);

router.get(
  "/api/groups",
  defineEventHandler(async (_event) => {
    const groups = await monitor.getGroups();
    return {
      success: true,
      data: groups,
    };
  }),
);

router.get(
  "/api/groups/:id",
  defineEventHandler(async (event) => {
    const groupId = getRouterParam(event, "id");
    if (!groupId) {
      return {
        success: false,
        error: "Group ID is required",
      };
    }

    const group = await monitor.getGroup(Number(groupId));
    return {
      success: true,
      data: group,
    };
  }),
);

const basicAuth = createBasicAuthMiddleware(config.auth);
const serveStaticHandler = createServeStaticHandler(config.publicDir);

app.use(router);
app.use(serveStaticHandler);
app.use(basicAuth);

listen(toNodeListener(app), {
  hostname: "0.0.0.0",
  port: 3000,
});

process.on("SIGINT", async () => {
  console.log("Завершение работы...");
  monitor.stop();

  process.exit(0);
});
