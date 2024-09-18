import bridge from "@vkontakte/vk-bridge";
import dotenv from "dotenv";
import { Ollama } from "ollama";
import { Level } from "level";
import { EventEmitter } from "events";

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
  private accessToken: string;
  private pollInterval: number;
  private postsPerRequest: number;

  // OLLAMA client
  private ollama: Ollama;

  // LevelDB for posts
  private postsDb: Level<string, StoredPost>;

  // LevelDB for groups state
  private groupsState: Map<number, GroupState>;
  private groupsStateDb: Level<string, GroupState>;

  constructor() {
    super(); // Call EventEmitter constructor
    const groupIds = process.env.GROUP_IDS?.split(",").map(Number) || [];
    this.accessToken = process.env.VK_ACCESS_TOKEN || "";
    this.pollInterval = Number(process.env.POLL_INTERVAL) || 60000;
    this.postsPerRequest = Number(process.env.POSTS_PER_REQUEST) || 100;

    this.groupsState = new Map(
      groupIds.map((id) => [
        id,
        {
          lastCheckedDate: Math.floor(Date.now() / 1000),
          offset: 0,
        },
      ]),
    );

    if (!this.accessToken) {
      throw new Error(
        "VK_ACCESS_TOKEN is not set in the environment variables",
      );
    }

    if (groupIds.length === 0) {
      throw new Error(
        "GROUP_IDS is not set or invalid in the environment variables",
      );
    }

    // Initialize Ollama
    this.ollama = new Ollama({
      host: process.env.OLLAMA_HOST || "http://localhost:11434",
    });

    // Initialize LevelDB for posts
    this.postsDb = new Level<string, StoredPost>("./db", {
      valueEncoding: "json",
    });

    // Initialize LevelDB for state
    this.groupsStateDb = new Level<string, GroupState>("./state", {
      valueEncoding: "json",
    });
  }

  public async start(): Promise<void> {
    await this.restoreState();
    this.pollGroups();
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
        const response = await this.fetchPosts(groupId, group.offset);
        const posts: Post[] = response.items;

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
        hasMorePosts = false;
      }
    }

    // Reset offset after processing all posts
    group.offset = 0;
    await this.saveState(groupId, group.lastCheckedDate, group.offset);
  }

  private async fetchPosts(
    groupId: number,
    offset: number,
  ): Promise<{ items: Post[] }> {
    try {
      const response = await bridge.default.send("VKWebAppCallAPIMethod", {
        method: "wall.get",
        params: {
          owner_id: -groupId,
          count: this.postsPerRequest,
          offset: offset,
          access_token: this.accessToken,
          v: "5.131",
        },
      });
      return response.response;
    } catch (error) {
      throw new Error(`Failed to fetch posts: ${error}`);
    }
  }

  private async processNewPost(post: Post, groupId: number): Promise<void> {
    console.log("Original post:", post);

    try {
      const storedPost = await this.getStoredPost(post.id.toString());
      if (storedPost) {
        console.log("Post already processed:", storedPost);
        this.emit("postAlreadyProcessed", storedPost);
        return;
      }

      this.emit("newPost", post);

      const rewrittenText = await this.rewritePostWithOllama(post.text);
      console.log("Rewritten post:", rewrittenText);

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
      console.error("Error processing post:", error);
      this.emit(
        "error",
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  private async rewritePostWithOllama(text: string): Promise<string> {
    const prompt = process.env.OLLAMA_PROMPT ||
      `Rewrite the following social media post in a more engaging way, keeping the main message intact:\n\n${text}`;

    try {
      const response = await this.ollama.generate({
        model: process.env.OLLAMA_MODEL || "llama2",
        prompt: prompt,
      });

      return response.response;
    } catch (error) {
      throw new Error(`Failed to rewrite post with Ollama: ${error}`);
    }
  }

  private async getStoredPost(postId: string): Promise<StoredPost | undefined> {
    try {
      return await this.postsDb.get(postId);
    } catch (error) {
      if ((error as { code: string }).code === "LEVEL_NOT_FOUND") {
        return undefined;
      }
      throw error;
    }
  }

  private async storePost(
    postId: string,
    groupId: number,
    original: string,
    rewritten: string,
  ): Promise<void> {
    await this.postsDb.put(postId, { groupId, original, rewritten });
  }
}

// Usage example:
const groupMonitor = new VKGroupMonitor();

// Event listeners with type checking
groupMonitor.on("newPost", (post: Post) => {
  console.log("New post detected:", post.id);
});

groupMonitor.on("postProcessed", (processedPost: ProcessedPost) => {
  console.log("Post processed:", processedPost.id);
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
