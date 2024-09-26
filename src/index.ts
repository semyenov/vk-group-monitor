import dotenv from "dotenv";
import { Level } from "level";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";

dotenv.config();

interface Post {
  id: number;
  date: number;
  text: string;
}

interface GroupState {
  lastCheckedDate: number;
  offset: number;
}

interface StoredPost {
  groupId: number;
  original: string;
  rewritten: string;
}

interface ProcessedPost {
  id: number;
  groupId: number;
  original: string;
  rewritten: string;
}

interface VKGroupMonitorEvents {
  newPost: (post: Post) => void;
  postProcessed: (processedPost: ProcessedPost) => void;
  postAlreadyProcessed: (storedPost: StoredPost) => void;
  error: (error: Error) => void;
}

class VKGroupMonitor extends EventEmitter {
  private vkAccessToken: string | null = null;
  private gigaChatAccessToken: string | null = null;

  private pollInterval: number;
  private postsPerRequest: number;

  // LevelDB for posts
  private postsDb: Level<string, StoredPost>;

  // LevelDB for groups state
  private groupsState: Map<number, GroupState>;
  private groupsStateDb: Level<string, GroupState>;

  constructor() {
    super(); // Call EventEmitter constructor
    const groupIds = process.env.GROUP_IDS?.split(",").map(Number) || [];
    this.vkAccessToken = process.env.VK_ACCESS_TOKEN || "";
    this.pollInterval = Number(process.env.POLL_INTERVAL) || 60000;
    this.postsPerRequest = Number(process.env.POSTS_PER_REQUEST) || 10;

    this.groupsState = new Map(
      groupIds.map((id) => [
        id,
        {
          lastCheckedDate: 0,
          offset: 0,
        },
      ]),
    );

    if (!this.vkAccessToken) {
      throw new Error(
        "VK_ACCESS_TOKEN is not set in the environment variables",
      );
    }

    if (groupIds.length === 0) {
      throw new Error(
        "GROUP_IDS is not set or invalid in the environment variables",
      );
    }

    // Initialize LevelDB for posts
    this.postsDb = new Level<string, StoredPost>("./db/posts", {
      valueEncoding: "json",
    });

    // Initialize LevelDB for state
    this.groupsStateDb = new Level<string, GroupState>("./db/state", {
      valueEncoding: "json",
    });
  }

  public async start(): Promise<void> {
    await this.restoreState();
    await this.getGigaChatAccessToken();
    this.pollGroups();
  }

  private async getGigaChatAccessToken(): Promise<string> {
    try {
      const response = await fetch("https://ngw.devices.sberbank.ru:9443/api/v2/oauth", {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'RqUID': randomUUID(),
          'Authorization': `Bearer ${process.env.GIGACHAT_API_KEY}`,
        },
        body: new URLSearchParams([
          ['scope', 'GIGACHAT_API_PERS'],
        ]),
      });

      const json = await response.json();
      this.gigaChatAccessToken = json["access_token"];

      return this.gigaChatAccessToken || "";
    } catch (error) {
      console.error("Error getting GigaChat access token:", error);
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private async restoreState(): Promise<void> {
    for (const [groupId, group] of this.groupsState) {
      try {
        const state = await this.groupsStateDb.get(`group_${groupId}`);
        group.lastCheckedDate = state.lastCheckedDate;
        group.offset = state.offset;
        console.log(
          `Restored state for group ${groupId}: last checked at ${new Date(
            group.lastCheckedDate * 1000,
          )}, offset: ${group.offset}`,
        );
      } catch (error) {
        if ((error as { code: string }).code !== "LEVEL_NOT_FOUND") {
          console.error(`Error restoring state for group ${groupId}:`, error);
          this.emit("error", error instanceof Error ? error : new Error(String(error)));
          throw error;
        }
      }
    }
  }

  private async saveState(
    groupId: number,
    lastCheckedDate: number,
    offset: number,
  ): Promise<void> {
    try {
      await this.groupsStateDb.put(`group_${groupId}`, {
        lastCheckedDate,
        offset,
      });
    } catch (error) {
      console.error(`Error saving state for group ${groupId}:`, error);
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private async pollGroups(): Promise<void> {
    for (const [groupId, group] of this.groupsState) {
      await this.checkGroupPosts(groupId, group);
      await this.saveState(groupId, group.lastCheckedDate, group.offset);
    }

    setTimeout(() => this.pollGroups(), this.pollInterval);
  }

  private async checkGroupPosts(
    groupId: number,
    group: GroupState,
  ): Promise<void> {
    let hasMorePosts = true;

    while (hasMorePosts) {
      try {
        const posts = await this.fetchPosts(groupId, group.offset);

        if (posts.length === 0) {
          hasMorePosts = false;
          break;
        }

        for (const post of posts) {
          if (post.date > group.lastCheckedDate) {
            await this.processNewPost(post, groupId);
          } else {
            hasMorePosts = false;
            break;
          }
        }

        group.lastCheckedDate = Math.max(group.lastCheckedDate, posts[0].date);
        group.offset += this.postsPerRequest; // Update the offset
        await this.saveState(groupId, group.lastCheckedDate, group.offset);
      } catch (error) {
        console.error(`Error fetching posts for group ${groupId}:`, error);
        this.emit("error", error instanceof Error ? error : new Error(String(error)));
        hasMorePosts = false;
        throw error;
      }
    }

    // Reset offset after processing all posts
    group.offset = 0;
    await this.saveState(groupId, group.lastCheckedDate, group.offset);
  }

  private async fetchPosts(
    groupId: number,
    offset: number,
  ): Promise<Post[]> {
    try {
      const params = new URLSearchParams([
        ['owner_id', `-${groupId}`],
        ['count', this.postsPerRequest.toString()],
        ['offset', offset.toString()],
        ['access_token', this.vkAccessToken || ''],
        ['v', '5.131'],
      ]);
      const response = await fetch(`https://api.vk.com/method/wall.get?${params.toString()}`, {
        method: 'GET',
      });

      const json = await response.json();
      return json.response.items;
    } catch (error) {
      console.error(`Error fetching posts for group ${groupId}:`, error);
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private async processNewPost(post: Post, groupId: number): Promise<void> {
    try {
      const storedPost = await this.getStoredPost(post.id.toString());
      if (storedPost) {
        this.emit("postAlreadyProcessed", storedPost);
        return;
      }

      this.emit("newPost", post);

      const rewrittenText = await this.rewritePostWithGigaChat(post.text);

      await this.storePost(
        post.id.toString(),
        groupId,
        post.text,
        rewrittenText,
      );

      this.emit("postProcessed", {
        id: post.id,
        groupId,
        original: post.text,
        rewritten: rewrittenText,
      });
    } catch (error) {
      console.error(`Error processing post ${post.id} for group ${groupId}:`, error);
      this.emit(
        "error",
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  private async getStoredPost(postId: string): Promise<StoredPost | undefined> {
    try {
      return await this.postsDb.get(postId);
    } catch (error) {
      if ((error as { code: string }).code === "LEVEL_NOT_FOUND") {
        return undefined;
      }
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private async storePost(
    postId: string,
    groupId: number,
    original: string,
    rewritten: string,
  ): Promise<void> {
    try {
      await this.postsDb.put(postId, { groupId, original, rewritten });
    } catch (error) {
      console.error(`Error storing post ${postId} for group ${groupId}:`, error);
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private async rewritePostWithGigaChat(text: string): Promise<string> {
    try {
      const response = await fetch("https://gigachat.devices.sberbank.ru/api/v1/chat/completions", {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': 'b6874da0-bf06-410b-a150-fd5f9164a0b2',
          'X-Request-Id': randomUUID(),
          'X-Session-Id': randomUUID(),
          'Authorization': `Bearer ${this.gigaChatAccessToken}`,
        },
        body: JSON.stringify({
          model: "GigaChat",
          stream: false,
          update_interval: 0,
          messages: [
            {
              role: "system",
              content: "Пиши текст в стиле, характерном для юристов, адвокатов, судей и прочих профессий, связанных с законодательством.",
            },
            {
              role: "user",
              content: 'Перепиши текст новости в юморный стиль.',
            },
            {
              role: "user",
              content: text,
            },
          ],
        }),
      });

      const json = await response.json();
      return json.choices[0].message.content;
    } catch (error) {
      console.error("Error rewriting post with GigaChat:", error);
      this.emit("error", error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }
}

// Usage example:
const groupMonitor = new VKGroupMonitor();

// Event listeners with type checking
groupMonitor.on("newPost", (post: Post) => {
  console.log("New post detected:", post.text);
});

groupMonitor.on("postProcessed", (processedPost: ProcessedPost) => {
  console.log("Post processed:", processedPost.rewritten);
});

groupMonitor.on("postAlreadyProcessed", (storedPost: StoredPost) => {
  console.log("Post already processed:", storedPost.groupId);
});

groupMonitor.on("error", (error: Error) => {
  console.error("An error occurred:", error);
});

groupMonitor
  .start()
  .catch((error) => console.error("Error starting VKGroupMonitor:", error));

// Graceful shutdown handler
process.on("SIGINT", async () => {
  console.log("Gracefully shutting down...");
  // Perform any cleanup or final state saving here if needed
  process.exit(0);
});
