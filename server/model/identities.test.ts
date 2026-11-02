// Fork Ordahi: identidades fixas — um personagem por agente, as sessões em paralelo como ajudantes dele.
import { utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setQuiet } from '../log';
import { tempDir } from '../test/fixtures';
import { IdentityFile, matchIdentity, parseIdentities } from './identities';
import { NameStore } from './names';
import { Office, OFFLINE_GRACE_MS } from './office';

setQuiet(true);

const CODY = { nome: 'Cody', ferramenta: 'claude', look: 'm', seed: 3, parts: { hairStyle: 'spiky', top: '#2a6f6b' } };

function makeOffice(list = parseIdentities({ identidades: [CODY] })) {
  let clock = 1_000_000;
  const office = new Office({
    names: new NameStore(null),
    version: 't',
    startedAt: clock,
    accounts: () => [],
    sources: () => [],
    accountName: () => undefined,
    identity: (provider, cwd) => matchIdentity(list, provider, cwd),
    now: () => clock,
  });
  return { office, advance: (ms: number) => (clock += ms), now: () => clock };
}

const main = (id: string, cwd: string, at: number, provider?: 'codex') => ({
  id,
  account: 'acc',
  sessionId: `s-${id}`,
  cwd,
  role: 'Agente principal',
  startedAt: at,
  status: 'working' as const,
  ...(provider ? { provider } : {}),
});

describe('identidades fixas', () => {
  it('lê o arquivo, ignora entradas fora do formato e casa por ferramenta e pasta', () => {
    const list = parseIdentities({
      identidades: [
        { nome: 'Codex AIOS', ferramenta: 'codex', pasta: 'Ordahi AIOS' },
        { nome: 'Codex', ferramenta: 'codex' },
        { nome: 'Sem ferramenta' },
        { nome: 'Peça errada', ferramenta: 'claude', parts: { asas: true } },
        CODY,
      ],
    });
    expect(list.map((i) => i.name)).toEqual(['Codex AIOS', 'Codex', 'Cody']);
    expect(matchIdentity(list, 'codex', 'D:\\Documentos\\Ordahi AIOS')?.name).toBe('Codex AIOS');
    expect(matchIdentity(list, 'codex', 'D:\\Documentos\\Ortime')?.name).toBe('Codex');
    expect(matchIdentity(list, 'claude', '/qualquer')?.name).toBe('Cody');
  });

  it('a primeira sessão veste o Cody; as outras, em qualquer sala, são ajudantes dele', () => {
    const { office, now } = makeOffice();
    office.addMain(main('a', '/p/aios', now()));
    office.addMain(main('b', '/p/aios', now() + 1));
    office.addMain(main('c', '/p/ortime', now() + 2));
    const a = office.get('a')!;
    expect(a.name).toBe('Cody');
    expect(a.identity).toBe('Cody');
    expect(a.seed).toBe(3);
    expect(a.parts).toEqual({ hairStyle: 'spiky', top: '#2a6f6b' });
    for (const id of ['b', 'c']) {
      const h = office.get(id)!;
      expect(h.helperOf).toBe('Cody');
      expect(h.name).not.toBe('Cody');
      expect(h.identity).toBeUndefined();
    }
  });

  it('ferramenta sem identidade segue no sorteio do Habblaud', () => {
    const { office, now } = makeOffice();
    office.addMain(main('x', '/p/aios', now(), 'codex'));
    const x = office.get('x')!;
    expect(x.identity).toBeUndefined();
    expect(x.helperOf).toBeUndefined();
  });

  it('quando a titular sai, o ajudante mais antigo assume o Cody e os outros continuam ajudantes', () => {
    const { office, advance, now } = makeOffice();
    office.addMain(main('a', '/p/aios', now()));
    office.addMain(main('b', '/p/aios', now() + 5));
    office.addMain(main('c', '/p/aios', now() + 1));
    office.closeMain('a');
    // Durante o período de graça a titular ainda está saindo: ninguém é promovido.
    expect(office.get('c')!.helperOf).toBe('Cody');
    advance(OFFLINE_GRACE_MS + 1);
    office.tick();
    const c = office.get('c')!;
    expect(c.name).toBe('Cody');
    expect(c.identity).toBe('Cody');
    expect(c.helperOf).toBeUndefined();
    expect(c.seed).toBe(3);
    expect(office.get('b')!.helperOf).toBe('Cody');
    expect(office.commit().notices.some((n) => /assumiu como Cody/.test(n.text))).toBe(true);
  });

  it('sessão nova que chega enquanto a titular sai já veste o Cody, sem promoção dupla', () => {
    const { office, advance, now } = makeOffice();
    office.addMain(main('a', '/p/aios', now()));
    office.addMain(main('b', '/p/aios', now() + 1));
    office.closeMain('a');
    office.addMain(main('d', '/p/aios', now() + 2));
    expect(office.get('d')!.identity).toBe('Cody');
    advance(OFFLINE_GRACE_MS + 1);
    office.tick();
    expect(office.get('b')!.helperOf).toBe('Cody');
    expect(office.get('d')!.name).toBe('Cody');
  });

  it('com casa: a titular fora de casa cede o Cody à primeira sessão em casa e vira ajudante', () => {
    const { office, now } = makeOffice(parseIdentities({ identidades: [{ ...CODY, casa: 'Ordahi AIOS' }] }));
    office.addMain(main('teste', 'C:\\Temp\\cliente-simulado', now()));
    expect(office.get('teste')!.identity).toBe('Cody');
    office.addMain(main('aios', 'D:\\Documentos\\Ordahi AIOS', now() + 1));
    const aios = office.get('aios')!;
    const teste = office.get('teste')!;
    expect(aios.name).toBe('Cody');
    expect(aios.identity).toBe('Cody');
    expect(teste.identity).toBeUndefined();
    expect(teste.helperOf).toBe('Cody');
    expect(teste.name).not.toBe('Cody');
    expect(teste.parts).toBeUndefined();
    // Uma segunda sessão em casa não tira o Cody de quem já está em casa.
    office.addMain(main('aios2', 'D:\\Documentos\\Ordahi AIOS', now() + 2));
    expect(office.get('aios2')!.helperOf).toBe('Cody');
    expect(office.get('aios')!.identity).toBe('Cody');
  });

  it('com casa: na saída da titular, o ajudante em casa assume antes do mais antigo de fora', () => {
    const { office, advance, now } = makeOffice(parseIdentities({ identidades: [{ ...CODY, casa: 'Ordahi AIOS' }] }));
    office.addMain(main('aios', 'D:\\Documentos\\Ordahi AIOS', now()));
    office.addMain(main('fora', 'D:\\Documentos\\Ortime', now() + 1));
    office.addMain(main('aios2', 'D:\\Documentos\\Ordahi AIOS', now() + 2));
    office.closeMain('aios');
    advance(OFFLINE_GRACE_MS + 1);
    office.tick();
    expect(office.get('aios2')!.identity).toBe('Cody');
    expect(office.get('fora')!.helperOf).toBe('Cody');
  });

  it('IdentityFile relê o arquivo quando ele muda e some sem ele', () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 'identidades.json');
      const f = new IdentityFile(file);
      expect(f.current()).toEqual([]);
      writeFileSync(file, JSON.stringify({ identidades: [CODY] }));
      expect(f.match('claude', '/p')?.name).toBe('Cody');
      writeFileSync(file, '{ quebrado');
      utimesSync(file, new Date(), new Date(Date.now() + 5_000)); // mtime garantidamente novo
      expect(f.current()).toEqual([]);
    } finally {
      tmp.cleanup();
    }
  });
});
