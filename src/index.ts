import { Level } from "level";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { FetchError } from "node-fetch";

import { createError } from "./lib/errors";
import { logger } from "./lib/logger";

import * as vkApi from "./lib/vkApi";
import * as gigaChatApi from "./lib/gigaChatApi";

import type {
  PostData,
  VKGroupMonitorConfig,
  VKGroupMonitorEvents,
  VKGroupMonitorGroup,
  VKGroupMonitorPost,
} from "./lib/types";

export class VKGroupMonitor extends EventEmitter<VKGroupMonitorEvents> {
  private clientId: string = randomUUID();
  private groupIds: number[];

  // GigaChat API keys
  private gigaChatApiKey: string;
  private gigachatAccessToken: string | null = null;

  // VK API keys
  private vkAccessToken: string;

  // Config
  private pollInterval: number;
  private postsPerRequest: number;
  private messages: { role: string; content: string }[];

  // Timeout for polling groups
  private pollTimeout: NodeJS.Timeout | null = null;

  // LevelDB
  private postsDb: Level<string, VKGroupMonitorPost>;
  private groupsDb: Level<string, VKGroupMonitorGroup>;

  constructor(config: VKGroupMonitorConfig) {
    super();

    logger.debug("constructor", config);

    if (!config.dbDir) {
      throw createError({
        code: "DB_DIR_NOT_SET_ERROR",
        expected: true,
        transient: false,
      });
    }

    if (!config.vkAccessToken) {
      throw createError({
        code: "VK_ACCESS_TOKEN_NOT_SET_ERROR",
        expected: true,
        transient: false,
      });
    }

    if (!config.gigachatApiKey) {
      throw createError({
        code: "GIGACHAT_API_KEY_NOT_SET_ERROR",
        expected: true,
        transient: false,
      });
    }

    if (config.groupIds.length === 0) {
      throw createError({
        code: "GROUP_IDS_NOT_SET_ERROR",
        expected: true,
        transient: false,
      });
    }

    this.groupIds = config.groupIds;

    this.vkAccessToken = config.vkAccessToken;
    this.gigaChatApiKey = config.gigachatApiKey;

    this.pollInterval = config.pollInterval;
    this.postsPerRequest = config.postsPerRequest;
    this.messages = config.messages;

    // Initialize LevelDB
    this.postsDb = new Level<string, VKGroupMonitorPost>(
      `${config.dbDir}/posts`,
      {
        valueEncoding: "json",
        errorIfExists: false,
        createIfMissing: true,
      },
    );

    this.groupsDb = new Level<string, VKGroupMonitorGroup>(
      `${config.dbDir}/groups`,
      {
        valueEncoding: "json",
        errorIfExists: false,
        createIfMissing: true,
      },
    );

    logger.debug("constructor response", this);
  }

  public async start(): Promise<void> {
    await this.updateGigachatAccessToken();
    await this.updateGroups();

    await this.poll();
  }

  public stop(): void {
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
  }

  public async getPosts(): Promise<VKGroupMonitorPost[]> {
    const posts: VKGroupMonitorPost[] = [];
    for await (const key of this.postsDb.keys()) {
      const post = await this.postsDb.get(key);
      if (post) {
        posts.push(post);
      }
    }

    return posts.sort((a, b) => b.date - a.date);
  }

  public async getPost(postId: number): Promise<VKGroupMonitorPost | null> {
    try {
      const post = await this.postsDb.get(postId.toString());
      if (!post) {
        return null;
      }

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
      }

      return null;
    }
  }

  public async getGroup(groupId: number): Promise<VKGroupMonitorGroup | null> {
    try {
      const group = await this.groupsDb.get(groupId.toString());
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

      return null;
    }
  }

  public async getGroups(): Promise<VKGroupMonitorGroup[]> {
    const groups: VKGroupMonitorGroup[] = [];
    for (const groupId of this.groupIds) {
      const group = await this.getGroup(groupId);
      if (group) {
        groups.push(group);
      }
    }

    return groups.sort((a, b) => b.lastCheckedDate - a.lastCheckedDate);
  }

  private async updateGigachatAccessToken(): Promise<string | null> {
    logger.debug("updateGigachatAccessToken");

    try {
      const accessToken = await gigaChatApi.updateGigachatAccessToken(
        this.gigaChatApiKey,
      );
      this.gigachatAccessToken = accessToken;

      logger.debug(
        "updateGigachatAccessToken response",
        this.gigachatAccessToken,
      );

      return this.gigachatAccessToken;
    } catch (error) {
      this.emit(
        "error",
        createError({
          code: "VK_MONITOR_UPDATE_GIGACHAT_ACCESS_TOKEN_ERROR",
          cause: error instanceof Error ? error : new Error(String(error)),
          expected: true,
          transient: false,
          data: {},
        }),
      );

      return null;
    }
  }

  private async putGroup(group: VKGroupMonitorGroup): Promise<void> {
    try {
      await this.groupsDb.put(group.id.toString(), group);
    } catch (error) {
      this.emit(
        "error",
        createError({
          code: "VK_MONITOR_LEVEL_PUT_GROUP_ERROR",
          cause: error instanceof Error ? error : new Error(String(error)),
          expected: true,
          transient: false,
          data: { group },
        }),
      );
    }
  }

  private async fetchGroupPosts(group: VKGroupMonitorGroup): Promise<void> {
    let { offset, lastCheckedDate } = group;
    let hasMorePosts = true;

    while (hasMorePosts) {
      try {
        const posts = await vkApi.fetchPosts(
          this.vkAccessToken,
          this.clientId,
          group.id,
          offset,
          this.postsPerRequest,
        );

        if (posts.length === 0) {
          hasMorePosts = false;
          break;
        }

        for (const post of posts) {
          console.log(
            "post.date",
            new Date(post.date * 1000).toLocaleString(),
          );
          console.log(
            "lastCheckedDate",
            new Date(lastCheckedDate * 1000).toLocaleString(),
          );

          if (post.date <= lastCheckedDate) {
            hasMorePosts = false;
            break;
          }

          await this.processPost(post, group.id);
        }

        offset += posts.length;
      } catch (error) {
        this.emit(
          "error",
          createError({
            code: "VK_FETCH_GROUP_POSTS_ERROR",
            cause: error instanceof Error ? error : new Error(String(error)),
            expected: true,
            transient: false,
            data: { groupId: group.id, offset },
          }),
        );
        hasMorePosts = false;
      }
    }

    // Reset offset and update lastCheckedDate
    group.offset = 0;
    group.lastCheckedDate = Date.now() / 1000;

    await this.putGroup(group);
  }

  private async poll(): Promise<void> {
    for (const groupId of this.groupIds) {
      const group = await this.getGroup(groupId);
      if (group) {
        await this.fetchGroupPosts(group);
      }
    }

    this.pollTimeout = setTimeout(
      () => this.poll(),
      this.pollInterval,
    );
  }

  private async updateGroups(): Promise<void> {
    const missingGroupIds: number[] = [];

    for (const groupId of this.groupIds) {
      const group = await this.getGroup(groupId);
      if (!group) {
        missingGroupIds.push(groupId);
      }
    }

    if (missingGroupIds.length === 0) {
      return;
    }

    try {
      const fetchedGroups = await vkApi.fetchGroups(
        this.vkAccessToken,
        this.clientId,
        missingGroupIds,
      );

      for (const data of fetchedGroups) {
        const group = await this.getGroup(data.id);
        await this.putGroup({
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
        }),
      );

      logger.debug("updateGroups error", error);
    }
  }

  private async processPost(
    { id, text, date }: PostData,
    groupId: number,
  ): Promise<void> {
    logger.debug("processPost", { id, text, date, groupId });

    const storedPost = await this.getPost(id);
    if (storedPost) {
      this.emit("postAlreadyProcessed", storedPost);
      return;
    }

    this.emit("newPost", {
      id,
      text,
      date,
    });

    if (!this.gigachatAccessToken) {
      await this.updateGigachatAccessToken();
      if (!this.gigachatAccessToken) {
        throw createError({
          code: "GIGACHAT_API_ACCESS_TOKEN_ERROR",
          expected: true,
          transient: false,
        });
      }
    }

    const rewritten = await gigaChatApi.getGigaChatRewritePost(
      text,
      this.messages,
      this.clientId,
      this.gigaChatApiKey,
      this.gigachatAccessToken,
    );

    const post: VKGroupMonitorPost = {
      id,
      date,
      groupId,
      original: text,
      rewritten,
    };

    await this.putPost(post);
    this.emit("postProcessed", post);

    logger.debug("processPost response", post);
  }

  private async putPost(post: VKGroupMonitorPost): Promise<void> {
    logger.debug("putPost", post);

    try {
      await this.postsDb.put(post.id.toString(), post);
    } catch (error) {
      this.emit(
        "error",
        createError({
          code: "VK_MONITOR_LEVEL_PUT_POST_ERROR",
          cause: error instanceof Error ? error : new Error(String(error)),
          expected: true,
          transient: false,
          data: { post },
        }),
      );

      logger.debug("putPost error", error);
    }
  }
}
