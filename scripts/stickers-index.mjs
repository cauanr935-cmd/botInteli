// Gera assets/stickers/index.json com os .webp da pasta (o Worker não consegue listar a pasta em tempo de execução).
import { readdirSync, writeFileSync } from "node:fs";
const dir = new URL("../assets/stickers/", import.meta.url);
const files = readdirSync(dir).filter((f) => /^[A-Za-z0-9_.-]{1,80}\.webp$/.test(f)).sort();
writeFileSync(new URL("index.json", dir), JSON.stringify(files, null, 2) + "\n");
console.log(`${files.length} figurinha(s) no índice.`);
