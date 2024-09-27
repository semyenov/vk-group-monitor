import { createConsola } from "consola";

export const logger = createConsola({
  level: 30,
  defaults: {
    tag: "VKGroupMonitor"
  }
});
