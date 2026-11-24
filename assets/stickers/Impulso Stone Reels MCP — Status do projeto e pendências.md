# Impulso Stone Reels MCP — Status do projeto e pendências

Nov 18, 2026 · @Cauan

## Resumo

O pipeline MCP está completo (specs 00 a 07 aprovadas) e a base de Reels do case está coletada, ranqueada e commitada: 1.672 Reels de 76 perfis, 151 no top 10%. Falta a fase de análise dos padrões e a atualização da documentação, e o volume ficou abaixo da meta de 2.000 publicações porque o crédito gratuito do Apify acabou.

## Pipeline MCP (specs 00 a 07)

Todas as 8 specs estão DONE desde 07/11/2026, com gate `exit 0` e veredito PASS do verificador. O `scripts/gate.sh all` passou com 53 testes, e os 5 formatos renderizam e passam na auditoria H.264/AAC/LUFS/CFR.

| Spec | Entrega | Tier / observação |
| --- | --- | --- |
| 00 | Bootstrap e doctor | Python 3.12.3; FFmpeg com libx264/libass |
| 01 | Fundação, fixtures, MCP base | MCP 1.30.0 |
| 02 | Roteador em cascata | Edge TTS online; placeholder offline |
| 03 | Visão, CFR, reframe, hooks | Reframe CENTER; hooks heurísticos |
| 04 | Animação 2.5D | OpenCV; profundidade geométrica |
| 05 | Jump-cuts, música, legendas | Silencedetect; música procedural; pysubs2 |
| 06 | Diretor criativo | Templates determinísticos |
| 07 | Orquestrador e render | 5 renders aprovados |

## Base de Reels do case

A base tem 1.672 Reels de 76 perfis, coletados em 17 e 18/11/2026 (posts de 18/11/2025 a 04/11/2026). A meta do TAPI era de 2.000 a 5.000 publicações de pelo menos 30 perfis: cumprimos os perfis, não o volume.

| Item | Valor |
| --- | --- |
| Reels na base | 1.672 (76 perfis) |
| Aptos ao ranking | 1.504 |
| Fora do ranking | 155 com curtidas ocultas; 13 de perfis com menos de 5 Reels aptos |
| Alto desempenho (top 10%) | 151 Reels, de 48 perfis |
| Concordância entre rankings | 80 dos 151 posts coincidem entre `score_relativo` e `taxa_eng` |
| Vídeos baixados | 393 (`video_ok`) |
| Gasto no Apify | cerca de US$ 4,30 nos lotes 1 e 2, mais US$ 3,7 no lote 3 |
| Posts excluídos | 1.003 (773 com menos de 14 dias, 167 colaborações, 42 não-Reels, 21 fora da janela) |

**Limitações principais**

- Base dominada por contabilidade e contas pequenas: só 149 Reels vêm de contas grandes e há apenas 1 criador grande.
- Teto de cerca de 35 Reels por perfil trunca a janela de 12 meses em 51 perfis.
- Seguidores medidos na data da coleta, não na do post, o que distorce `taxa_eng` em posts antigos.
- Viés de sobrevivência e de descoberta por hashtag; sem dados de Insights da Stone.

## Principais pendências

A única pendência que bloqueia o objetivo do case é a análise dos padrões; as demais são documentação e decisões humanas.

| # | Pendência | Tipo | Impacto |
| --- | --- | --- | --- |
| 1 | Analisar os 151 Reels do top 10%: transcrever, extrair frames, classificar nos 5 formatos e medir desempenho por formato | Trabalho técnico | Alto: é a fase que entrega o resultado do case. Não há plano escrito dela no repositório |
| 2 | Confirmar com a organização do case (H-CASE-01) que a coleta via Apify é a rota combinada no kickoff de 26/10/2026 | Jurídico (humano) | Alto: o TAPI exclui scraping que viole os Termos de Serviço |
| 3 | Atualizar `docs/PROGRESS.md` e `docs/FINAL_REPORT.md` com as fases 1 a 4 de coleta e ranking | Documentação | Médio: hoje só o ADR-009 e `docs/base_de_dados.md` cobrem a base |
| 4 | Corrigir o ADR-009, que ainda cita volume de 776 Reels na seção de desvios (o atual é 1.672) | Documentação | Baixo |
| 5 | Ampliar a base para 2.000+ Reels e cobrir os 51 perfis truncados (H-CASE-02); o crédito do Apify renova em 17/12/2026 | Orçamento (opcional) | Médio: meta do TAPI ainda não atingida |
| 6 | Revisar os termos comerciais do edge-tts (legal-edge-tts) antes de publicar | Jurídico (recomendado) | Médio: uso comercial do endpoint não é explícito |
| 7 | Baixar os vídeos do top 10% que faltam; as URLs do Apify expiram em cerca de 1 dia | Trabalho técnico | Médio: sem vídeo não há transcrição nem frames |

## Próximos passos recomendados

1. Conferir quantos dos 151 Reels do top têm vídeo em disco e baixar os que faltam antes que as URLs expirem.
2. Transcrever e extrair frames desses vídeos, classificar cada um nos 5 formatos e comparar o desempenho médio por formato.
3. Atualizar `docs/PROGRESS.md`, `docs/FINAL_REPORT.md` e o ADR-009 com as fases de coleta e ranking.
4. Levar a pendência H-CASE-01 à organização do case e, se quiser mais volume, planejar o lote 4 para depois de 17/12/2026.
