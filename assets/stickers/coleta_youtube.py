"""
Coleta de Shorts do YouTube via YouTube Data API v3 (rota oficial) + download com yt-dlp.

Uso:
    export YOUTUBE_API_KEY="sua_chave"   # Google Cloud Console > APIs > YouTube Data API v3 > Credenciais
    python coleta_youtube.py --perfis perfis.csv --desde 2025-11-01

Custo de cota: usa a playlist de uploads de cada canal (1 unidade por página de 50 vídeos)
em vez de search.list (100 unidades). 40 canais custam poucas centenas de unidades
das 10.000 diárias gratuitas.

Saídas:
    youtube_canais.parquet, youtube_posts.parquet
    midia/youtube/<video_id>.mp4 e .jpg
"""
import argparse
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import isodate
import pandas as pd
import yt_dlp
from googleapiclient.discovery import build

DURACAO_MAX_SHORT_S = 180  # Shorts podem ter até 3 min; a API não marca "é Short", então é heurística
IDADE_MINIMA_DIAS = 14


def info_canal(yt, ident: str) -> dict | None:
    partes = "snippet,statistics,contentDetails"
    if ident.startswith("UC"):
        resp = yt.channels().list(part=partes, id=ident).execute()
    else:
        resp = yt.channels().list(part=partes, forHandle=ident.lstrip("@")).execute()
    itens = resp.get("items", [])
    if not itens:
        return None
    c = itens[0]
    est = c["statistics"]
    return {
        "username": ident.lstrip("@").lower(),
        "canal_id": c["id"],
        "nome": c["snippet"]["title"],
        "seguidores": None if est.get("hiddenSubscriberCount") else int(est.get("subscriberCount", 0)),
        "total_videos": int(est.get("videoCount", 0)),
        "playlist_uploads": c["contentDetails"]["relatedPlaylists"]["uploads"],
    }


def ids_desde(yt, playlist: str, desde: datetime) -> list[str]:
    """Percorre a playlist de uploads (mais recentes primeiro) até passar da data limite."""
    ids, token = [], None
    while True:
        resp = yt.playlistItems().list(part="contentDetails", playlistId=playlist,
                                       maxResults=50, pageToken=token).execute()
        parar = False
        for it in resp["items"]:
            publicado = datetime.fromisoformat(it["contentDetails"]["videoPublishedAt"].replace("Z", "+00:00"))
            if publicado < desde:
                parar = True
                break
            ids.append(it["contentDetails"]["videoId"])
        token = resp.get("nextPageToken")
        if parar or not token:
            return ids


def detalhes(yt, ids: list[str]) -> list[dict]:
    saida = []
    for i in range(0, len(ids), 50):
        resp = yt.videos().list(part="snippet,statistics,contentDetails",
                                id=",".join(ids[i:i + 50])).execute()
        saida.extend(resp["items"])
    return saida


def baixar_videos(ids: list[str], pasta: Path):
    pasta.mkdir(parents=True, exist_ok=True)
    opcoes = {
        "format": "best[height<=720][ext=mp4]/best[height<=720]/best",  # 720p basta para frames/VLM
        "outtmpl": str(pasta / "%(id)s.%(ext)s"),
        "writethumbnail": True,
        "download_archive": str(pasta / "_baixados.txt"),  # não baixa de novo o que já tem
        "ignoreerrors": True,
        "sleep_interval": 2,
        "max_sleep_interval": 6,
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(opcoes) as ydl:
        ydl.download([f"https://www.youtube.com/shorts/{v}" for v in ids])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--perfis", default="perfis.csv")
    ap.add_argument("--desde", default=(datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d"))
    ap.add_argument("--saida", default="dados")
    ap.add_argument("--sem-midia", action="store_true")
    args = ap.parse_args()

    yt = build("youtube", "v3", developerKey=os.environ["YOUTUBE_API_KEY"])
    saida = Path(args.saida)
    saida.mkdir(parents=True, exist_ok=True)
    desde = datetime.fromisoformat(args.desde).replace(tzinfo=timezone.utc)
    data_coleta = datetime.now(timezone.utc)

    tabela = pd.read_csv(args.perfis)
    tabela = tabela[tabela["plataforma"].str.lower() == "youtube"].copy()
    tabela["username"] = tabela["username"].str.strip().str.lstrip("@").str.lower()

    canais, linhas = [], []
    for _, row in tabela.iterrows():
        c = info_canal(yt, row["username"])
        if not c:
            print(f"{row['username']}: canal não encontrado")
            continue
        c.update({"tamanho": row.get("tamanho"), "tipo_conta": row.get("tipo_conta"),
                  "segmento": row.get("segmento"), "data_coleta": data_coleta})
        canais.append(c)

        ids = ids_desde(yt, c["playlist_uploads"], desde)
        for v in detalhes(yt, ids):
            dur = isodate.parse_duration(v["contentDetails"]["duration"]).total_seconds()
            if dur > DURACAO_MAX_SHORT_S:
                continue
            est, sn = v["statistics"], v["snippet"]
            pub = pd.to_datetime(sn["publishedAt"], utc=True)
            linhas.append({
                "plataforma": "youtube",
                "post_id": v["id"],
                "url": f"https://www.youtube.com/shorts/{v['id']}",
                "username": c["username"],
                "tipo_post": "short",
                "legenda": sn.get("title", "") + "\n\n" + sn.get("description", ""),
                "hashtags": sn.get("tags"),
                "data_post": pub,
                "idade_dias": (pd.Timestamp(data_coleta) - pub).days,
                "curtidas": int(est["likeCount"]) if "likeCount" in est else None,
                "comentarios": int(est["commentCount"]) if "commentCount" in est else None,
                "views": int(est.get("viewCount", 0)),
                "duracao_s": dur,
                "seguidores": c["seguidores"],
                "tamanho": c["tamanho"], "tipo_conta": c["tipo_conta"], "segmento": c["segmento"],
                "data_coleta": data_coleta,
            })
        print(f"{c['username']}: {sum(1 for l in linhas if l['username'] == c['username'])} shorts")

    pd.DataFrame(canais).to_parquet(saida / "youtube_canais.parquet", index=False)
    df = pd.DataFrame(linhas)
    df = df[df["idade_dias"] >= IDADE_MINIMA_DIAS]

    # Mesmas métricas do Instagram. Atenção: em Shorts, inscritos explicam pouco das views.
    df["taxa_eng"] = (df["curtidas"] + df["comentarios"]) / df["seguidores"]
    df["score_relativo"] = df["taxa_eng"] / df.groupby("username")["taxa_eng"].transform("median")
    df["alcance"] = df["views"] / df["seguidores"]
    df["ressonancia"] = (df["curtidas"] + df["comentarios"]) / df["views"]
    df.to_parquet(saida / "youtube_posts.parquet", index=False)
    print(f"{len(df)} shorts com {IDADE_MINIMA_DIAS}+ dias")

    if not args.sem_midia:
        baixar_videos(df["post_id"].tolist(), saida / "midia" / "youtube")


if __name__ == "__main__":
    main()
