// Figurinhas do Axo: quando a pessoa manda uma figurinha ou imagem, o bot devolve uma figurinha.
// Os arquivos .webp ficam na pasta `assets/stickers/` (publicada junto do Worker pelo binding ASSETS) e a lista
// vem de `assets/stickers/index.json` (gerada por `npm run stickers`). Sem figurinhas, o bot segue em silêncio.

/** A categoria é o começo do nome do arquivo: `abertura_garfield-oi.webp` é da categoria "abertura". */
export type StickerCategory = "abertura" | "resenha" | "despedida" | "reacao";

export interface StickerPicker {
  /** Sorteia uma figurinha da categoria (base64, sem prefixo data:). null = não há figurinha disponível. */
  pick(category: StickerCategory): Promise<string | null>;
}

/** Só o que precisamos do binding ASSETS do Cloudflare (facilita testar). */
export interface AssetsLike {
  fetch(input: string): Promise<Response>;
}

const BASE = "https://assets.local/stickers/";
const NAME = /^[A-Za-z0-9_.-]{1,80}\.webp$/;
/** Figurinha do WhatsApp tem no máximo ~100 KB (estática); acima disso o arquivo é ignorado. */
const MAX_BYTES = 500_000;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Tipos de mensagem recebida que ganham figurinha de volta. */
export function isStickerTrigger(rawType: string): boolean {
  return /^(sticker|image)(message)?$/i.test(rawType);
}

export function createAssetStickers(assets: AssetsLike, random: () => number = Math.random): StickerPicker {
  let names: string[] | null = null;
  const cache = new Map<string, string>();
  return {
    async pick(category) {
      try {
        if (names === null) {
          const res = await assets.fetch(BASE + "index.json");
          const list: unknown = res.ok ? await res.json() : [];
          names = Array.isArray(list) ? list.filter((n): n is string => typeof n === "string" && NAME.test(n)) : [];
        }
        // Só da categoria pedida; "reacao" aceita qualquer uma se a categoria estiver vazia. Outras sem figurinha = silêncio.
        const own = names.filter((n) => n.startsWith(category + "_"));
        const pool = own.length > 0 ? own : category === "reacao" ? names : [];
        if (pool.length === 0) return null;
        const name = pool[Math.floor(random() * pool.length) % pool.length]!;
        const hit = cache.get(name);
        if (hit) return hit;
        const res = await assets.fetch(BASE + name);
        if (!res.ok) return null;
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
        const b64 = toBase64(bytes);
        if (cache.size < 20) cache.set(name, b64);
        return b64;
      } catch {
        return null; // sem figurinha, sem resposta: nunca derruba o webhook
      }
    },
  };
}
