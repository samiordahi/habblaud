// Fork Ordahi: o que a tela de Personagens manda para o arquivo.
import { describe, expect, it } from 'vitest';
import { flattenAppearance } from '../../../shared/world/appearance-flat';
import { PART_KEYS } from '../../../shared/appearance';
import { editorConflict, editorOptions, fitToOptions } from '../art/character/appearance';
import { appearanceFromSeed } from '../art';
import { personaFor } from '../world/social/persona';
import { bondOf, personaOf } from '../world/social/persona';
import { appearanceOf, draftOf, draftProblem, entryOf, folderOf, linkOwner, linkText, newDraft, type CharacterEntry } from './characters-model';
import { hexToHsv, hsvToHex, parseHex } from './color-picker-model';

const CODY: CharacterEntry = { nome: 'Cody', ferramenta: 'claude', look: 'm', seed: 3, parts: { hairStyle: 'short' } };
const TARS: CharacterEntry = { nome: 'Tars', ferramenta: 'externo', chave: 'tars', look: 'f', seed: 1 };

describe('entryOf', () => {
  const a = appearanceOf(CODY);

  it('declara as 13 peças: a aparência fica fixa mesmo trocando a semente', () => {
    const e = entryOf(draftOf(CODY), a);
    expect(Object.keys(e.parts!).sort()).toEqual([...PART_KEYS].sort());
    expect(appearanceOf({ ...e, seed: 999 })).toMatchObject({ hairStyle: 'short', skin: a.skin, top: a.top });
  });

  it('o que não mudou na personalidade segue a semente e não vai para o arquivo', () => {
    expect(entryOf(draftOf(CODY), a).personalidade).toBeUndefined();
  });

  it('traços trocados, bordão e vínculos vão declarados', () => {
    const d = draftOf(CODY);
    d.traits = ['calma', 'leitura'];
    d.bordao = ' Bora! ';
    d.bonds = { Tars: 'amigo', Codex: 'rival' };
    expect(entryOf(d, a).personalidade).toEqual({ tracos: ['calma', 'leitura'], bordao: 'Bora!', amigos: ['Tars'], rivais: ['Codex'] });
  });

  it('ida e volta: o que está no arquivo reabre igual', () => {
    const e: CharacterEntry = { ...CODY, personalidade: { tracos: ['calma', 'leitura'], bordao: 'Bora!', amigos: ['Tars'] } };
    const again = entryOf(draftOf(e), appearanceOf(e));
    expect(again.personalidade).toEqual(e.personalidade);
  });

  it('só leva o que vale para a ligação escolhida', () => {
    const d = { ...draftOf(CODY), ferramenta: 'nenhuma' as const, chave: 'tars', pasta: 'Evolua', casa: 'AIOS' };
    const e = entryOf(d, a);
    expect(e).not.toHaveProperty('chave');
    expect(e).not.toHaveProperty('pasta');
    expect(e).not.toHaveProperty('casa');
  });
});

describe('draftProblem', () => {
  const ok = { ...draftOf(CODY) };

  it('exige nome, 2 ou 3 traços e perfil, levando à aba certa', () => {
    expect(draftProblem(ok)).toBeNull();
    expect(draftProblem({ ...ok, nome: '  ' })?.tab).toBe('look');
    expect(draftProblem({ ...ok, traits: [] })?.tab).toBe('persona');
    expect(draftProblem({ ...ok, traits: ['calma'] })?.tab).toBe('persona');
    expect(draftProblem({ ...ok, ferramenta: 'externo', chave: '' })?.tab).toBe('link');
  });

  it('personagem novo começa com a personalidade da semente, pronta para salvar com nome', () => {
    const d = newDraft(77, 'f');
    expect(d.traits).toEqual(personaFor(77).traits);
    expect(draftProblem({ ...d, nome: 'Sofia' })).toBeNull();
  });
});

describe('linkOwner e linkText', () => {
  const list = [CODY, TARS, { ...CODY, nome: 'Sofia', pasta: 'Evolua' }];

  it('acha quem já ocupa a ligação, sem contar o próprio', () => {
    expect(linkOwner(list, { ferramenta: 'claude', chave: '', pasta: '' })?.nome).toBe('Cody');
    expect(linkOwner(list, { previous: 'Cody', ferramenta: 'claude', chave: '', pasta: '' })).toBeUndefined();
    expect(linkOwner(list, { ferramenta: 'claude', chave: '', pasta: 'EVOLUA' })?.nome).toBe('Sofia');
    expect(linkOwner(list, { ferramenta: 'claude', chave: '', pasta: 'Outra' })).toBeUndefined();
    expect(linkOwner(list, { ferramenta: 'externo', chave: 'tars', pasta: '' })?.nome).toBe('Tars');
    expect(linkOwner(list, { ferramenta: 'nenhuma', chave: '', pasta: '' })).toBeUndefined();
  });

  it('diz quem o personagem é numa linha', () => {
    expect(linkText(TARS, [{ chave: 'tars', nome: 'Tars' }])).toBe('Hermes: Tars');
    expect(linkText({ ferramenta: 'codex', pasta: 'Evolua' }, [])).toBe('Codex em Evolua');
    expect(linkText({ ferramenta: 'nenhuma' }, [])).toBe('Guardado, sem agente');
  });

  it('pasta do projeto é o último nome do caminho', () => {
    expect(folderOf('D:\\Documentos\\Ordahi AIOS')).toBe('Ordahi AIOS');
    expect(folderOf('/home/x/evolua/')).toBe('evolua');
  });
});

describe('personalidade declarada na sala', () => {
  it('sem declaração, é a da semente, o mesmo objeto', () => {
    expect(personaOf({ seed: 3 })).toBe(personaFor(3));
  });

  it('o declarado vence, o resto continua da semente', () => {
    const p = personaOf({ seed: 3, persona: { traits: ['calma', 'esporte'], catchphrase: 'Bora!' } });
    expect(p.traits).toEqual(['calma', 'esporte']);
    expect(p.catchphrase).toBe('Bora!');
    expect(p.skill).toBe(personaFor(3).skill);
  });

  it('vínculo declarado vale de qualquer lado e ganha do acaso', () => {
    const a = { name: 'Cody', seed: 3, persona: { rivals: ['tars'] } };
    const b = { name: 'Tars', seed: 1 };
    expect(bondOf(a, b)).toBe('rivalidade');
    expect(bondOf(b, a)).toBe('rivalidade');
    const c = { name: 'Bella', seed: 6, persona: { friends: ['Codex'] } };
    expect(bondOf({ name: 'Codex', seed: 4 }, c)).toBe('amizade');
  });
});

describe('peças só do escritório', () => {
  const a = appearanceFromSeed(5, { look: 'f' });

  it('o personagem do mundo não vê as peças novas; o do escritório vê', () => {
    expect(editorOptions(a).hairStyle).not.toContain('braids');
    expect(editorOptions(a).accessory).not.toContain('hat');
    expect(editorOptions(a, { office: true }).hairStyle).toContain('braids');
    expect(editorOptions(a, { office: true }).bottomStyle).toContain('long_skirt');
  });

  it('cor livre sobrevive à troca de estilo no escritório e cai na paleta no mundo', () => {
    const free = { ...a, top: '#123456', topStyle: 'jacket' as const };
    expect(fitToOptions(free, { office: true }).top).toBe('#123456');
    expect(fitToOptions(free).top).not.toBe('#123456');
  });

  it('chapéu não combina com coque alto, nos dois sentidos', () => {
    expect(editorConflict({ ...a, hairStyle: 'space_buns' }, 'accessory', 'hat')).toBeTruthy();
    expect(editorConflict({ ...a, accessory: 'hat' }, 'hairStyle', 'bun')).toBeTruthy();
  });

  it('personagem completo do escritório sobe só com peças do mundo', () => {
    const e = entryOf(draftOf(CODY), { ...appearanceOf(CODY), hairStyle: 'dreads', topStyle: 'dress', accessory: 'scarf', hair: '#00ff88' });
    expect(flattenAppearance(11, e.parts, e.look)).toMatchObject({ hairStyle: 'long', topStyle: 'blouse', accessory: 'none' });
  });
});

describe('cor', () => {
  it('lê o código nas formas usuais', () => {
    expect(parseHex('#E78130')).toBe('#e78130');
    expect(parseHex('abc')).toBe('#aabbcc');
    expect(parseHex('#12')).toBeNull();
    expect(parseHex('verde')).toBeNull();
  });

  it('ida e volta entre código e matiz não muda a cor', () => {
    for (const hex of ['#e78130', '#2a6f6b', '#000000', '#ffffff', '#123456', '#f4f4f0']) expect(hsvToHex(hexToHsv(hex))).toBe(hex);
  });

  it('cinza mantém o matiz em que estava', () => {
    expect(hexToHsv('#808080', 200).h).toBe(200);
  });
});
