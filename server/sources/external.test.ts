// Fork Ordahi: agentes de fora pela ponte do painel do AIOS.
import { describe, expect, it } from 'vitest';
import { setQuiet } from '../log';
import { matchExternal, parseIdentities } from '../model/identities';
import { NameStore } from '../model/names';
import { Office, OFFLINE_GRACE_MS } from '../model/office';
import { ExternalSource, parseExternalFeed } from './external';

setQuiet(true);

const IDS = parseIdentities({
  identidades: [{ nome: 'Tars', ferramenta: 'externo', chave: 'tars', look: 'f', seed: 1, parts: { hairStyle: 'curly' } }],
});

function setup() {
  let clock = 1_000_000;
  const office = new Office({
    names: new NameStore(null),
    version: 't',
    startedAt: clock,
    accounts: () => [],
    sources: () => [],
    accountName: () => undefined,
    now: () => clock,
  });
  let body: unknown = null;
  let fail = false;
  const source = new ExternalSource({
    url: 'http://127.0.0.1:4360/api/agentes-remotos',
    office,
    identity: (key) => matchExternal(IDS, key),
    maxFailures: 2,
    now: () => clock,
    fetchImpl: (async () => {
      if (fail) throw new Error('ECONNREFUSED');
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch,
  });
  return {
    office,
    source,
    advance: (ms: number) => (clock += ms),
    serve: (b: unknown) => (body = b),
    down: (v: boolean) => (fail = v),
  };
}

const FEED = {
  projeto: 'D:\\Documentos\\Ordahi AIOS',
  agentes: [
    { id: 'tars', nome: 'Tars', estado: 'active', atividade: 'Auditoria da inbox', ferramenta: 'Hermes', origem: 'VPS' },
    { id: 'bella', nome: 'Bella Banker', estado: 'idle', atividade: 'Conciliação do mês', ferramenta: 'Finance', origem: 'GitHub' },
  ],
};

describe('fonte externa', () => {
  it('valida o contrato e descarta entradas fora do formato', () => {
    const feed = parseExternalFeed({
      projeto: '/p',
      agentes: [{ id: 'tars', nome: 'Tars', estado: 'active' }, { id: '../x', nome: 'X' }, { id: 'tars', nome: 'Dup' }, { nome: 'sem id' }, { id: 'ok', nome: 'Ok', estado: 'zzz' }],
    });
    expect(feed?.agentes.map((a) => [a.id, a.estado])).toEqual([['tars', 'active'], ['ok', 'idle']]);
    expect(parseExternalFeed({ agentes: [] })).toBeNull();
  });

  it('cada agente vira um principal na sala do projeto, com identidade fixa e origem', async () => {
    const { office, source, serve } = setup();
    serve(FEED);
    await source.poll();
    const tars = office.get('ext:tars')!;
    expect(tars.name).toBe('Tars');
    expect(tars.identity).toBe('Tars');
    expect(tars.parts).toEqual({ hairStyle: 'curly' });
    expect(tars.status).toBe('working');
    expect(tars.remote).toBe('Hermes · VPS');
    expect(tars.activity?.text).toBe('Auditoria da inbox');
    expect(tars.roomId).toContain('Ordahi AIOS');
    // Sem identidade declarada: o nome vem da ponte, não do sorteio.
    const bella = office.get('ext:bella')!;
    expect(bella.name).toBe('Bella Banker');
    expect(bella.status).toBe('idle');
    expect(bella.remote).toBe('Hermes · GitHub');
  });

  it('atualiza o estado e só publica atividade nova quando o texto muda', async () => {
    const { office, source, serve } = setup();
    serve(FEED);
    await source.poll();
    await source.poll();
    expect(office.get('ext:tars')!.recent.filter((a) => a.text === 'Auditoria da inbox')).toHaveLength(1);
    serve({ ...FEED, agentes: [{ ...FEED.agentes[0], estado: 'waiting', atividade: 'Posso arquivar?' }, FEED.agentes[1]] });
    await source.poll();
    const tars = office.get('ext:tars')!;
    expect(tars.status).toBe('waiting');
    expect(tars.waitingFor).toBe('Posso arquivar?');
  });

  it('quem some do retrato sai do escritório; a ponte caída tira todos depois de N falhas', async () => {
    const { office, source, serve, down, advance } = setup();
    serve(FEED);
    await source.poll();
    serve({ ...FEED, agentes: [FEED.agentes[0]] });
    await source.poll();
    expect(office.get('ext:bella')!.status).toBe('offline');
    down(true);
    await source.poll();
    expect(office.get('ext:tars')!.status).toBe('working');
    await source.poll();
    expect(office.get('ext:tars')!.status).toBe('offline');
    advance(OFFLINE_GRACE_MS + 1);
    office.tick();
    expect(office.has('ext:tars')).toBe(false);
    // A ponte voltou: o Tars chega de novo.
    down(false);
    serve(FEED);
    await source.poll();
    expect(office.get('ext:tars')!.name).toBe('Tars');
  });
});

describe('mesma pasta, mesma sala', () => {
  it('"d:" do VS Code e "D:" da ponte caem na mesma sala', async () => {
    const { office, source, serve } = setup();
    office.addMain({ id: 'acc:1', account: 'acc', sessionId: 's1', cwd: 'd:\\Documentos\\Ordahi AIOS', role: 'x', startedAt: 1, status: 'working' });
    serve(FEED);
    await source.poll();
    expect(office.get('ext:tars')!.roomId).toBe(office.get('acc:1')!.roomId);
  });
});
