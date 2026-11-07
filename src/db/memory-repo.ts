import type { Repo } from "./repo";

export class MemoryRepo implements Repo {
  readonly processed = new Map<string, Date>();
  readonly users = new Map<string, Date>();

  async claimMessage(key: string, receivedAt: Date): Promise<boolean> {
    // Síncrono dentro do método: check-and-set atômico no event loop.
    if (this.processed.has(key)) return false;
    this.processed.set(key, receivedAt);
    return true;
  }
  async touchUser(waId: string, at: Date): Promise<void> {
    const cur = this.users.get(waId);
    if (!cur || cur < at) this.users.set(waId, at);
  }
  async getLastUserMessageAt(waId: string): Promise<Date | null> {
    return this.users.get(waId) ?? null;
  }
}
