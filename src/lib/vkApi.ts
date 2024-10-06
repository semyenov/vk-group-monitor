import fetch from "node-fetch";
import { randomUUID } from "crypto";
import { PostData, VKGroupMonitorGroup, VKGroupMonitorPost } from "./types";
import { logger } from "./logger";

export async function fetchPosts(
  vkAccessToken: string,
  clientId: string,
  groupId: number,
  offset: number,
  count: number,
): Promise<VKGroupMonitorPost[]> {
  logger.debug(`Fetching posts for group ${groupId}`);

  const posts: VKGroupMonitorPost[] = [];
  const params = new URLSearchParams([
    ["owner_id", "-" + groupId.toString()],
    ["count", count.toString()],
    ["offset", offset.toString()],
    ["access_token", vkAccessToken],
    ["v", "5.131"],
  ]);

  try {
    const response = await fetch(
      `https://api.vk.com/method/wall.get?${params.toString()}`,
      {
        method: "GET",
        headers: [
          ["X-Client-Id", clientId],
          ["X-Request-Id", randomUUID()],
          ["Content-Type", "application/json"],
        ],
      },
    );

    const json = await response.json() as {
      response?: { items: PostData[] };
    };

    for (const post of json.response?.items || []) {
      if (post.text.length > 0) {
        posts.push({
          id: Number(post.id),
          date: Number(post.date),
          original: post.text.trim(),
          groupId: Number(post.from_id),
          rewritten: [],
        });
      }
    }

    return posts;
  } catch (error) {
    logger.error(`Error: fetching posts for group ${groupId}`, {
      error,
    });
    throw new Error(`Error: fetching posts for group ${groupId}`);
  }
}

export async function fetchGroups(
  vkAccessToken: string,
  clientId: string,
  groupIds: number[],
): Promise<Omit<VKGroupMonitorGroup, "lastCheckedDate" | "offset">[]> {
  const params = new URLSearchParams([
    ["group_ids", groupIds.join(",")],
    ["fields", "links"],
    ["access_token", vkAccessToken],
    ["v", "5.131"],
  ]);

  try {
    const response = await fetch(
      `https://api.vk.com/method/groups.getById?${params.toString()}`,
      {
        method: "GET",
        headers: [
          ["X-Client-Id", clientId],
          ["X-Request-Id", randomUUID()],
          ["Content-Type", "application/json"],
        ],
      },
    );

    const json = await response.json() as {
      response?: Omit<VKGroupMonitorGroup, "lastCheckedDate" | "offset">[];
    };

    logger.debug(`Fetched groups ${groupIds.join(", ")}`);

    return json.response || [];
  } catch (error) {
    logger.error(`Error: fetching groups ${groupIds.join(", ")}`, {
      error,
    });
    throw new Error(`Error: fetching groups ${groupIds.join(", ")}`);
  }
}
