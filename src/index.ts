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

  private state: Map<
    number,
    Pick<VKGroupMonitorGroup, "lastCheckedDate" | "offset">
  >;

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
        data: {},
      });
    }

    if (!config.vkAccessToken) {
      throw createError({
        code: "VK_ACCESS_TOKEN_NOT_SET_ERROR",
        expected: true,
        transient: false,
        data: {},
      });
    }

    if (!config.gigachatApiKey) {
      throw createError({
        code: "GIGACHAT_API_KEY_NOT_SET_ERROR",
        expected: true,
        transient: false,
        data: {},
      });
    }

    if (config.groupIds.length === 0) {
      throw createError({
        code: "GROUP_IDS_NOT_SET_ERROR",
        expected: true,
        transient: false,
        data: {},
      });
    }

    const groupIds = config.groupIds;

    this.vkAccessToken = config.vkAccessToken;
    this.gigaChatApiKey = config.gigachatApiKey;

    this.pollInterval = config.pollInterval;
    this.postsPerRequest = config.postsPerRequest;
    this.messages = config.messages;

    // Set initial state
    this.state = new Map(
      groupIds.map((id) => [
        id,
        {
          lastCheckedDate: Date.now() / 1000 - 1000 * 60 * 60 * 24,
          offset: 0,
        },
      ]),
    );

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
    logger.debug("start");

    await this.updateGigachatAccessToken();
    await this.updateGroups();

    this.poll();
  }

  public stop(): void {
    logger.debug("stop");

    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
    }
  }

  public async getPosts(): Promise<VKGroupMonitorPost[]> {
    logger.debug("getPosts");

    const posts: VKGroupMonitorPost[] = [];
    for await (const key of this.postsDb.keys()) {
      const post = await this.postsDb.get(key);
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
      const post = await this.postsDb.get(postId.toString());
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

  public async getGroup(groupId: number): Promise<VKGroupMonitorGroup | null> {
    logger.debug("getGroup", groupId);

    try {
      const group = await this.groupsDb.get(groupId.toString());
      if (!group) {
        return null;
      }

      logger.debug("getGroup response", group);

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
    for (const groupId of this.state.keys()) {
      const group = await this.getGroup(groupId);
      if (group) {
        groups.push(group);
      }
    }

    logger.debug("getGroups response", groups);

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

      logger.debug("updateGigachatAccessToken error", error);

      return null;
    }
  }

  private async putGroup(group: VKGroupMonitorGroup): Promise<void> {
    logger.debug("putGroup", group);

    try {
      await this.groupsDb.put(group.id.toString(), group);

      logger.debug("putGroup response", group);
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

      logger.debug("putGroup error", error);
    }
  }

  private async poll(): Promise<void> {
    logger.debug("poll");

    for (const groupId of this.state.keys()) {
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

  private async fetchGroupPosts(group: VKGroupMonitorGroup): Promise<void> {
    logger.debug("fetchGroupPosts", group);

    let hasMorePosts = true;
    while (hasMorePosts) {
      logger.debug("fetchGroupPosts loop", {
        groupId: group.id,
        offset: group.offset,
      });
      try {
        const posts = await vkApi.fetchPosts(
          this.vkAccessToken,
          this.clientId,
          group.id,
          group.offset,
          this.postsPerRequest,
        );

        if (posts.length === 0) {
          hasMorePosts = false;
          break;
        }

        for (const post of posts) {
          if (post.date > group.lastCheckedDate) {
            await this.processPost(post, group.id);
          } else {
            hasMorePosts = false;
            break;
          }
        }

        await this.putGroup({
          ...group,
          offset: group.offset + posts.length,
          lastCheckedDate: Math.max(
            group.lastCheckedDate,
            posts[0]?.date || 0,
          ),
        });
      } catch (error) {
        logger.error("fetchGroupPosts error", error);

        this.emit(
          "error",
          createError({
            code: "VK_FETCH_GROUP_POSTS_ERROR",
            cause: error instanceof Error ? error : new Error(String(error)),
            expected: true,
            transient: false,
            data: { groupId: group.id },
          }),
        );
      }
    }

    // Reset offset after processing all posts
    await this.putGroup({
      ...group,
      offset: 0,
    });

    logger.debug("fetchGroupPosts reset offset", { groupId: group.id });
  }

  private async updateGroups(): Promise<void> {
    logger.debug("updateGroups");

    const groupIds: number[] = [];

    for (const groupId of this.state.keys()) {
      const group = await this.getGroup(groupId);
      if (group) {
        // Restore group state
        this.state.set(groupId, {
          lastCheckedDate: group.lastCheckedDate,
          offset: group.offset,
        });

        continue;
      }

      groupIds.push(groupId);
    }

    if (groupIds.length === 0) {
      return;
    }

    // Fetch groups
    try {
      const fetchedGroups = await vkApi.fetchGroups(
        this.vkAccessToken,
        this.clientId,
        groupIds,
      );

      for (const data of fetchedGroups) {
        const group = await this.getGroup(data.id);
        await this.putGroup({
          ...data,
          lastCheckedDate: group?.lastCheckedDate ||
            Date.now() / 1000 - 1000 * 60 * 60 * 24,
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

  private async processPost(
    { id, text, date }: PostData,
    groupId: number,
  ): Promise<void> {
    logger.debug("processPost", { id, text, date, groupId });

    const storedPost = await this.getPost(id);
    if (storedPost && storedPost.rewritten !== null) {
      this.emit("postAlreadyProcessed", storedPost);
      return;
    }

    this.emit("newPost", { id, text, date });

    if (!this.gigachatAccessToken) {
      await this.updateGigachatAccessToken();
      if (!this.gigachatAccessToken) {
        throw createError({
          code: "GIGACHAT_API_ACCESS_TOKEN_ERROR",
          expected: true,
          transient: false,
          data: {},
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
