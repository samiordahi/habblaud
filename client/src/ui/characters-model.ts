// Fork Ordahi: tela de Personagens, parte pura (sem DOM). O formato é o de <dataDir>/identidades.json, que o servidor
// valida de novo (server/model/identities.ts). A interface fica em characters.ts.
import { nameKey, type AppearanceParts } from '../../../shared/appearance';
import { parseCatchphrase } from '../../../shared/persona';
import { TRAIT_IDS, type TraitId } from '../../../shared/world/protocol';
import { appearanceFromSeed } from '../art';
import type { Appearance } from '../art/api';
import { personaFor } from '../world/social/persona';
import { fullParts, traitsValid } from './world/world-model';
import { tr } from '../../../shared/i18n';

export type Tool = 'claude' | 'codex' | 'externo' | 'nenhuma';
export type BondChoice = 'acaso' | 'amigo' | 'rival';

export interface CharacterEntry {
  nome: string;
  ferramenta: Tool;
  chave?: string;
  pasta?: string;
  casa?: string;
  look: 'f' | 'm';
  seed: number;
  parts?: AppearanceParts;
  personalidade?: { tracos?: string[]; bordao?: string; amigos?: string[]; rivais?: string[] };
}

export interface Profile {
  chave: string;
  nome: string;
}

export interface CharacterList {
  personagens: CharacterEntry[];
  perfis: readonly Profile[];
}

/** O que está em edição, fora as peças da aparência (ficam em AppearanceFields). */
export interface Draft {
  /** Nome com que o personagem está no arquivo; ausente = novo. */
  previous?: string;
  nome: string;
  ferramenta: Tool;
  chave: string;
  pasta: string;
  casa: string;
  look: 'f' | 'm';
  seed: number;
  traits: TraitId[];
  bordao: string;
  bonds: Record<string, BondChoice>;
}

/** Só traços que existem: a lista pode ter vindo de um arquivo escrito à mão. */
const knownTraits = (list: readonly string[]): TraitId[] => list.filter((t): t is TraitId => (TRAIT_IDS as readonly string[]).includes(t));

export function draftOf(e: CharacterEntry): Draft {
  const p = e.personalidade;
  const bonds: Record<string, BondChoice> = {};
  for (const n of p?.amigos ?? []) bonds[n] = 'amigo';
  for (const n of p?.rivais ?? []) bonds[n] = 'rival';
  return {
    previous: e.nome,
    nome: e.nome,
    ferramenta: e.ferramenta,
    chave: e.chave ?? '',
    pasta: e.pasta ?? '',
    casa: e.casa ?? '',
    look: e.look,
    seed: e.seed,
    traits: p?.tracos ? knownTraits(p.tracos) : [...personaFor(e.seed).traits],
    bordao: p?.bordao ?? '',
    bonds,
  };
}

export function newDraft(seed: number, look: 'f' | 'm'): Draft {
  return { nome: '', ferramenta: 'nenhuma', chave: '', pasta: '', casa: '', look, seed, traits: [...personaFor(seed).traits], bordao: '', bonds: {} };
}

/** Aparência do personagem salvo: as peças por cima do sorteio da semente. */
export function appearanceOf(e: Pick<CharacterEntry, 'seed' | 'look' | 'parts'>): Appearance {
  return appearanceFromSeed(e.seed, { look: e.look, parts: e.parts });
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

/**
 * O que vai para o arquivo. As peças vão todas: a aparência fica fixa e a semente sobra só para a personalidade. Traços
 * e bordão iguais aos da semente não são declarados: seguem a semente, como sempre foi.
 */
export function entryOf(d: Draft, a: Appearance): CharacterEntry {
  const friends = Object.keys(d.bonds).filter((n) => d.bonds[n] === 'amigo');
  const rivals = Object.keys(d.bonds).filter((n) => d.bonds[n] === 'rival');
  const seedPersona = personaFor(d.seed);
  const bordao = d.bordao.trim();
  const personalidade = {
    ...(sameSet(d.traits, seedPersona.traits) ? {} : { tracos: d.traits }),
    ...(bordao && bordao !== seedPersona.catchphrase ? { bordao } : {}),
    ...(friends.length ? { amigos: friends } : {}),
    ...(rivals.length ? { rivais: rivals } : {}),
  };
  const local = d.ferramenta === 'claude' || d.ferramenta === 'codex';
  return {
    nome: d.nome.trim(),
    ferramenta: d.ferramenta,
    ...(d.ferramenta === 'externo' ? { chave: d.chave } : {}),
    ...(local && d.pasta.trim() ? { pasta: d.pasta.trim() } : {}),
    ...(local && d.casa.trim() ? { casa: d.casa.trim() } : {}),
    look: d.look,
    seed: d.seed,
    parts: fullParts({ ...a, look: d.look }),
    ...(Object.keys(personalidade).length ? { personalidade } : {}),
  };
}

export type DraftTab = 'look' | 'persona' | 'link';

/** O que falta para salvar: a mensagem e a aba onde se resolve. O resto o servidor confere. */
export function draftProblem(d: Draft): { message: string; tab: DraftTab } | null {
  if (!d.nome.trim()) return { message: tr('Dê um nome ao personagem.'), tab: 'look' };
  if (!traitsValid(d.traits)) return { message: tr('Escolha 2 ou 3 traços de personalidade.'), tab: 'persona' };
  if (d.bordao.trim() && !parseCatchphrase(d.bordao)) return { message: tr('O bordão passou do limite.'), tab: 'persona' };
  if (d.ferramenta === 'externo' && !d.chave) return { message: tr('Escolha o perfil do Hermes.'), tab: 'link' };
  return null;
}

/** Quem já ocupa esta ligação (o personagem em edição não conta). */
export function linkOwner(list: readonly CharacterEntry[], d: Pick<Draft, 'previous' | 'ferramenta' | 'chave' | 'pasta'>): CharacterEntry | undefined {
  if (d.ferramenta === 'nenhuma') return undefined;
  const folder = d.pasta.trim().toLowerCase();
  return list.find((e) => {
    if (d.previous !== undefined && nameKey(e.nome) === nameKey(d.previous)) return false;
    if (e.ferramenta !== d.ferramenta) return false;
    return d.ferramenta === 'externo' ? e.chave === d.chave : (e.pasta ?? '').toLowerCase() === folder;
  });
}

/** Uma linha dizendo quem o personagem é. */
export function linkText(e: Pick<CharacterEntry, 'ferramenta' | 'chave' | 'pasta'>, profiles: readonly Profile[]): string {
  if (e.ferramenta === 'nenhuma') return tr('Guardado, sem agente');
  if (e.ferramenta === 'externo') return tr('Hermes: {0}', [profiles.find((p) => p.chave === e.chave)?.nome ?? e.chave ?? '?']);
  const tool = e.ferramenta === 'codex' ? 'Codex' : 'Claude';
  return e.pasta ? tr('{0} em {1}', [tool, e.pasta]) : tr('{0}, em qualquer pasta', [tool]);
}

/** Pasta do projeto como trecho do caminho: o último nome, que não muda de um computador para outro. */
export function folderOf(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;
}
