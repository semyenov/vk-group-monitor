import { createConsola } from "consola";

export const logger = createConsola({
  level: 5,
  defaults: {
    tag: "VKGroupMonitor",
    additional: [
      "data",
      "error",
      "code",
      "expected",
      "transient",
    ],
  },
});
