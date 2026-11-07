import { loadConfig } from "./config";
import { createLogger } from "./lib/logger";

export type Env = Record<string, unknown> & { AUDIOS?: R2Bucket };

export function handleRequest(request: Request): Response {
  const { pathname } = new URL(request.url);
  if (request.method === "GET" && pathname === "/health") {
    return new Response("ok", { status: 200 });
  }
  return new Response("not found", { status: 404 });
}

export default {
  async fetch(request: Request): Promise<Response> {
    return handleRequest(request);
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    // Cron diário: tarefas das próximas etapas. Por ora só valida a config.
    const logger = createLogger();
    try {
      loadConfig(env);
    } catch (e) {
      logger.log("error", "config_invalid", { message: (e as Error).message });
    }
  },
};
