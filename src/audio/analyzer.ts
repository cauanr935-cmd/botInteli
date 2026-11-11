// Interface do analisador de áudio externo + adaptador HTTP genérico + mock.
// O bot NÃO analisa nada: só encaminha e devolve o resultado.
// Não existe docs/ANALISADOR.md; o formato abaixo é genérico e fica isolado neste arquivo (ver PENDENCIAS_HUMANAS).

export interface AnalyzerInput {
  bytes: Uint8Array;
  mime: string;
}
export interface AnalyzerResult {
  /** Texto que será mostrado à pessoa. */
  text: string;
  /** Resposta bruta (guardada em audios.result). */
  raw: unknown;
}
export interface AudioAnalyzer {
  analyze(input: AnalyzerInput): Promise<AnalyzerResult>;
  /** true = a análise acontece depois, em outro sistema (que busca o áudio pela API). */
  readonly deferred?: boolean;
}

/** Sem analisador síncrono configurado: só guarda o áudio; o sistema externo busca e devolve o resultado pela API. */
export class DeferredAudioAnalyzer implements AudioAnalyzer {
  readonly deferred = true;
  async analyze(): Promise<AnalyzerResult> {
    return { text: "Áudio recebido e guardado. A análise fica disponível em breve. Para continuar, toque em Menu.", raw: null };
  }
}

export class AnalyzerError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
    this.name = "AnalyzerError";
  }
}

export interface HttpAnalyzerOptions {
  url: string;
  apiKey: string;
  /** Tempo máximo de CADA tentativa. */
  timeoutMs?: number;
  /** Novas tentativas depois da primeira. */
  retries?: number;
  /** Espera base; cresce em dobro a cada tentativa (500, 1000, ...). */
  backoffMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const TEXT_KEYS = ["text", "result", "summary", "message", "analysis"] as const;

/** Extrai o texto da resposta: campo conhecido (string) ou o JSON compacto. */
export function extractResultText(raw: unknown): string {
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "object" && raw !== null) {
    for (const k of TEXT_KEYS) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === "string" && v.trim() !== "") return v.trim();
    }
  }
  return JSON.stringify(raw) ?? "";
}

export class HttpAudioAnalyzer implements AudioAnalyzer {
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly backoffMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: HttpAnalyzerOptions) {
    this.timeoutMs = opts.timeoutMs ?? 8000;
    this.retries = Math.min(opts.retries ?? 2, 2); // no máximo 2 novas tentativas
    this.backoffMs = opts.backoffMs ?? 500;
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async analyze(input: AnalyzerInput): Promise<AnalyzerResult> {
    let last: AnalyzerError = new AnalyzerError("falha desconhecida", false);
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) await this.sleep(this.backoffMs * 2 ** (attempt - 1));
      try {
        return await this.once(input);
      } catch (e) {
        last = e instanceof AnalyzerError ? e : new AnalyzerError("erro de rede", true);
        if (!last.retryable) break;
      }
    }
    throw last;
  }

  private async once(input: AnalyzerInput): Promise<AnalyzerResult> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.opts.url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": input.mime },
        body: input.bytes,
        signal: ctl.signal,
      });
      if (!res.ok) {
        throw new AnalyzerError(`http_${res.status}`, res.status >= 500 || res.status === 429 || res.status === 408);
      }
      const body = await res.text();
      let raw: unknown = body;
      try {
        raw = JSON.parse(body);
      } catch {
        /* resposta em texto puro */
      }
      const text = extractResultText(raw);
      if (text === "") throw new AnalyzerError("resposta vazia", true);
      return { text, raw };
    } catch (e) {
      if (e instanceof AnalyzerError) throw e;
      throw new AnalyzerError(ctl.signal.aborted ? "timeout" : "network_error", true);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Mock para testes: o comportamento vem de uma função. */
export class MockAudioAnalyzer implements AudioAnalyzer {
  readonly calls: AnalyzerInput[] = [];
  constructor(private readonly handler: (input: AnalyzerInput) => Promise<AnalyzerResult> | AnalyzerResult = () => ({ text: "Resultado de teste", raw: { text: "Resultado de teste" } })) {}
  async analyze(input: AnalyzerInput): Promise<AnalyzerResult> {
    this.calls.push(input);
    return this.handler(input);
  }
}
