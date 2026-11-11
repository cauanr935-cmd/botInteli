// Decisão (PURA) do que vem depois do áudio de perfil: papel -> áreas (mentor) -> dúvida (mentorado) -> encerramento.
// Também cuida de quem já é cadastrado e volta a falar ("Qual a sua dúvida principal?").
import { finish, moveTo, type Counters, type Decision, type UserState } from "../conversation/machine";
import { intentsOf, type Intent } from "../conversation/synonyms";
import { normalizeText } from "../conversation/normalize";
import type { Reply } from "../conversation/texts";
import { fallbackContent, type Content } from "../services/content";
import { menuReply } from "../services/menu";
import { buildButtons, buildList } from "../whatsapp/builders";
import type { IncomingMessage } from "../whatsapp/types";
import { isAllowedDocMime } from "../materials/pipeline";
import {
  ACADEMIC_LIFE_EXPLANATION, CATEGORIES, CATEGORY_DESCRIPTIONS, CATEGORY_DONE_ID, CATEGORY_ROW_PREFIX,
  categoryFromRowId, classifyDoubt, parseCategories,
} from "./categories";
import { MENU_BUTTON_ID, MENU_FALLBACKS } from "../services/menu";
import { startSchedule } from "../schedule/decide";
import {
  DOUBT_NO_ID, DOUBT_YES_ID, PROFILE_TEXTS as T, RET_AREAS_ID, RET_DOUBT_ID, ROLE_BUTTON_BOTH, ROLE_BUTTON_MENTOR,
  ROLE_BUTTON_MENTORADO,
} from "./texts";

export type ProfileRole = "mentor" | "mentorado" | "ambos";

export type ProfileEffect =
  | { kind: "role"; role: ProfileRole; /** true = só ajusta o papel e mantém as áreas e a data de cadastro (quem volta para mudar as áreas) */ keepCategories?: boolean }
  | { kind: "categories"; categories: string[] }
  | { kind: "doubt"; text: string; categories: string[] }
  /** Documento anexado: o motor baixa e guarda (a decisão não responde, salvo a confirmação única). */
  | { kind: "material" };
export type ProfileDecision = Decision & { effect?: ProfileEffect };

export const PROFILE_STATES = ["PROFILE_ROLE", "RETURNING_CHOICE", "MENTOR_CATEGORIES", "MENTOR_CATEGORIES_BOTH", "DOUBT_ASK", "DOUBT_TEXT"] as const;
export const isProfileState = (s: string): boolean => (PROFILE_STATES as readonly string[]).includes(s);

const text = (body: string): Reply => ({ type: "text", text: { body } });
const clean = (s: string): string => s.replace(/\s+/g, " ").trim();

export function roleReply(c: Content = fallbackContent): Reply {
  return buildButtons(c.text("profileAskRole", T.askRole), [
    { id: ROLE_BUTTON_MENTOR, title: c.text("profileRoleMentor", T.roleMentor, 20) },
    { id: ROLE_BUTTON_MENTORADO, title: c.text("profileRoleMentorado", T.roleMentorado, 20) },
    { id: ROLE_BUTTON_BOTH, title: c.text("profileRoleBoth", T.roleBoth, 20) },
  ]);
}
export function doubtAskReply(c: Content = fallbackContent): Reply {
  return buildButtons(c.text("profileAskDoubt", T.askDoubt), [
    { id: DOUBT_YES_ID, title: c.text("profileDoubtYes", T.doubtYes, 20) },
    { id: DOUBT_NO_ID, title: c.text("profileDoubtNo", T.doubtNo, 20) },
  ]);
}
/** Lista de áreas para escolher (uma por toque). Áreas já escolhidas saem da lista; "Concluir" aparece depois da primeira. */
export function categoriesListReply(selected: readonly string[] = [], c: Content = fallbackContent, current = false): Reply {
  const chosen = CATEGORIES.filter((x) => selected.includes(x.key));
  const body = current && chosen.length > 0
    ? `${T.areasCurrent} ${chosen.map((x) => x.label).join(", ")}. Quer incluir mais alguma área? Escolha na lista ou toque em Concluir.`
    : chosen.length === 0
    ? `Em quais áreas você topa ajudar? Escolha uma área de cada vez na lista; quando terminar, toque em Concluir.\n\n${ACADEMIC_LIFE_EXPLANATION}`
    : `Adicionado: ${chosen.map((x) => x.label).join(", ")}. Quer incluir mais alguma área? Escolha na lista ou toque em Concluir.`;
  const rows = CATEGORIES.filter((x) => !selected.includes(x.key)).map((x) => ({
    id: `${CATEGORY_ROW_PREFIX}${x.key}`, title: x.label, description: CATEGORY_DESCRIPTIONS[x.key] ?? "",
  }));
  if (chosen.length > 0) rows.push({ id: CATEGORY_DONE_ID, title: c.text("profileCategoriesDone", T.categoriesDone, 24), description: T.categoriesDoneDesc });
  return buildList(body, c.text("profileCategoriesButton", T.categoriesButton, 20), c.text("profileCategoriesSection", T.categoriesSection, 24), rows);
}
/** "O que você quer fazer?" para quem já é cadastrado e volta a falar (não presume que há uma dúvida). */
export function returningChoiceReply(c: Content = fallbackContent): Reply {
  return buildButtons(c.text("profileAskReturning", T.askReturning), [
    { id: RET_DOUBT_ID, title: c.text("profileReturningDoubt", T.returningDoubt, 20) },
    { id: RET_AREAS_ID, title: c.text("profileReturningAreas", T.returningAreas, 20) },
    { id: MENU_BUTTON_ID, title: c.text("profileReturningMenu", T.returningMenu || MENU_FALLBACKS.menuButtonLabel, 20) },
  ]);
}

/** "não tenho dúvida", "nenhuma dúvida agora", "sem dúvidas"... (texto digitado no lugar de uma dúvida). */
export function isNoDoubt(raw: string): boolean {
  const t = normalizeText(raw);
  return /\b(nao|nenhuma|nenhum|zero)\b.*\bduvidas?\b/.test(t) || /^(sem duvidas?( agora)?|nada( agora)?|nenhuma)$/.test(t) || /\bduvidas?\b.*\bnenhuma\b/.test(t);
}

export const mainDoubtReply = (c: Content = fallbackContent): Reply => text(c.text("profileAskMainDoubt", T.askMainDoubt));

/** Mensagem ao retomar (depois do opt-out) um estado do perfil. */
export function profilePrompt(state: string, c: Content = fallbackContent): Reply | undefined {
  switch (state) {
    case "PROFILE_ROLE": return roleReply(c);
    case "RETURNING_CHOICE": return returningChoiceReply(c);
    case "MENTOR_CATEGORIES":
    case "MENTOR_CATEGORIES_BOTH": return categoriesListReply([], c);
    case "DOUBT_ASK": return doubtAskReply(c);
    case "DOUBT_TEXT": return mainDoubtReply(c);
    default: return undefined;
  }
}

function validDoubt(raw: string): string | null {
  const v = clean(raw);
  if (v.length < 5 || v.length > 500 || !/\p{L}/u.test(v)) return null;
  return intentsOf(v).size > 0 ? null : v;
}

function roleFromText(raw: string): ProfileRole | null {
  const t = normalizeText(raw);
  if (t === "mentor") return "mentor";
  if (t === "mentorado" || t === "mentorada") return "mentorado";
  if (["os dois", "ambos", "as duas", "os 2", "dois"].includes(t)) return "ambos";
  return null;
}

export function decideProfile(
  user: UserState, input: IncomingMessage, counters: Counters, now: Date, content: Content = fallbackContent,
  /** Dados do cadastro: áreas já escolhidas e papel atual. */
  profile: {
    selected?: readonly string[]; role?: ProfileRole | null;
    /** Já há dias e horários gravados (mentor que só muda as áreas não precisa informar de novo). */
    hasAvailability?: boolean;
    /** Horários informados há pouco (ex.: quem é mentor e mentorado acabou de dar os horários): não pergunta de novo. */
    scheduleFresh?: boolean;
  } = {},
): ProfileDecision | null {
  const selected = profile.selected ?? [];
  const c = content;
  const intents: Set<Intent> = input.type === "text" ? intentsOf(input.body) : new Set<Intent>();
  const silent = (): ProfileDecision => ({ replies: [], nextState: user, outcome: "silent" });
  const withEffect = (d: Decision, effect: ProfileEffect): ProfileDecision => (d.outcome === "limited" ? d : { ...d, effect });
  const hintOnce = (body: string): ProfileDecision => {
    if (user.hintSentInState) return silent();
    return finish(user, { ...user, hintSentInState: true }, [text(body)], counters, "hint");
  };

  // Documento anexado (junto da dúvida ou logo depois): tipo inválido = 1 dica; válido = guarda. Resposta única no COMPLETED.
  const documentDecision = (): ProfileDecision | null => {
    if (input.type !== "document") return null;
    if (input.mimeType !== undefined && !isAllowedDocMime(input.mimeType)) return hintOnce(c.text("profileHintMaterial", T.hintMaterial));
    if (user.state === "COMPLETED" && !user.hintSentInState) {
      return withEffect(finish(user, { ...user, hintSentInState: true }, [text(c.text("profileMaterialReceived", T.materialReceived))], counters, "reply"), { kind: "material" });
    }
    return { replies: [], nextState: user, outcome: "silent", effect: { kind: "material" } };
  };

  // Mudar as áreas de mentoria (quem já é cadastrado): mantém as atuais e deixa incluir outras. Mentorado vira "os dois".
  const startAreasChange = (): ProfileDecision => {
    const role: ProfileRole = profile.role === "mentor" || profile.role === "ambos" ? profile.role : "ambos";
    return withEffect(
      finish(user, moveTo(user, "MENTOR_CATEGORIES", now), [categoriesListReply(selected, c, true)], counters, "reply"),
      { kind: "role", role, keepCategories: true },
    );
  };
  const startDoubt = (): ProfileDecision =>
    finish(user, moveTo(user, "DOUBT_TEXT", now), [text(c.text("profileAskDoubtText", T.askDoubtText))], counters, "reply");
  const openMenu = (): ProfileDecision => finish(user, moveTo(user, "MENU", now), [menuReply(c)], counters, "transition");
  const noDoubtClosing = (): ProfileDecision =>
    finish(user, moveTo(user, "COMPLETED", now), [text(c.text("profileClosingNoDoubt", T.closingNoDoubt))], counters, "reply");

  // Quem já concluiu e volta a falar: pergunta o que quer fazer (não presume que há uma dúvida).
  if (user.state === "COMPLETED") {
    if (input.type === "text" && intents.has("greeting")) {
      return finish(user, moveTo(user, "RETURNING_CHOICE", now), [returningChoiceReply(c)], counters, "reply");
    }
    if (input.type === "button_reply" && input.id === RET_DOUBT_ID) return startDoubt();
    if (input.type === "button_reply" && input.id === RET_AREAS_ID) return startAreasChange();
    if (input.type === "button_reply" && input.id === MENU_BUTTON_ID) return openMenu();
    return documentDecision();
  }

  if (!isProfileState(user.state)) return null;
  if (input.type === "text" && intents.has("quit")) return null; // opt-out é da máquina principal

  if (user.state === "RETURNING_CHOICE") {
    if (input.type === "button_reply") {
      if (input.id === RET_DOUBT_ID) return startDoubt();
      if (input.id === RET_AREAS_ID) return startAreasChange();
      if (input.id === MENU_BUTTON_ID) return openMenu();
      return silent();
    }
    if (input.type !== "text") return silent();
    if (intents.has("menu")) return openMenu();
    if (intents.has("greeting")) return silent(); // a pergunta já está na tela: repetição = silêncio (R2)
    return hintOnce(c.text("profileHintReturning", T.hintReturning));
  }

  if (user.state === "PROFILE_ROLE") {
    let role: ProfileRole | null = null;
    if (input.type === "button_reply") {
      role = input.id === ROLE_BUTTON_MENTOR ? "mentor" : input.id === ROLE_BUTTON_MENTORADO ? "mentorado" : input.id === ROLE_BUTTON_BOTH ? "ambos" : null;
    } else if (input.type === "text") {
      role = roleFromText(input.body);
    }
    if (!role) return input.type === "text" ? hintOnce(c.text("profileHintRole", T.hintRole)) : silent();
    const reply = role === "mentorado" ? doubtAskReply(c) : categoriesListReply([], c);
    const to = role === "mentorado" ? "DOUBT_ASK" : role === "mentor" ? "MENTOR_CATEGORIES" : "MENTOR_CATEGORIES_BOTH";
    return withEffect(finish(user, moveTo(user, to, now), [reply], counters, "reply"), { kind: "role", role });
  }

  if (user.state === "MENTOR_CATEGORIES" || user.state === "MENTOR_CATEGORIES_BOTH") {
    const both = user.state === "MENTOR_CATEGORIES_BOTH";
    const ordered = (keys: Iterable<string>): string[] => { const set = new Set(keys); return CATEGORIES.map((x) => x.key).filter((k) => set.has(k)); };
    const finishWith = (categories: string[]): ProfileDecision => {
      // Mentor novo: antes de encerrar, escolhe os dias e horários em que pode mentorar.
      if (!profile.hasAvailability) {
        const s = startSchedule(both ? "ambos" : "mentor", c);
        return withEffect(finish(user, moveTo(user, s.state, now), [s.reply], counters, "reply"), { kind: "categories", categories });
      }
      return withEffect(
        finish(
          user, moveTo(user, both ? "DOUBT_ASK" : "COMPLETED", now),
          [both ? doubtAskReply(c) : text(c.text("profileClosingMentor", T.closingMentor))], counters, "reply",
        ),
        { kind: "categories", categories },
      );
    };

    if (input.type === "list_reply") {
      if (input.id === CATEGORY_DONE_ID) return selected.length > 0 ? finishWith(ordered(selected)) : silent();
      const key = categoryFromRowId(input.id);
      if (key === null || selected.includes(key)) return silent(); // linha antiga/desconhecida: silêncio
      const next = ordered([...selected, key]);
      if (next.length === CATEGORIES.length) return finishWith(next); // todas escolhidas: não há mais o que escolher
      // Continua no mesmo estado: grava a área e mostra a lista de novo (sem a área escolhida).
      return withEffect(finish(user, user, [categoriesListReply(next, c)], counters, "reply"), { kind: "categories", categories: next });
    }
    if (input.type !== "text") return silent();
    // Digitou? Ainda vale (números ou nomes), mas o caminho principal é a lista.
    const typed = parseCategories(input.body);
    if (typed.length === 0) return hintOnce(c.text("profileHintCategories", T.hintCategories));
    return finishWith(ordered([...selected, ...typed]));
  }

  if (user.state === "DOUBT_ASK") {
    const yes = (input.type === "button_reply" && input.id === DOUBT_YES_ID) || (input.type === "text" && intents.has("yes"));
    const no = (input.type === "button_reply" && input.id === DOUBT_NO_ID) || (input.type === "text" && intents.has("no"));
    if (yes) return finish(user, moveTo(user, "DOUBT_TEXT", now), [text(c.text("profileAskDoubtText", T.askDoubtText))], counters, "reply");
    if (no) return finish(user, moveTo(user, "COMPLETED", now), [text(c.text("profileClosingNoDoubt", T.closingNoDoubt))], counters, "reply");
    return input.type === "text" ? hintOnce(c.text("profileHintDoubtAsk", T.hintDoubtAsk)) : silent();
  }

  // DOUBT_TEXT
  if (input.type === "text" && intents.has("menu")) return openMenu();
  if (input.type === "button_reply") {
    if (input.id === MENU_BUTTON_ID) return openMenu();
    if (input.id === DOUBT_NO_ID) return noDoubtClosing();
    if (input.id === RET_AREAS_ID) return startAreasChange();
    return silent();
  }
  if (input.type === "document") return documentDecision();
  if (input.type !== "text") return silent();
  if (intents.has("greeting")) return silent(); // a pergunta já foi feita: repetição = silêncio (R2)
  if (intents.has("no") || isNoDoubt(input.body)) return noDoubtClosing(); // "não tenho dúvida agora" não é uma dúvida
  const doubt = validDoubt(input.body);
  if (doubt === null) return hintOnce(c.text("profileHintDoubtText", T.hintDoubtText));
  // "Agora, só para encerrar": o mentorado informa em que dias e horários está disponível.
  if (!profile.scheduleFresh) {
    const s = startSchedule("doubt", c, `${c.text("scheduleDoubtIntro", T.doubtRegisteredIntro)} `);
    return withEffect(finish(user, moveTo(user, s.state, now), [s.reply], counters, "reply"), { kind: "doubt", text: doubt, categories: classifyDoubt(doubt) });
  }
  return withEffect(
    finish(user, moveTo(user, "COMPLETED", now), [text(c.text("profileClosingDoubt", T.closingDoubt))], counters, "reply"),
    { kind: "doubt", text: doubt, categories: classifyDoubt(doubt) },
  );
}
