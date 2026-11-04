// Geração determinística de aparência a partir de uma semente (puro, sem DOM). O sorteio e as paletas moraram aqui e
// foram para shared/world/appearance-flat.ts (o mesmo sorteio serve o escritório e o Habblaud World); este módulo
// re-exporta e guarda o que é só do editor do personagem.
import {
  ACCESSORIES,
  BOTTOM_STYLES,
  FACIAL_HAIR,
  HAIR_STYLES,
  OFFICE_ACCESSORIES,
  OFFICE_BOTTOM_STYLES,
  OFFICE_HAIR_STYLES,
  OFFICE_TOP_STYLES,
  TOP_STYLES,
  type PartKey,
} from '../../../../shared/appearance';
import { colorPalettes, type SeedAppearance } from '../../../../shared/world/appearance-flat';
import type { Appearance } from '../api';
import { tr } from '../../../../shared/i18n';

export { appearanceFromSeed, SKINS } from '../../../../shared/world/appearance-flat';
export type { BottomStyle, FacialHair } from '../../../../shared/world/appearance-flat';

// O formato de shared/world/appearance-flat.ts e o da arte (art/api.ts) não podem se separar.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _sameAppearance: Same<SeedAppearance, Appearance> = true;
void _sameAppearance;

/** Chave estável de uma aparência (para cache de sprites). */
export function appearanceKey(a: Appearance): string {
  return [
    a.skin, a.hair, a.hairStyle, a.eyes, a.top, a.topAccent, a.topStyle, a.bottom, a.shoes, a.accessory,
    a.accessoryColor, a.lanyard ?? '-', a.look, a.facialHair ?? '-', a.bottomStyle ?? '-',
  ].join('|');
}

// ------------------------------------------------------------------ editor do personagem

export type EditorOptions = Readonly<Record<PartKey, readonly string[]>>;

/** Fork Ordahi: `office` traz também as peças só do escritório. O personagem do mundo fica nas listas dele. */
export interface EditorScope {
  office?: boolean;
}

/** Opções de cada peça no editor do personagem, conforme a aparência atual (as cores da roupa dependem do estilo). */
export function editorOptions(a: Appearance, scope: EditorScope = {}): EditorOptions {
  const office = scope.office === true;
  return {
    ...colorPalettes(a),
    hairStyle: office ? [...HAIR_STYLES, ...OFFICE_HAIR_STYLES] : HAIR_STYLES,
    topStyle: office ? [...TOP_STYLES, ...OFFICE_TOP_STYLES] : TOP_STYLES,
    bottomStyle: office ? [...BOTTOM_STYLES, ...OFFICE_BOTTOM_STYLES] : BOTTOM_STYLES,
    accessory: office ? [...ACCESSORIES, ...OFFICE_ACCESSORIES] : ACCESSORIES,
    facialHair: FACIAL_HAIR,
  };
}

const TALL_HAIR: readonly string[] = ['afro', 'bun', 'mohawk', 'pigtails', 'space_buns'];
const SHORT_HAIR: readonly string[] = ['bald', 'buzz'];
const HEADWEAR: readonly string[] = ['cap', 'beanie', 'hat'];

/** Combinação que o sorteio evita (o editor desabilita a opção): devolve o motivo, ou undefined se pode. */
export function editorConflict(a: Appearance, key: PartKey, value: string): string | undefined {
  if (key === 'accessory') {
    if (HEADWEAR.includes(value) && TALL_HAIR.includes(a.hairStyle)) return tr('Não combina com este cabelo');
    if (value === 'bow' && SHORT_HAIR.includes(a.hairStyle)) return tr('Não combina com este cabelo');
  }
  if (key === 'hairStyle') {
    if (HEADWEAR.includes(a.accessory) && TALL_HAIR.includes(value)) return tr('Não combina com o boné ou o gorro');
    if (a.accessory === 'bow' && SHORT_HAIR.includes(value)) return tr('Não combina com o laço');
  }
  return undefined;
}

/**
 * Depois de trocar um estilo: cores que não existem na paleta nova caem na primeira dela. Com cor livre (fork Ordahi),
 * a cor é da pessoa e fica como está.
 */
export function fitToOptions(a: Appearance, scope: EditorScope = {}): Appearance {
  if (scope.office) return a;
  const o = editorOptions(a);
  const fit = (v: string, list: readonly string[]): string => (list.includes(v) ? v : list[0]);
  return { ...a, top: fit(a.top, o.top), topAccent: fit(a.topAccent, o.topAccent), accessoryColor: fit(a.accessoryColor, o.accessoryColor) };
}
