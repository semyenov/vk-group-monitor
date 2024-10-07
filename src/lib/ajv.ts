import Ajv from "ajv";

const schema = {
  type: "object",
  properties: {
    title: { type: "string" },
    content: { type: "string" },
    key_points: { type: "array", items: { type: "string" } },
    practical_advice: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
    source_link: { type: "string" },
    visual_element: { type: "string" },
    poll_question: { type: "string" },
  },
  required: [
    "title",
    "content",
  ],
};

export type Post = {
  title: string;
  content: string;
  key_points: string[];
  practical_advice: string;
  hashtags: string[];
  source_link: string;
  visual_element?: string;
  poll_question?: string;
};

export const ajv = new Ajv();
export const validatePost = ajv.compile(schema);
