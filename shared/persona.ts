// Fork Ordahi: personalidade declarada de um personagem fixo (identidades.json, campo `personalidade`), por cima do que
// a semente sorteia. Puro: sem Node nem DOM. Fica só no escritório: a projeção do Habblaud World não lê este campo.
import { hasControlChars, nameKey, parseCharacterName } from './appearance';
import { parsePlayerTraits } from './world/traits';
import type { TraitId } from './world/protocol';

/** O bordão aparece num balão de fala do personagem. */
export const CATCHPHRASE_MAX = 40;

/** O que a pessoa escolheu; o que faltar continua vindo da semente. */
export interface DeclaredPersona {
  traits?: TraitId[];
  catchphrase?: string;
  /** Nomes de outros personagens fixos. Vale nos dois sentidos: o arquivo guarda dos dois lados. */
  friends?: string[];
  rivals?: string[];
}

function parseNames(raw: unknown): string[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw) {
    const name = parseCharacterName(item);
    if (!name) return null;
    if (!out.some((n) => nameKey(n) === nameKey(name))) out.push(name);
  }
  return out;
}

/** Bordão: uma linha de até CATCHPHRASE_MAX caracteres. Mesmas regras do nome, com outro limite. */
export function parseCatchphrase(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  return !text || hasControlChars(text) || [...text].length > CATCHPHRASE_MAX ? null : text;
}

/** Campo `personalidade` do arquivo ({tracos, bordao, amigos, rivais}), ou null se houver algo fora do formato. */
export function parseDeclaredPersona(raw: unknown): DeclaredPersona | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const out: DeclaredPersona = {};
  if (v.tracos !== undefined) {
    const traits = parsePlayerTraits(v.tracos);
    if (!traits) return null;
    out.traits = traits;
  }
  if (v.bordao !== undefined) {
    const phrase = parseCatchphrase(v.bordao);
    if (!phrase) return null;
    out.catchphrase = phrase;
  }
  const friends = parseNames(v.amigos);
  const rivals = parseNames(v.rivais);
  if (!friends || !rivals) return null;
  if (friends.some((f) => rivals.some((r) => nameKey(r) === nameKey(f)))) return null;
  if (friends.length) out.friends = friends;
  if (rivals.length) out.rivals = rivals;
  return out;
}
