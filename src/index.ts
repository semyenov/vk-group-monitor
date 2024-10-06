import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { FetchError } from "node-fetch";
import { createStorage, type Storage } from "unstorage";
import fsDriver from "unstorage/drivers/fs";
import { createError, ErrorCode } from "./lib/errors";
import { logger } from "./lib/logger";

import * as vkApi from "./lib/vkApi";
import * as gigaChatApi from "./lib/gigaChatApi";

import type {
  VKGroupMonitorConfig,
  VKGroupMonitorEvents,
  VKGroupMonitorGroup,
  VKGroupMonitorPost,
} from "./lib/types";

export class VKGroupMonitor extends EventEmitter<VKGroupMonitorEvents> {
  // Private fields
  #clientId: string = randomUUID();
  #groupIds: number[] = [];
  #gigaChatApiKey: string = "";
  #gigachatAccessToken: string | null = null;
  #vkAccessToken: string = "";
  #pollInterval: number = 10000;
  #postsPerRequest: number = 100;
  #messages: { role: string; content: string }[] = [];
  #pollTimeout: NodeJS.Timeout | null = null;
  #postsDb: Storage<VKGroupMonitorPost> | null = null;
  #groupsDb: Storage<VKGroupMonitorGroup> | null = null;

  constructor(config: VKGroupMonitorConfig) {
    super();

    logger.debug("constructor", config);

    this.#validateConfig(config);
    this.#initializeState(config);
    this.#initializeDatabases(config.dbDir);
  }

  public async start(): Promise<void> {
    logger.debug("start");

    await this.#updateGigachatAccessToken();
    await this.#updateGroups();

    this.#poll();
  }

  public stop(): void {
    logger.debug("stop");

    if (this.#pollTimeout) {
      clearTimeout(this.#pollTimeout);
    }
  }

  #validateConfig(config: VKGroupMonitorConfig): void {
    if (!config.dbDir) {
      throw this.#handleError(
        "DB_DIR_NOT_SET_ERROR",
        new Error("DB_DIR_NOT_SET_ERROR"),
      );
    }
    if (!config.vkAccessToken) {
      throw this.#handleError(
        "VK_ACCESS_TOKEN_NOT_SET_ERROR",
        new Error("VK_ACCESS_TOKEN_NOT_SET_ERROR"),
      );
    }
    if (!config.gigachatApiKey) {
      throw this.#handleError(
        "GIGACHAT_API_KEY_NOT_SET_ERROR",
        new Error("GIGACHAT_API_KEY_NOT_SET_ERROR"),
      );
    }
    if (config.groupIds.length === 0) {
      throw this.#handleError(
        "GROUP_IDS_NOT_SET_ERROR",
        new Error("GROUP_IDS_NOT_SET_ERROR"),
      );
    }
  }

  #initializeState(config: VKGroupMonitorConfig): void {
    this.#vkAccessToken = config.vkAccessToken;
    this.#gigaChatApiKey = config.gigachatApiKey;
    this.#pollInterval = config.pollInterval;
    this.#postsPerRequest = config.postsPerRequest;
    this.#messages = config.messages;
    this.#groupIds = config.groupIds;
  }

  #initializeDatabases(dbDir: string): void {
    this.#postsDb! = createStorage({
      driver: fsDriver({
        base: `${dbDir}/posts`,
        watchOptions: {
          useFsEvents: true,
        },
      }),
    });

    this.#groupsDb = createStorage({
      driver: fsDriver({
        base: `${dbDir}/groups`,
        watchOptions: {
          useFsEvents: true,
        },
      }),
    });
  }

  async #updateGigachatAccessToken(): Promise<string | null> {
    try {
      this.#gigachatAccessToken = await gigaChatApi.updateGigachatAccessToken(
        this.#gigaChatApiKey,
      );
      return this.#gigachatAccessToken;
    } catch (error) {
      this.#handleError("VK_MONITOR_UPDATE_GIGACHAT_ACCESS_TOKEN_ERROR", error);
      return null;
    }
  }

  async #poll(): Promise<void> {
    for (const groupId of this.#groupIds) {
      const group = await this.getGroup(groupId);
      if (group) {
        await this.#fetchGroupPosts(group);
      }
    }

    this.#pollTimeout = setTimeout(
      () => this.#poll(),
      this.#pollInterval,
    );
  }

  async #fetchGroupPosts(group: VKGroupMonitorGroup): Promise<void> {
    let hasMorePosts = true;
    let lastCheckedDate = group.lastCheckedDate;
    let offset = 0;

    while (hasMorePosts) {
      try {
        const posts = await vkApi.fetchPosts(
          this.#vkAccessToken,
          this.#clientId,
          group.id,
          offset,
          this.#postsPerRequest,
        );

        if (posts.length === 0) {
          hasMorePosts = false;
          break;
        }

        for (const post of posts) {
          if (post.date > group.lastCheckedDate) {
            await this.processPost(post);
            console.log("offset", post.id, offset, lastCheckedDate, post.date);
            lastCheckedDate = Math.max(lastCheckedDate, post.date);
          } else {
            hasMorePosts = false;
            break;
          }
        }

        offset += posts.length;
      } catch (error) {
        this.#handleError("VK_FETCH_GROUP_POSTS_ERROR", error, {
          groupId: group.id,
        });
      }
    }

    await this.#putGroup({
      ...group,
      offset: 0,
      lastCheckedDate,
    });
  }

  public async processPost(
    {
      id,
      original,
      date,
      rewritten,
      groupId,
      viewsCount,
      repostsCount,
      likesCount,
      attachments,
    }: VKGroupMonitorPost,
  ): Promise<VKGroupMonitorPost | null> {
    if (!this.#gigachatAccessToken) {
      await this.#updateGigachatAccessToken();
      if (!this.#gigachatAccessToken) {
        throw this.#handleError(
          "GIGACHAT_API_ACCESS_TOKEN_ERROR",
          new Error("GIGACHAT_API_ACCESS_TOKEN_ERROR"),
        );
      }
    }

    const rewrittenPost = await this.#getRewrittenPost(original);
    if (!rewrittenPost) {
      return null;
    }

    const post: VKGroupMonitorPost = {
      id,
      date,
      groupId,
      original,
      viewsCount,
      repostsCount,
      likesCount,
      attachments,
      rewritten: [
        ...rewritten,
        rewrittenPost,
      ],
    };

    await this.#putPost(post);
    this.emit("postProcessed", post);

    return post;
  }

  async #getRewrittenPost(text: string): Promise<string | null> {
    return await gigaChatApi.getGigaChatRewritePost(
      text,
      this.#messages,
      this.#clientId,
      this.#gigaChatApiKey,
      this.#gigachatAccessToken!,
    );
  }

  async #putPost(post: VKGroupMonitorPost): Promise<void> {
    try {
      await this.#postsDb!.setItem(post.id.toString(), post);
    } catch (error) {
      this.#handleError("VK_MONITOR_LEVEL_PUT_POST_ERROR", error, { post });
    }
  }

  #handleError(code: ErrorCode, error: unknown, data: object = {}): void {
    this.emit(
      "error",
      createError({
        code,
        cause: error instanceof Error ? error : new Error(String(error)),
        expected: true,
        transient: false,
        data,
      }),
    );
    logger.debug(`${code} error`, error);
  }

  async #updateGroups(): Promise<void> {
    logger.debug("updateGroups");

    const missingGroupIds: number[] = [];

    for (const groupId of this.#groupIds) {
      const group = await this.getGroup(groupId);
      if (!group) {
        missingGroupIds.push(groupId);
      }
    }

    if (missingGroupIds.length === 0) {
      return;
    }

    // Fetch groups
    try {
      const fetchedGroups = await vkApi.fetchGroups(
        this.#vkAccessToken,
        this.#clientId,
        missingGroupIds,
      );

      for (const data of fetchedGroups) {
        const group = await this.getGroup(data.id);
        await this.#putGroup({
          ...data,
          lastCheckedDate: group?.lastCheckedDate ||
            Date.now() / 1000 - 60 * 60 * 24 * 5,
          offset: group?.offset || 0,
        });
      }

      logger.debug("updateGroups response", fetchedGroups);
    } catch (error) {
      this.emit(
        "error",
        createError({
          code: "VK_MONITOR_UPDATE_GROUPS_ERROR",
          cause: error instanceof Error ? error : new Error(String(error)),
          expected: true,
          transient: false,
          data: {},
        }),
      );

      logger.debug("updateGroups error", error);
    }
  }

  public async getPosts(): Promise<VKGroupMonitorPost[]> {
    logger.debug("getPosts");

    const posts: VKGroupMonitorPost[] = [];
    for (const key of await this.#postsDb!.getKeys("")) {
      const post = await this.#postsDb!.getItem(key);
      if (post) {
        posts.push(post);
      }
    }

    logger.debug("getPosts response", posts);

    return posts.sort((a, b) => b.date - a.date);
  }

  public async getPost(postId: number): Promise<VKGroupMonitorPost | null> {
    logger.debug("getPost", postId);

    try {
      const post = await this.#postsDb!.getItem(postId.toString());
      if (!post) {
        return null;
      }

      logger.debug("getPost response", post);

      return post;
    } catch (error) {
      if (error instanceof Error && "code" in error) {
        if (error.code === "LEVEL_NOT_FOUND") {
          return null;
        }

        this.emit(
          "error",
          createError({
            code: "VK_MONITOR_LEVEL_GET_POST_ERROR",
            cause: error,
            expected: true,
            transient: false,
            data: { postId },
          }),
        );

        logger.debug("getPost error", error);
      }

      return null;
    }
  }

  async #putGroup(group: VKGroupMonitorGroup): Promise<void> {
    try {
      await this.#groupsDb!.setItem(group.id.toString(), group);
    } catch (error) {
      this.#handleError("VK_MONITOR_LEVEL_PUT_GROUP_ERROR", error, { group });
    }
  }

  public async getGroup(groupId: number): Promise<VKGroupMonitorGroup | null> {
    logger.debug("getGroup", groupId);

    try {
      const group = await this.#groupsDb!.getItem(groupId.toString());
      if (!group) {
        return null;
      }

      return group;
    } catch (error) {
      if (error instanceof FetchError) {
        if (error.code === "LEVEL_NOT_FOUND") {
          return null;
        }

        this.emit(
          "error",
          createError({
            code: "VK_MONITOR_LEVEL_GET_GROUP_ERROR",
            cause: error,
            expected: true,
            transient: false,
            data: { groupId },
          }),
        );
      }

      logger.debug("getGroup error", error);

      return null;
    }
  }

  public async getGroups(): Promise<VKGroupMonitorGroup[]> {
    logger.debug("getGroups");

    const groups: VKGroupMonitorGroup[] = [];
    for (const groupId of this.#groupIds) {
      const group = await this.getGroup(groupId);
      if (group) {
        groups.push(group);
      }
    }

    logger.debug("getGroups response", groups);

    return groups.sort((a, b) => b.lastCheckedDate - a.lastCheckedDate);
  }
}
