import fetch from "node-fetch";
import { randomUUID } from "crypto";
import { PostData, VKGroupMonitorGroup } from "./types";
import { logger } from "./logger";

export async function fetchPosts(
  vkAccessToken: string,
  clientId: string,
  groupId: number,
  offset: number,
  count: number,
): Promise<PostData[]> {
  logger.debug(`Fetching posts for group ${groupId}`, {
    vkAccessToken,
    clientId,
    offset,
    count,
  });

  const posts: PostData[] = [];
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

    console.log(json);

    logger.debug(`Fetched posts for group ${groupId}`, {
      posts: json.response?.items,
    });

    for (const post of json.response?.items || []) {
      if (post.text.length > 0 && post.text.length < 10000) {
        posts.push({
          id: Number(post.id),
          date: Number(post.date),
          text: post.text.trim(),
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

    logger.debug(`Fetched groups ${groupIds.join(",")}`, {
      groups: json.response,
    });

    return json.response || [];
  } catch (error) {
    logger.error(`Error: fetching groups ${groupIds.join(",")}`, {
      error,
    });
    throw new Error(`Error: fetching groups ${groupIds.join(",")}`);
  }
}
