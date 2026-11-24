// Recupera da Evolution os arquivos de áudio/vídeo recebidos nos últimos N dias (inclui o .mp4 que o bot recusou antes da correção).
// Uso: EVOLUTION_URL=... EVOLUTION_API_KEY=... EVOLUTION_INSTANCE=... node scripts/recover-rejected.mjs [dias=7] [pasta=./recuperados]
// Salva só os tipos de mídia (audio/video/documento); nunca imprime telefone nem a apikey. Formato NÃO verificado em instância real.
import { mkdirSync, writeFileSync } from "node:fs";

const { EVOLUTION_URL: url, EVOLUTION_API_KEY: apikey, EVOLUTION_INSTANCE: inst } = process.env;
if (!url || !apikey || !inst) { console.error("Defina EVOLUTION_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE."); process.exit(1); }
const days = Number(process.argv[2] ?? 7);
const dir = process.argv[3] ?? "./recuperados";
const since = Math.floor(Date.now() / 1000) - days * 86400;
const api = async (path, body) => {
  const r = await fetch(`${url}${path}/${encodeURIComponent(inst)}`, { method: "POST", headers: { apikey, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
};
const j = await api("/chat/findMessages", { where: { key: { fromMe: false }, messageTimestamp: { gte: since } }, page: 1, offset: 500 });
const records = Array.isArray(j) ? j : (j.messages?.records ?? j.records ?? j.messages ?? []);
mkdirSync(dir, { recursive: true });
const EXT = { "video/mp4": "mp4", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3" };
let n = 0;
for (const rec of records) {
  const m = rec.message ?? {};
  const media = m.videoMessage ?? m.audioMessage ?? m.documentMessage;
  const id = rec.key?.id;
  if (!media || !id) continue;
  try {
    const d = await api("/chat/getBase64FromMediaMessage", { message: { key: { id } }, convertToMp4: false });
    const mime = String(d.mimetype ?? media.mimetype ?? "").split(";")[0];
    const file = `${dir}/${id}.${EXT[mime] ?? "bin"}`;
    writeFileSync(file, Buffer.from(String(d.base64).replace(/^data:[^;]*;base64,/, ""), "base64"));
    console.log(`salvo: ${file} (${mime || "tipo desconhecido"})`);
    n++;
  } catch (e) { console.error(`falhou ${id}: ${e.message}`); }
}
console.log(`${n} arquivo(s) recuperado(s) em ${dir}`);
