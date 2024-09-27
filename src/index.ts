import { Level } from "level";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import https from "https";
import fetch from "node-fetch";
import ModuleError from "module-error";
import { createConsola } from "consola";

const logger = createConsola({ defaults: { tag: "VKGroupMonitor" } });

export interface VKGroupMonitorConfig extends Record<string, unknown> {
  vkAccessToken: string;
  gigachatApiKey: string;

  dbDir: string;
  pollInterval: number;
  postsPerRequest: number;

  auth: {
    username: string;
    password: string;
    sessionSecret: string;
  };

  groupIds: number[];
  messages: {
    role: string;
    content: string;
  }[];
}

const httpsAgent = new https.Agent({
  ca: [
    Buffer.from(`-----BEGIN CERTIFICATE-----
MIIFwjCCA6qgAwIBAgICEAAwDQYJKoZIhvcNAQELBQAwcDELMAkGA1UEBhMCUlUx
PzA9BgNVBAoMNlRoZSBNaW5pc3RyeSBvZiBEaWdpdGFsIERldmVsb3BtZW50IGFu
ZCBDb21tdW5pY2F0aW9uczEgMB4GA1UEAwwXUnVzc2lhbiBUcnVzdGVkIFJvb3Qg
Q0EwHhcNMjIwMzAxMjEwNDE1WhcNMzIwMjI3MjEwNDE1WjBwMQswCQYDVQQGEwJS
VTE/MD0GA1UECgw2VGhlIE1pbmlzdHJ5IG9mIERpZ2l0YWwgRGV2ZWxvcG1lbnQg
YW5kIENvbW11bmljYXRpb25zMSAwHgYDVQQDDBdSdXNzaWFuIFRydXN0ZWQgUm9v
dCBDQTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAMfFOZ8pUAL3+r2n
qqE0Zp52selXsKGFYoG0GM5bwz1bSFtCt+AZQMhkWQheI3poZAToYJu69pHLKS6Q
XBiwBC1cvzYmUYKMYZC7jE5YhEU2bSL0mX7NaMxMDmH2/NwuOVRj8OImVa5s1F4U
zn4Kv3PFlDBjjSjXKVY9kmjUBsXQrIHeaqmUIsPIlNWUnimXS0I0abExqkbdrXbX
YwCOXhOO2pDUx3ckmJlCMUGacUTnylyQW2VsJIyIGA8V0xzdaeUXg0VZ6ZmNUr5Y
Ber/EAOLPb8NYpsAhJe2mXjMB/J9HNsoFMBFJ0lLOT/+dQvjbdRZoOT8eqJpWnVD
U+QL/qEZnz57N88OWM3rabJkRNdU/Z7x5SFIM9FrqtN8xewsiBWBI0K6XFuOBOTD
4V08o4TzJ8+Ccq5XlCUW2L48pZNCYuBDfBh7FxkB7qDgGDiaftEkZZfApRg2E+M9
G8wkNKTPLDc4wH0FDTijhgxR3Y4PiS1HL2Zhw7bD3CbslmEGgfnnZojNkJtcLeBH
BLa52/dSwNU4WWLubaYSiAmA9IUMX1/RpfpxOxd4Ykmhz97oFbUaDJFipIggx5sX
ePAlkTdWnv+RWBxlJwMQ25oEHmRguNYf4Zr/Rxr9cS93Y+mdXIZaBEE0KS2iLRqa
OiWBki9IMQU4phqPOBAaG7A+eP8PAgMBAAGjZjBkMB0GA1UdDgQWBBTh0YHlzlpf
BKrS6badZrHF+qwshzAfBgNVHSMEGDAWgBTh0YHlzlpfBKrS6badZrHF+qwshzAS
BgNVHRMBAf8ECDAGAQH/AgEEMA4GA1UdDwEB/wQEAwIBhjANBgkqhkiG9w0BAQsF
AAOCAgEAALIY1wkilt/urfEVM5vKzr6utOeDWCUczmWX/RX4ljpRdgF+5fAIS4vH
tmXkqpSCOVeWUrJV9QvZn6L227ZwuE15cWi8DCDal3Ue90WgAJJZMfTshN4OI8cq
W9E4EG9wglbEtMnObHlms8F3CHmrw3k6KmUkWGoa+/ENmcVl68u/cMRl1JbW2bM+
/3A+SAg2c6iPDlehczKx2oa95QW0SkPPWGuNA/CE8CpyANIhu9XFrj3RQ3EqeRcS
AQQod1RNuHpfETLU/A2gMmvn/w/sx7TB3W5BPs6rprOA37tutPq9u6FTZOcG1Oqj
C/B7yTqgI7rbyvox7DEXoX7rIiEqyNNUguTk/u3SZ4VXE2kmxdmSh3TQvybfbnXV
4JbCZVaqiZraqc7oZMnRoWrXRG3ztbnbes/9qhRGI7PqXqeKJBztxRTEVj8ONs1d
WN5szTwaPIvhkhO3CO5ErU2rVdUr89wKpNXbBODFKRtgxUT70YpmJ46VVaqdAhOZ
D9EUUn4YaeLaS8AjSF/h7UkjOibNc4qVDiPP+rkehFWM66PVnP1Msh93tc+taIfC
EYVMxjh8zNbFuoc7fzvvrFILLe7ifvEIUqSVIC/AzplM/Jxw7buXFeGP1qVCBEHq
391d/9RAfaZ12zkwFsl+IKwE/OZxW8AHa9i1p4GO0YSNuczzEm4=
-----END CERTIFICATE-----`),
    Buffer.from(`-----BEGIN CERTIFICATE-----
MIIHQjCCBSqgAwIBAgICEAIwDQYJKoZIhvcNAQELBQAwcDELMAkGA1UEBhMCUlUx
PzA9BgNVBAoMNlRoZSBNaW5pc3RyeSBvZiBEaWdpdGFsIERldmVsb3BtZW50IGFu
ZCBDb21tdW5pY2F0aW9uczEgMB4GA1UEAwwXUnVzc2lhbiBUcnVzdGVkIFJvb3Qg
Q0EwHhcNMjIwMzAyMTEyNTE5WhcNMjcwMzA2MTEyNTE5WjBvMQswCQYDVQQGEwJS
VTE/MD0GA1UECgw2VGhlIE1pbmlzdHJ5IG9mIERpZ2l0YWwgRGV2ZWxvcG1lbnQg
YW5kIENvbW11bmljYXRpb25zMR8wHQYDVQQDDBZSdXNzaWFuIFRydXN0ZWQgU3Vi
IENBMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA9YPqBKOk19NFymrE
wehzrhBEgT2atLezpduB24mQ7CiOa/HVpFCDRZzdxqlh8drku408/tTmWzlNH/br
HuQhZ/miWKOf35lpKzjyBd6TPM23uAfJvEOQ2/dnKGGJbsUo1/udKSvxQwVHpVv3
S80OlluKfhWPDEXQpgyFqIzPoxIQTLZ0deirZwMVHarZ5u8HqHetRuAtmO2ZDGQn
vVOJYAjls+Hiueq7Lj7Oce7CQsTwVZeP+XQx28PAaEZ3y6sQEt6rL06ddpSdoTMp
BnCqTbxW+eWMyjkIn6t9GBtUV45yB1EkHNnj2Ex4GwCiN9T84QQjKSr+8f0psGrZ
vPbCbQAwNFJjisLixnjlGPLKa5vOmNwIh/LAyUW5DjpkCx004LPDuqPpFsKXNKpa
L2Dm6uc0x4Jo5m+gUTVORB6hOSzWnWDj2GWfomLzzyjG81DRGFBpco/O93zecsIN
3SL2Ysjpq1zdoS01CMYxie//9zWvYwzI25/OZigtnpCIrcd2j1Y6dMUFQAzAtHE+
qsXflSL8HIS+IJEFIQobLlYhHkoE3avgNx5jlu+OLYe0dF0Ykx1PGNjbwqvTX37R
Cn32NMjlotW2QcGEZhDKj+3urZizp5xdTPZitA+aEjZM/Ni71VOdiOP0igbw6asZ
2fxdozZ1TnSSYNYvNATwthNmZysCAwEAAaOCAeUwggHhMBIGA1UdEwEB/wQIMAYB
Af8CAQAwDgYDVR0PAQH/BAQDAgGGMB0GA1UdDgQWBBTR4XENCy2BTm6KSo9MI7NM
XqtpCzAfBgNVHSMEGDAWgBTh0YHlzlpfBKrS6badZrHF+qwshzCBxwYIKwYBBQUH
AQEEgbowgbcwOwYIKwYBBQUHMAKGL2h0dHA6Ly9yb3N0ZWxlY29tLnJ1L2NkcC9y
b290Y2Ffc3NsX3JzYTIwMjIuY3J0MDsGCCsGAQUFBzAChi9odHRwOi8vY29tcGFu
eS5ydC5ydS9jZHAvcm9vdGNhX3NzbF9yc2EyMDIyLmNydDA7BggrBgEFBQcwAoYv
aHR0cDovL3JlZXN0ci1wa2kucnUvY2RwL3Jvb3RjYV9zc2xfcnNhMjAyMi5jcnQw
gbAGA1UdHwSBqDCBpTA1oDOgMYYvaHR0cDovL3Jvc3RlbGVjb20ucnUvY2RwL3Jv
b3RjYV9zc2xfcnNhMjAyMi5jcmwwNaAzoDGGL2h0dHA6Ly9jb21wYW55LnJ0LnJ1
L2NkcC9yb290Y2Ffc3NsX3JzYTIwMjIuY3JsMDWgM6Axhi9odHRwOi8vcmVlc3Ry
LXBraS5ydS9jZHAvcm9vdGNhX3NzbF9yc2EyMDIyLmNybDANBgkqhkiG9w0BAQsF
AAOCAgEARBVzZls79AdiSCpar15dA5Hr/rrT4WbrOfzlpI+xrLeRPrUG6eUWIW4v
Sui1yx3iqGLCjPcKb+HOTwoRMbI6ytP/ndp3TlYua2advYBEhSvjs+4vDZNwXr/D
anbwIWdurZmViQRBDFebpkvnIvru/RpWud/5r624Wp8voZMRtj/cm6aI9LtvBfT9
cfzhOaexI/99c14dyiuk1+6QhdwKaCRTc1mdfNQmnfWNRbfWhWBlK3h4GGE9JK33
Gk8ZS8DMrkdAh0xby4xAQ/mSWAfWrBmfzlOqGyoB1U47WTOeqNbWkkoAP2ys94+s
Jg4NTkiDVtXRF6nr6fYi0bSOvOFg0IQrMXO2Y8gyg9ARdPJwKtvWX8VPADCYMiWH
h4n8bZokIrImVKLDQKHY4jCsND2HHdJfnrdL2YJw1qFskNO4cSNmZydw0Wkgjv9k
F+KxqrDKlB8MZu2Hclph6v/CZ0fQ9YuE8/lsHZ0Qc2HyiSMnvjgK5fDc3TD4fa8F
E8gMNurM+kV8PT8LNIM+4Zs+LKEV8nqRWBaxkIVJGekkVKO8xDBOG/aN62AZKHOe
GcyIdu7yNMMRihGVZCYr8rYiJoKiOzDqOkPkLOPdhtVlgnhowzHDxMHND/E2WA5p
ZHuNM/m0TXt2wTTPL7JH2YC0gPz/BvvSzjksgzU5rLbRyUKQkgU=
-----END CERTIFICATE-----`),
  ],
});

interface Post {
  id: number;
  date: number;
  text: string;
}

interface VKGroupMonitorGroup {
  id: number;
  lastCheckedDate: number;
  offset: number;
  name: string;
  screen_name: string;
  is_closed: number;
  type: string;
  is_admin: number;
  is_member: number;
  is_advertiser: number;
  photo_50: string;
  photo_100: string;
  photo_200: string;
}

interface VKGroupMonitorPost {
  id: number;
  date: number;
  groupId: number;
  original: string;
  rewritten: string | null;
}

interface VKGroupMonitorEvents {
  newPost: [post: Post];
  postProcessed: [processedPost: VKGroupMonitorPost];
  postAlreadyProcessed: [storedPost: VKGroupMonitorPost];
  error: [error: ModuleError];
}

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
      throw new ModuleError(
        "DB_DIR is not set in configuration (required)",
        {
          code: "VK_MONITOR_CONFIG_DB_DIR_NOT_SET_ERROR",
          cause: new Error(
            "DB_DIR is not set in configuration (required)",
          ),
        },
      );
    }

    if (!config.vkAccessToken) {
      throw new ModuleError(
        "VK_ACCESS_TOKEN is not set in configuration (required)",
        {
          code: "VK_MONITOR_CONFIG_VK_ACCESS_TOKEN_NOT_SET_ERROR",
          cause: new Error(
            "VK_ACCESS_TOKEN is not set in configuration (required)",
          ),
        },
      );
    }

    if (!config.gigachatApiKey) {
      throw new ModuleError(
        "GIGACHAT_API_KEY is not set in configuration (required)",
        {
          code: "VK_MONITOR_CONFIG_GIGACHAT_API_KEY_NOT_SET_ERROR",
          cause: new Error(
            "GIGACHAT_API_KEY is not set in configuration (required)",
          ),
        },
      );
    }

    if (config.groupIds.length === 0) {
      throw new ModuleError(
        "GROUP_IDS is not set or invalid in configuration (required)",
        {
          code: "VK_MONITOR_CONFIG_GROUP_IDS_NOT_SET_ERROR",
          cause: new Error(
            "GROUP_IDS is not set or invalid in configuration (required)",
          ),
        },
      );
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
          id,
          offset: 0,
          count: config.postsPerRequest,
          lastCheckedDate: Date.now() / 1000 - 1000 * 60 * 60 * 24,
        },
      ]),
    );

    // Initialize LevelDB
    this.postsDb = new Level<string, VKGroupMonitorPost>(
      config.dbDir + "/posts",
      {
        valueEncoding: "json",
        errorIfExists: false,
        createIfMissing: true,
      },
    );

    this.groupsDb = new Level<string, VKGroupMonitorGroup>(
      config.dbDir + "/groups",
      {
        valueEncoding: "json",
        errorIfExists: false,
        createIfMissing: true,
      },
    );
  }

  public async start(): Promise<void> {
    logger.debug("start");

    await this.updateGigachatAccessToken();
    await this.updateGroups();

    await this.poll();
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

    return posts
      .sort((a, b) => b.date - a.date);
  }

  public async getPost(postId: number): Promise<VKGroupMonitorPost | null> {
    logger.debug("getPost", postId);

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

        const message = `Error: getting post ${postId}`;
        this.emit(
          "error",
          new ModuleError(message, {
            code: "VK_MONITOR_LEVEL_GET_POST_ERROR",
            cause: error,
          }),
        );
      }

      return null;
    }
  }

  public async getGroup(groupId: number): Promise<VKGroupMonitorGroup | null> {
    logger.debug("getGroup", groupId);

    try {
      const state = await this.groupsDb.get(groupId.toString());
      if (!state) {
        return null;
      }

      return state;
    } catch (error) {
      if (error instanceof Error && "code" in error) {
        if (error.code === "LEVEL_NOT_FOUND") {
          return null;
        }

        const message = `Error: getting group ${groupId}`;
        this.emit(
          "error",
          new ModuleError(message, {
            code: "VK_MONITOR_LEVEL_GET_GROUP_ERROR",
            cause: error,
          }),
        );
      }

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

    return groups
      .sort((a, b) => b.lastCheckedDate - a.lastCheckedDate);
  }

  private async updateGigachatAccessToken(): Promise<string | null> {
    logger.debug("updateGigachatAccessToken");

    try {
      const response = await fetch(
        "https://ngw.devices.sberbank.ru:9443/api/v2/oauth",
        {
          method: "POST",
          agent: httpsAgent,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": `Bearer ${this.gigaChatApiKey}`,
            "RqUID": randomUUID(),
          },
          body: new URLSearchParams([
            ["scope", "GIGACHAT_API_PERS"],
          ]),
        },
      );

      const json = await response.json() as { access_token: string };
      this.gigachatAccessToken = json["access_token"];

      logger.debug("updateGigachatAccessToken response", json);

      return this.gigachatAccessToken;
    } catch (error) {
      const message = `Error: getting GigaChat access token`;
      this.emit(
        "error",
        new ModuleError(message, {
          code: "VK_MONITOR_FETCH_GIGACHAT_ACCESS_TOKEN_ERROR",
          cause: error as Error,
        }),
      );

      logger.debug("updateGigachatAccessToken error", error);

      return null;
    }
  }

  private async putGroup(
    group: VKGroupMonitorGroup,
  ): Promise<void> {
    logger.debug("putGroup", group);

    try {
      await this.groupsDb.put(group.id.toString(), group);
    } catch (error) {
      const message = `Error: saving state for group ${group.id}`;
      this.emit(
        "error",
        new ModuleError(message, {
          code: "VK_MONITOR_LEVEL_PUT_GROUP_ERROR",
          cause: error as Error,
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

  private async fetchGroupPosts(
    group: VKGroupMonitorGroup,
  ): Promise<void> {
    logger.debug("fetchGroupPosts", group);

    let hasMorePosts = true;

    while (hasMorePosts) {
      const posts = await this.fetchPosts(
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
    }

    // Reset offset after processing all posts
    await this.putGroup({
      ...group,
      offset: 0,
    });
  }

  private async updateGroups(): Promise<void> {
    logger.debug("updateGroups");

    const groupIds: number[] = [];

    for (const groupId of this.state.keys()) {
      const group = await this.getGroup(groupId);
      if (group) {
        // restore group state
        this.state.set(
          groupId,
          {
            offset: group.offset,
            lastCheckedDate: group.lastCheckedDate,
          },
        );

        continue;
      }

      groupIds.push(groupId);
    }

    if (groupIds.length === 0) {
      return;
    }

    // fetch groups
    const params = new URLSearchParams([
      ["group_ids", groupIds.join(",")],
      ["fields", "links"],
      ["access_token", this.vkAccessToken],
      ["v", "5.131"],
    ]);

    try {
      const response = await fetch(
        `https://api.vk.com/method/groups.getById?${params.toString()}`,
        {
          method: "GET",
          headers: {
            "X-Client-Id": this.clientId,
            "X-Request-Id": randomUUID(),
            "Content-Type": "application/json",
          },
        },
      );

      const json = await response.json() as {
        response?: Omit<VKGroupMonitorGroup, "lastCheckedDate" | "offset">[];
      };

      logger.debug("updateGroups response", json);

      for (const data of json.response || []) {
        const group = await this.getGroup(data.id);
        await this.putGroup({
          ...data,
          lastCheckedDate: group?.lastCheckedDate ||
            Date.now() / 1000 - 1000 * 60 * 60 * 24,
          offset: group?.offset || 0,
        });
      }
    } catch (error) {
      const message = `Error: fetching groups`;
      this.emit(
        "error",
        new ModuleError(message, {
          code: "VK_MONITOR_FETCH_GROUPS_ERROR",
          cause: error as Error,
        }),
      );

      logger.debug("updateGroups error", error);
    }
  }

  private async fetchPosts(
    groupId: number,
    offset: number,
    count: number,
  ): Promise<Post[]> {
    logger.debug("fetchPosts", { groupId, offset, count });

    const posts: Post[] = [];
    const params = new URLSearchParams([
      ["owner_id", "-" + groupId.toString()],
      ["count", count.toString()],
      ["offset", offset.toString()],
      ["access_token", this.vkAccessToken || ""],
      ["v", "5.131"],
    ]);

    try {
      const response = await fetch(
        `https://api.vk.com/method/wall.get?${params.toString()}`,
        {
          method: "GET",
          headers: {
            "X-Client-Id": this.clientId,
            "X-Request-Id": randomUUID(),
            "Content-Type": "application/json",
          },
        },
      );

      const json = await response.json() as {
        response?: { items: Post[] };
      };

      logger.debug("fetchPosts response", json);

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
      const message = `Error: fetching posts for group ${groupId}`;
      this.emit(
        "error",
        new ModuleError(message, {
          code: "VK_MONITOR_FETCH_POSTS_ERROR",
          cause: error as Error,
        }),
      );

      logger.debug("fetchPosts error", error);

      return [];
    }
  }

  private async processPost(
    { id, text, date }: Post,
    groupId: number,
  ): Promise<void> {
    logger.debug("processPost", { id, text, date, groupId });

    const storedPost = await this.getPost(id);
    if (storedPost && storedPost.rewritten !== null) {
      this.emit("postAlreadyProcessed", storedPost);
      return;
    }

    this.emit("newPost", {
      id,
      text,
      date,
    });

    const rewritten = await this.getGigaChatRewritePost(text);
    const post: VKGroupMonitorPost = {
      id,
      date,
      groupId,
      original: text,
      rewritten,
    };

    await this.putPost(post);
    this.emit("postProcessed", post);
  }

  private async putPost(
    post: VKGroupMonitorPost,
  ): Promise<void> {
    logger.debug("putPost", post);

    try {
      await this.postsDb.put(post.id.toString(), post);
    } catch (error) {
      const message =
        `Error: storing post ${post.id} for group ${post.groupId}`;
      this.emit(
        "error",
        new ModuleError(message, {
          code: "VK_MONITOR_LEVEL_PUT_POST_ERROR",
          cause: error as Error,
        }),
      );

      logger.debug("putPost error", error);
    }
  }

  private async getGigaChatTokensCount(
    text: string,
  ): Promise<{
    index: number;
    text: string;
    tokens: number;
    characters: number;
  }[]> {
    logger.debug("getGigaChatTokensCount", text);

    const input: {
      index: number;
      text: string;
      characters: number;
      tokens: number;
    }[] = text
      .split("\n\n")
      .map((line) => line.trim())
      .filter((line) => line && line.length > 0)
      .map((line, index) => ({
        index,
        text: line,
        characters: line.length,
        tokens: -1,
      }));

    const body = JSON.stringify({
      model: "GigaChat",
      input: input.map((item) => item.text),
    });

    try {
      const response = await fetch(
        "https://gigachat.devices.sberbank.ru/api/v1/tokens/count",
        {
          method: "POST",
          agent: httpsAgent,
          headers: {
            "X-Client-Id": this.clientId,
            "X-Request-Id": randomUUID(),
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.gigachatAccessToken}`,
          },
          body,
        },
      );

      logger.debug("getGigaChatTokensCount response", response);

      const json = await response.json() as {
        object: string;
        characters: number;
        tokens: number;
      }[];

      for (const index in json) {
        const data = json[index];
        input[index].tokens = data.tokens;
      }

      return input
        .filter((item) => item.tokens > 0);
    } catch (error) {
      const message = `Error: getting GigaChat tokens count`;
      this.emit(
        "error",
        new ModuleError(message, {
          code: "VK_MONITOR_FETCH_GIGACHAT_TOKENS_COUNT_ERROR",
          cause: error as Error,
        }),
      );

      logger.debug("getGigaChatTokensCount error", error);

      return [];
    }
  }

  private async getGigaChatRewritePost(text: string): Promise<string | null> {
    logger.debug("getGigaChatRewritePost", text);

    const tokens = await this.getGigaChatTokensCount(text);
    const maxTokens = 120000;
    const maxCharacters = 1000000;

    let currentTokens = 0;
    let currentCharacters = 0;
    let currentText = "";

    for (const token of tokens) {
      if (
        currentTokens + token.tokens > maxTokens ||
        currentCharacters + token.characters > maxCharacters
      ) {
        break;
      }

      currentTokens += token.tokens;
      currentCharacters += token.characters;
      currentText += token.text;
    }

    const body = JSON.stringify({
      model: "GigaChat",
      stream: false,
      update_interval: 0,
      messages: [
        ...this.messages,
        {
          role: "user",
          content: currentText,
        },
      ],
    });

    try {
      const response = await fetch(
        "https://gigachat.devices.sberbank.ru/api/v1/chat/completions",
        {
          method: "POST",
          agent: httpsAgent,
          headers: {
            "X-Client-Id": this.clientId,
            "X-Request-Id": randomUUID(),
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.gigachatAccessToken}`,
          },
          body,
        },
      );

      const json = await response.json() as {
        choices: { message: { content: string } }[];
      };

      logger.debug("getGigaChatRewritePost", json);

      return json.choices
        .map((choice) => choice.message.content)
        .join();
    } catch (error) {
      if (
        error instanceof Response &&
        (error.status === 401 || error.status === 403)
      ) {
        await this.updateGigachatAccessToken();
        return this.getGigaChatRewritePost(text);
      }

      logger.debug("getGigaChatRewritePost", error);

      const message = `Error: rewriting post with GigaChat`;
      this.emit(
        "error",
        new ModuleError(message, {
          code: "VK_MONITOR_FETCH_GIGACHAT_REWRITE_POST_ERROR",
          cause: error as Error,
        }),
      );

      return null;
    }
  }
}
