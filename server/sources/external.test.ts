// Fork Ordahi: agentes de fora pela ponte do painel do AIOS.
import { describe, expect, it } from 'vitest';
import { setQuiet } from '../log';
import { matchExternal, parseIdentities } from '../model/identities';
import { NameStore } from '../model/names';
import { Office, OFFLINE_GRACE_MS } from '../model/office';
import { PermissionRegistry } from '../permissions/registry';
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

describe('pedidos de requests/ pela ponte', () => {
  const pedido = { id: 'requests/a.md', agente: 'tars', titulo: 'Enviar cobrança', texto: 'Texto na íntegra', tipo: 'enviar', origem: 'hermes', efeitoExterno: true, quando: '2026-11-04T10:00:00Z' };
  const agente = { id: 'tars', nome: 'Tars', estado: 'idle' };

  function ponte(decidir: (corpo: { arquivo: string; decisao: string }) => Response) {
    let clock = 1_000_000;
    const office: Office = new Office({ names: new NameStore(null), version: 't', startedAt: clock, accounts: () => [], sources: () => [], accountName: () => undefined, now: () => clock, permissions: () => registry.snapshot() });
    const registry = new PermissionRegistry({ office, viewers: () => 0, now: () => clock });
    const chamadas: string[] = [];
    let body: unknown = { projeto: 'D:/x', agentes: [agente], pedidos: [pedido], decisao: '/api/pedido' };
    const source = new ExternalSource({
      url: 'http://127.0.0.1:4360/api/agentes-remotos',
      office,
      identity: (key) => matchExternal(IDS, key),
      requests: registry,
      now: () => clock,
      fetchImpl: (async (url: string | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          chamadas.push(String(url));
          return decidir(JSON.parse(String(init.body)));
        }
        return new Response(JSON.stringify(body), { status: 200 });
      }) as typeof fetch,
    });
    return {
      office, registry, chamadas, poll: () => source.poll(),
      setBody: (b: unknown) => { body = b; },
      tick: (ms: number) => { clock += ms; registry.tick(); },
      cartao: () => registry.snapshot().get('ext:tars'),
    };
  }

  it('vira cartão do agente, sem prazo, com o texto só no detalhe', async () => {
    const t = ponte(() => new Response('{}'));
    await t.poll();
    const c = t.cartao()!;
    expect(c).toMatchObject({ external: true, title: 'Enviar cobrança', icon: '📤' });
    expect(c.input).toBeUndefined();
    expect(t.registry.detail(c.id)?.input).toBe('Texto na íntegra');
    expect(t.office.commit().snapshot.agents.find((a) => a.id === 'ext:tars')?.status).toBe('waiting');
    t.tick(30 * 24 * 3_600_000);
    expect(t.cartao()).toBeDefined();
  });

  it('aprovar grava na origem e o cartão não volta com o retrato atrasado', async () => {
    let corpo: unknown;
    const t = ponte((b) => { corpo = b; return new Response('{"ok":true}'); });
    await t.poll();
    expect(await t.registry.decideExternal(t.cartao()!.id, { behavior: 'allow' })).toEqual({ result: 'ok' });
    expect(corpo).toEqual({ arquivo: 'requests/a.md', decisao: 'aprovado' });
    expect(t.chamadas).toEqual(['http://127.0.0.1:4360/api/pedido']);
    expect(t.cartao()).toBeUndefined();
    await t.poll();
    expect(t.cartao()).toBeUndefined();
  });

  it('recusar grava recusado', async () => {
    let corpo: { decisao?: string } = {};
    const t = ponte((b) => { corpo = b; return new Response('{"ok":true}'); });
    await t.poll();
    await t.registry.decideExternal(t.cartao()!.id, { behavior: 'deny' });
    expect(corpo.decisao).toBe('recusado');
  });

  it('origem recusou: o pedido continua aberto e o motivo volta', async () => {
    const t = ponte(() => new Response('{"ok":false,"porque":"este pedido já foi decidido"}', { status: 400 }));
    await t.poll();
    const r = await t.registry.decideExternal(t.cartao()!.id, { behavior: 'allow' });
    expect(r.error).toBe('este pedido já foi decidido');
    expect(t.cartao()).toBeDefined();
  });

  it('sem `decisao` na ponte, ninguém decide', async () => {
    const t = ponte(() => new Response('{}'));
    t.setBody({ projeto: 'D:/x', agentes: [agente], pedidos: [pedido] });
    await t.poll();
    expect((await t.registry.decideExternal(t.cartao()!.id, { behavior: 'allow' })).error).toBeTruthy();
    expect(t.chamadas).toEqual([]);
  });

  it('decidido no painel: some do cartão', async () => {
    const t = ponte(() => new Response('{}'));
    await t.poll();
    t.setBody({ projeto: 'D:/x', agentes: [agente], pedidos: [], decisao: '/api/pedido' });
    await t.poll();
    expect(t.cartao()).toBeUndefined();
  });

  it('só aprovar ou recusar: terminal, interromper e sugestão não valem', async () => {
    const t = ponte(() => new Response('{}'));
    await t.poll();
    const id = t.cartao()!.id;
    for (const d of [{ behavior: 'terminal' }, { behavior: 'deny', interrupt: true }, { behavior: 'allow', suggestion: 0 }] as const) {
      expect((await t.registry.decideExternal(id, d)).result).toBe('unsupported');
    }
    expect(t.chamadas).toEqual([]);
  });

  it('`decisao` que aponta para fora da origem é ignorada', () => {
    expect(parseExternalFeed({ projeto: 'x', agentes: [], decisao: '//evil.test/x' })?.decisao).toBeUndefined();
    expect(parseExternalFeed({ projeto: 'x', agentes: [], decisao: 'http://evil.test/x' })?.decisao).toBeUndefined();
    expect(parseExternalFeed({ projeto: 'x', agentes: [] })?.pedidos).toEqual([]);
  });
});
