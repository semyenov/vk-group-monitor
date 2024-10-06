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
      const original = post.text.trim();
      if (post.text.length > 0) {
        const newPost: VKGroupMonitorPost = {
          groupId,
          original,
          rewritten: [],
          id: Number(post.id),
          date: Number(post.date),
          viewsCount: Number(post.views?.count),
          repostsCount: Number(post.reposts?.count),
          likesCount: Number(post.likes?.count),
          attachments: {
            links: [],
            photos: [],
          },
        };
        for (const attachment of post.attachments) {
          if (attachment.type === "photo") {
            console.log(
              "photo attachment",
              JSON.stringify(attachment, null, 2),
            );
            const photo = attachment.photo;
            const photoUrl = photo.sizes[photo.sizes.length - 1].url;
            const photoWidth = photo.sizes[photo.sizes.length - 1].width;
            const photoHeight = photo.sizes[photo.sizes.length - 1].height;
            const photoText = photo.text;
            newPost.attachments.photos.push({
              id: photo.id,
              url: photoUrl,
              width: photoWidth,
              height: photoHeight,
              text: photoText,
            });
          }

          if (attachment.type === "link") {
            const link = attachment.link;
            newPost.attachments.links.push({
              url: link.url,
              title: link.title,
              caption: link.caption,
              description: link.description,
            });
          }
        }

        posts.push(newPost);
      }
    }

    console.log("Posts", posts.length, posts);

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
