#!/usr/bin/env node
import yaml from "js-yaml";
import fs from "fs";
import { VKGroupMonitor, VKGroupMonitorConfig } from "./index";
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

// Get config file path from command line arguments
const args = process.argv.slice(2);
const configFilePath = args[0] || "./config.yaml";

const config: VKGroupMonitorConfig = {
  vkAccessToken: process.env.VK_ACCESS_TOKEN || "",
  groupIds: process.env.GROUP_IDS?.split(",").map(Number) || [],
  pollInterval: Number(process.env.POLL_INTERVAL) || 60000,
  postsPerRequest: Number(process.env.POSTS_PER_REQUEST) || 10,
  gigachatApiKey: process.env.GIGACHAT_API_KEY || "",
  dbDir: process.env.DB_DIR || "./db",
  auth: {
    username: process.env.AUTH_USERNAME || "admin",
    password: process.env.AUTH_PASSWORD || "password",
    sessionSecret: process.env.AUTH_SESSION_SECRET || "secret",
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
    const fileContents = fs.readFileSync(filePath, "utf8");
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
  console.log("Оригинал:\n", processedPost.original);
  console.log("---\n");
  console.log(processedPost.rewritten);
});

monitor.on("error", (error: Error) => {
  console.error("Произошла ошибка:", error);
});

monitor
  .start()
  .catch((error) => console.error("Ошибка при запуске VKGroupMonitor:", error));

const app = createApp();
const router = createRouter();

router.use(
  "/",
  defineEventHandler(async (event) => {
    return fs.readFileSync("./public/index.html", "utf8");
  }),
);

router.get(
  "/api/posts",
  defineEventHandler(async (event) => {
    const posts = await monitor.getPosts();
    return { success: true, data: posts };
  }),
);

router.get(
  "/api/posts/:id",
  defineEventHandler(async (event) => {
    const postId = getRouterParam(event, "id");
    if (!postId) {
      return { success: false, error: "Post ID is required" };
    }

    const post = await monitor.getPost(Number(postId));
    if (!post) {
      return { success: false, error: "Post not found" };
    }

    return { success: true, data: post };
  }),
);

router.get(
  "/api/groups",
  defineEventHandler(async (event) => {
    const groups = await monitor.getGroups();
    return { success: true, data: groups };
  }),
);

router.get(
  "/api/groups/:id",
  defineEventHandler(async (event) => {
    const groupId = getRouterParam(event, "id");
    if (!groupId) {
      return { success: false, error: "Group ID is required" };
    }

    const group = await monitor.getGroup(Number(groupId));
    return { success: true, data: group };
  }),
);

app.use(router);

const basicAuth = createBasicAuthMiddleware(config.auth);
app.use(basicAuth);

listen(toNodeListener(app), {
  port: 3000,
});

process.on("SIGINT", async () => {
  console.log("Завершение работы...");
  process.exit(0);
});
