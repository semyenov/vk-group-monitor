import { createConsola } from "consola";

export const logger = createConsola({
  level: 5,
  defaults: {
    tag: "VKGroupMonitor",
  },
});
