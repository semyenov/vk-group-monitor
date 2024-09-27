
import ModuleError from "module-error";

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

export interface PostData {
  id: number;
  date: number;
  text: string;
}

export interface VKGroupMonitorGroup {
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

export interface VKGroupMonitorPost {
  id: number;
  date: number;
  groupId: number;
  original: string;
  rewritten: string | null;
}

export interface VKGroupMonitorEvents {
  newPost: [post: PostData];
  postProcessed: [processedPost: VKGroupMonitorPost];
  postAlreadyProcessed: [storedPost: VKGroupMonitorPost];
  error: [error: ModuleError];
}
