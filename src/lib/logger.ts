export type LogLevel = "debug" | "info" | "warn" | "error" | "critical";

/** Mascara telefone: 5511987651234 -> 5511*****1234 (R3). */
export function maskPhone(phone: string): string {
  const d = String(phone).replace(/\D/g, "");
  if (d.length <= 8) return "*".repeat(d.length);
  return d.slice(0, 4) + "*".repeat(d.length - 8) + d.slice(-4);
}

export interface Logger {
  log(level: LogLevel, event: string, fields?: Record<string, unknown>): void;
}

export type LogSink = (line: string) => void;

export function createLogger(sink: LogSink = (l) => console.log(l)): Logger {
  return {
    log(level, event, fields = {}) {
      sink(JSON.stringify({ level, event, ...fields, ts: new Date().toISOString() }));
    },
  };
}
