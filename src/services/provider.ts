// Cache em memória (TTL) do conteúdo vindo do banco, com fallback no código se o banco falhar.
import type { Logger } from "../lib/logger";
import {
  DEFAULT_SERVICES, fallbackContent, makeContent, prepareServices, type Content, type ContentSource,
} from "./content";

export class ContentProvider {
  private snapshot: { at: number; content: Content } | null = null;

  constructor(
    private readonly source: ContentSource,
    private readonly logger: Logger,
    private readonly ttlMs = 60_000,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  async load(): Promise<Content> {
    const now = this.nowMs();
    if (this.snapshot && now - this.snapshot.at < this.ttlMs) return this.snapshot.content;
    try {
      const [rows, canned] = await Promise.all([this.source.listActiveServices(), this.source.listCannedResponses()]);
      const services = prepareServices(rows, this.logger);
      const content = makeContent(services.length > 0 ? services : DEFAULT_SERVICES, canned, this.logger);
      this.snapshot = { at: now, content };
      return content;
    } catch {
      // Banco fora: usa o último conteúdo conhecido (ou o do código) e tenta de novo só depois do TTL.
      this.logger.log("warn", "content_load_failed", {});
      const content = this.snapshot?.content ?? fallbackContent;
      this.snapshot = { at: now, content };
      return content;
    }
  }
}
