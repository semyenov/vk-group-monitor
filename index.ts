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

interface Group {
  id: number;
  lastCheckedDate: number;
  offset: number;
}

interface StoredPost {
  groupId: number;
  original: string;
  rewritten: string;
}

class VKGroupMonitor extends EventEmitter {
  private groups: Group[];
  private accessToken: string;
  private pollInterval: number;
  private postsPerRequest: number;
  private ollama: Ollama;
  private postsDb: Level<string, StoredPost>;
  private stateDb: Level<string, { lastCheckedDate: number; offset: number }>;

  constructor() {
    super(); // Call EventEmitter constructor
    const groupIds = process.env.GROUP_IDS?.split(",").map(Number) || [];
    this.accessToken = process.env.VK_ACCESS_TOKEN || "";
    this.pollInterval = Number(process.env.POLL_INTERVAL) || 60000;
    this.postsPerRequest = Number(process.env.POSTS_PER_REQUEST) || 100;

    this.groups = groupIds.map((id) => ({
      id,
      lastCheckedDate: Math.floor(Date.now() / 1000),
      offset: 0,
    }));

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
    this.stateDb = new Level<
      string,
      { lastCheckedDate: number; offset: number }
    >(
      "./state",
      { valueEncoding: "json" },
    );
  }

  public async start(): Promise<void> {
    await this.restoreState();
    this.pollGroups();
  }

  private async restoreState(): Promise<void> {
    for (const group of this.groups) {
      try {
        const state = await this.stateDb.get(`group_${group.id}`);
        group.lastCheckedDate = state.lastCheckedDate;
        group.offset = state.offset;
        console.log(
          `Restored state for group ${group.id}: last checked at ${new Date(
            group.lastCheckedDate * 1000,
          )}, offset: ${group.offset}`,
        );
      } catch (error) {
        if ((error as any).code !== "LEVEL_NOT_FOUND") {
          console.error(`Error restoring state for group ${group.id}:`, error);
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
      await this.stateDb.put(`group_${groupId}`, { lastCheckedDate, offset });
    } catch (error) {
      console.error(`Error saving state for group ${groupId}:`, error);
    }
  }

  private async pollGroups(): Promise<void> {
    for (const group of this.groups) {
      await this.checkGroupPosts(group);
      await this.saveState(group.id, group.lastCheckedDate, group.offset);
    }

    setTimeout(() => this.pollGroups(), this.pollInterval);
  }

  private async checkGroupPosts(group: Group): Promise<void> {
    let hasMorePosts = true;

    while (hasMorePosts) {
      try {
        const response = await this.fetchPosts(group.id, group.offset);
        const posts: Post[] = response.items;

        if (posts.length === 0) {
          hasMorePosts = false;
          break;
        }

        for (const post of posts) {
          if (post.date > group.lastCheckedDate) {
            await this.processNewPost(post, group.id);
          } else {
            hasMorePosts = false;
            break;
          }
        }

        group.lastCheckedDate = Math.max(group.lastCheckedDate, posts[0].date);
        group.offset += this.postsPerRequest; // Update the offset
        await this.saveState(group.id, group.lastCheckedDate, group.offset);
      } catch (error) {
        console.error(`Error fetching posts for group ${group.id}:`, error);
        hasMorePosts = false;
      }
    }

    // Reset offset after processing all posts
    group.offset = 0;
    await this.saveState(group.id, group.lastCheckedDate, group.offset);
  }

  private async fetchPosts(
    groupId: number,
    offset: number,
  ): Promise<{ items: Post[] }> {
    try {
      const response = await bridge.send("VKWebAppCallAPIMethod", {
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
      this.emit("error", error);
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
      if ((error as any).code === "LEVEL_NOT_FOUND") {
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

// Event listeners
groupMonitor.on("newPost", (post) => {
  console.log("New post detected:", post.id);
});

groupMonitor.on("postProcessed", (processedPost) => {
  console.log("Post processed:", processedPost.id);
});

groupMonitor.on("postAlreadyProcessed", (storedPost) => {
  console.log("Post already processed:", storedPost.groupId);
});

groupMonitor.on("error", (error) => {
  console.error("An error occurred:", error);
});

groupMonitor.start().catch((error) =>
  console.error("Error starting VKGroupMonitor:", error)
);

// Graceful shutdown handler
process.on("SIGINT", async () => {
  console.log("Gracefully shutting down...");
  // Perform any cleanup or final state saving here if needed
  process.exit(0);
});
