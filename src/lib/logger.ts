import { createConsola } from "consola";

export const logger = createConsola({
  level: 10,
  defaults: {
    tag: "VKGroupMonitor",
  },
});
