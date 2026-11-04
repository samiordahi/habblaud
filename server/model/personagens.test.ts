// Fork Ordahi: a tela de Personagens grava em identidades.json e a sala se ajusta sem esperar a próxima sessão.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setQuiet } from '../log';
import { tempDir } from '../test/fixtures';
import { IdentityFile, matchIdentity, parseIdentities, removeCharacter, saveCharacter, toEntry, type Identity } from './identities';
import { NameStore } from './names';
import { Office } from './office';

setQuiet(true);

const CODY = { nome: 'Cody', ferramenta: 'claude', casa: 'Ordahi AIOS', look: 'm', seed: 3, parts: { hairStyle: 'spiky' } };
const CODEX = { nome: 'Codex', ferramenta: 'codex', look: 'm', seed: 4 };
const TARS = { nome: 'Tars', ferramenta: 'externo', chave: 'tars', look: 'f', seed: 1 };

const entries = (r: ReturnType<typeof saveCharacter>) => {
  if (!r.ok) throw new Error(r.error);
  return r.list as Record<string, any>[];
};

describe('saveCharacter', () => {
  it('cria um personagem e devolve no formato do arquivo, com a caixa da pasta', () => {
    const list = entries(saveCharacter([CODY], undefined, { nome: 'Sofia', ferramenta: 'claude', pasta: 'Clientes/Evolua', look: 'f', seed: 9 }));
    expect(list.map((e) => e.nome)).toEqual(['Sofia', 'Cody']);
    expect(list[0].pasta).toBe('Clientes/Evolua');
  });

  it('regra com pasta passa à frente da geral: é a que casa primeiro', () => {
    const list = entries(saveCharacter([CODY, CODEX], undefined, { nome: 'Sofia', ferramenta: 'claude', pasta: 'Evolua', look: 'f', seed: 9 }));
    const ids = parseIdentities({ identidades: list });
    expect(matchIdentity(ids, 'claude', 'D:/Clientes/Evolua')?.name).toBe('Sofia');
    expect(matchIdentity(ids, 'claude', 'D:/Ordahi AIOS')?.name).toBe('Cody');
  });

  it('recusa nome repetido, sem diferenciar caixa', () => {
    const r = saveCharacter([CODY], undefined, { nome: 'cody', ferramenta: 'nenhuma', look: 'm', seed: 1 });
    expect(r).toMatchObject({ ok: false, status: 409 });
  });

  it('recusa dois personagens na mesma ligação: o segundo nunca entraria', () => {
    expect(saveCharacter([CODY], undefined, { nome: 'Outro', ferramenta: 'claude', look: 'm', seed: 1 })).toMatchObject({ ok: false, status: 409 });
    expect(saveCharacter([TARS], undefined, { nome: 'Outra', ferramenta: 'externo', chave: 'TARS', look: 'f', seed: 1 })).toMatchObject({ ok: false, status: 409 });
  });

  it('guardados não disputam ligação', () => {
    const a = { nome: 'A', ferramenta: 'nenhuma', look: 'm', seed: 1 };
    expect(saveCharacter([a], undefined, { nome: 'B', ferramenta: 'nenhuma', look: 'm', seed: 2 }).ok).toBe(true);
  });

  it('muda sem conflitar consigo e avisa do novo nome', () => {
    const r = saveCharacter([CODY, CODEX], 'Cody', { ...CODY, nome: 'Cody Jr' });
    expect(r).toMatchObject({ ok: true, renamed: ['Cody', 'Cody Jr'] });
  });

  it('personagem que sumiu dá 404; formato ruim, 400', () => {
    expect(saveCharacter([CODY], 'Ninguém', CODY)).toMatchObject({ ok: false, status: 404 });
    expect(saveCharacter([CODY], undefined, { nome: 'X', ferramenta: 'claude', look: 'm', seed: -1 })).toMatchObject({ ok: false, status: 400 });
    expect(saveCharacter([CODY], undefined, { nome: 'X', ferramenta: 'externo', look: 'm', seed: 1 })).toMatchObject({ ok: false, status: 400 });
  });

  it('entrada que a tela não entende continua no arquivo', () => {
    const estranho = { nome: 'Velho', ferramenta: 'telepatia' };
    expect(entries(saveCharacter([estranho, CODY], 'Cody', CODY))).toContainEqual(estranho);
  });

  it('vínculo vale nos dois sentidos e se desfaz nos dois', () => {
    const withBond = { ...CODY, personalidade: { amigos: ['Tars'], rivais: ['Codex'] } };
    const list = entries(saveCharacter([CODY, CODEX, TARS], 'Cody', withBond));
    const by = (n: string) => list.find((e) => e.nome === n)!;
    expect(by('Tars').personalidade.amigos).toEqual(['Cody']);
    expect(by('Codex').personalidade.rivais).toEqual(['Cody']);
    const undone = entries(saveCharacter(list, 'Cody', CODY));
    expect(undone.find((e) => e.nome === 'Tars')!.personalidade).toBeUndefined();
  });

  it('renomear leva o vínculo junto', () => {
    const a = { ...CODY, personalidade: { amigos: ['Tars'] } };
    const b = { ...TARS, personalidade: { amigos: ['Cody'] } };
    const list = entries(saveCharacter([a, b], 'Cody', { ...a, nome: 'Cody Jr' }));
    expect(list.find((e) => e.nome === 'Tars')!.personalidade.amigos).toEqual(['Cody Jr']);
  });
});

describe('removeCharacter', () => {
  it('tira da lista e dos vínculos dos outros', () => {
    const a = { ...CODY, personalidade: { amigos: ['Tars'] } };
    const b = { ...TARS, personalidade: { amigos: ['Cody'], bordao: 'É hoje!' } };
    const list = entries(removeCharacter([a, b], 'Cody'));
    expect(list.map((e) => e.nome)).toEqual(['Tars']);
    expect(list[0].personalidade).toEqual({ bordao: 'É hoje!' });
  });
});

describe('personalidade declarada', () => {
  it('lê traços, bordão e vínculos', () => {
    const [id] = parseIdentities({ identidades: [{ ...CODY, personalidade: { tracos: ['leitura', 'fofoca'], bordao: 'Simbora!', amigos: ['Tars'] } }] });
    expect(id.persona).toEqual({ traits: ['leitura', 'fofoca'], catchphrase: 'Simbora!', friends: ['Tars'] });
  });

  it('recusa um traço só, traços que não combinam, bordão longo e quem é amigo e rival', () => {
    for (const personalidade of [{ tracos: ['leitura'] }, { tracos: ['timidez', 'fofoca'] }, { bordao: 'x'.repeat(41) }, { amigos: ['A'], rivais: ['a'] }]) {
      expect(toEntry({ ...CODY, personalidade }), JSON.stringify(personalidade)).toBeNull();
    }
  });
});

describe('IdentityFile.change', () => {
  const file = () => join(tempDir().dir, 'identidades.json');

  it('grava, relê na hora e guarda a versão anterior em .bak', () => {
    const f = file();
    writeFileSync(f, JSON.stringify({ identidades: [CODY], nota: 'minha' }));
    const ids = new IdentityFile(f);
    expect(ids.current().map((i) => i.name)).toEqual(['Cody']);
    const r = ids.change((list) => saveCharacter(list, undefined, CODEX));
    expect(r.ok).toBe(true);
    expect(ids.current().map((i) => i.name)).toEqual(['Cody', 'Codex']);
    expect(JSON.parse(readFileSync(f, 'utf8')).nota).toBe('minha');
    expect(JSON.parse(readFileSync(`${f}.bak`, 'utf8')).identidades).toHaveLength(1);
  });

  it('sem arquivo, cria', () => {
    const f = file();
    expect(new IdentityFile(f).change((list) => saveCharacter(list, undefined, CODY)).ok).toBe(true);
    expect(existsSync(f)).toBe(true);
  });

  it('nunca sobrescreve um arquivo ilegível', () => {
    const f = file();
    writeFileSync(f, '{ quebrado');
    const r = new IdentityFile(f).change((list) => saveCharacter(list, undefined, CODY));
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(readFileSync(f, 'utf8')).toBe('{ quebrado');
  });
});

describe('a sala se ajusta quando o arquivo muda', () => {
  function setup(first: unknown[]) {
    let list: readonly Identity[] = parseIdentities({ identidades: first });
    const office = new Office({
      names: new NameStore(null),
      version: 't',
      startedAt: 1,
      accounts: () => [],
      sources: () => [],
      accountName: () => undefined,
      identity: (provider, cwd) => matchIdentity(list, provider, cwd),
      now: () => 1_000_000,
    });
    return { office, set: (next: unknown[]) => (list = parseIdentities({ identidades: next })) };
  }
  const main = (id: string, cwd: string, at: number) => ({ id, account: 'acc', sessionId: `s-${id}`, cwd, role: 'Agente principal', startedAt: at, status: 'working' as const });

  it('a titular veste o visual e a personalidade novos, sem nova sessão', () => {
    const { office, set } = setup([CODY]);
    office.addMain(main('a', 'D:/Ordahi AIOS', 1));
    set([{ ...CODY, seed: 8, parts: { hairStyle: 'braids' }, personalidade: { bordao: 'Vamos!' } }]);
    office.reconcileIdentities();
    expect(office.get('a')).toMatchObject({ name: 'Cody', seed: 8, parts: { hairStyle: 'braids' }, persona: { catchphrase: 'Vamos!' } });
  });

  it('renomear mantém a titular e leva os ajudantes', () => {
    const { office, set } = setup([CODY]);
    office.addMain(main('a', 'D:/Ordahi AIOS', 1));
    office.addMain(main('b', 'D:/Ordahi AIOS', 2));
    expect(office.get('b')?.helperOf).toBe('Cody');
    set([{ ...CODY, nome: 'Cody Jr' }]);
    office.reconcileIdentities(['Cody', 'Cody Jr']);
    expect(office.get('a')).toMatchObject({ identity: 'Cody Jr', name: 'Cody Jr' });
    expect(office.get('b')?.helperOf).toBe('Cody Jr');
  });

  it('personagem apagado: a titular volta ao sorteio e o ajudante perde o selo', () => {
    const { office, set } = setup([CODY]);
    office.addMain(main('a', 'D:/Ordahi AIOS', 1));
    office.addMain(main('b', 'D:/Ordahi AIOS', 2));
    set([]);
    office.reconcileIdentities();
    expect(office.get('a')?.identity).toBeUndefined();
    expect(office.get('a')?.name).not.toBe('Cody');
    expect(office.get('b')?.helperOf).toBeUndefined();
  });

  it('personagem novo vai para a sessão da pasta dele; as outras seguem com o Cody', () => {
    const { office, set } = setup([CODY]);
    office.addMain(main('a', 'D:/Ordahi AIOS', 1));
    office.addMain(main('b', 'D:/Clientes/Evolua', 2));
    expect(office.get('b')?.helperOf).toBe('Cody');
    set([{ nome: 'Sofia', ferramenta: 'claude', pasta: 'Evolua', look: 'f', seed: 9 }, CODY]);
    office.reconcileIdentities();
    expect(office.get('b')).toMatchObject({ identity: 'Sofia', name: 'Sofia', seed: 9 });
    expect(office.get('b')?.helperOf).toBeUndefined();
    expect(office.get('a')?.identity).toBe('Cody');
  });

  it('identidade nova escolhe a sessão em casa, depois a mais antiga, e as demais viram ajudantes', () => {
    const { office, set } = setup([]);
    office.addMain(main('fora', 'D:/Outro', 1));
    office.addMain(main('casa', 'D:/Ordahi AIOS', 2));
    set([CODY]);
    office.reconcileIdentities();
    expect(office.get('casa')?.identity).toBe('Cody');
    expect(office.get('fora')?.helperOf).toBe('Cody');
  });

  it('personagem guardado não entra em sala nenhuma', () => {
    const { office, set } = setup([]);
    office.addMain(main('a', 'D:/Ordahi AIOS', 1));
    set([{ nome: 'Sofia', ferramenta: 'nenhuma', look: 'f', seed: 9 }]);
    office.reconcileIdentities();
    expect(office.get('a')?.identity).toBeUndefined();
  });
});
