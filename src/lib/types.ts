
import ModuleError from "module-error";

export interface VKGroupMonitorConfig extends Record<string, unknown> {
  vkAccessToken: string;
  gigachatApiKey: string;

  dbDir: string;
  publicDir: string;
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
  hash: string;
  type: string;
  inner_type: string;
  marked_as_ads: boolean;
  post_type: string;
  text: string;
  from_id: number;
  owner_id: number;
  donut: {
    is_donut: boolean;
  };
  views: {
    count: number;
  };
  reposts: {
    count: number;
  };
  likes: {
    can_like: boolean;
    count: number;
    user_likes: boolean;
  };
  attachments: (
    PhotoAttachment | 
    LinkAttachment
  )[];
}

export interface PhotoAttachment {
  type: "photo";
  photo: {
    id: number;
    album_id: number;
    date: number;
    owner_id: number;
    access_key: string;
    post_id: number;
    text: string;
    user_id: number;
    web_view_token: string;
    has_tags: boolean;
    orig_photo: {
      type: string;
      url: string;
      width: number;
      height: number;
    };
    sizes: {
      type: string;
      url: string;
      width: number;
      height: number;
    }[];
  };
}

export interface LinkAttachment {
  type: "link";
  link: {
    url: string;
    title: string;
    caption: string;
    description: string;
    photo: {
      id: number;
      album_id: number;
      owner_id: number;
      date: number;
      user_id: number;
      text: string;
      web_view_token: string;
      has_tags: boolean;
      sizes: {
        type: string;
        url: string;
        width: number;
        height: number;
      }[];
    };
  };
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
  rewritten: string[];
}

export interface VKGroupMonitorEvents {
  newPost: [post: PostData];
  postProcessed: [processedPost: VKGroupMonitorPost];
  postAlreadyProcessed: [storedPost: VKGroupMonitorPost];
  error: [error: ModuleError];
}
