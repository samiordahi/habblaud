// Fork Ordahi: agentes de fora do computador (o Hermes na VPS e os perfis que ele roda: Tars, Bella…) entram no
// escritório por uma ponte HTTP. Quem sabe ler a VPS é o painel do AIOS (`hermes logs -f` por SSH, reduzido a estado,
// ferramenta e hora); o Habblaud só consulta o recorte pronto em HABBLAUD_EXTERNAL_URL, a cada poucos segundos.
//
// Contrato (GET, JSON):
//   { "projeto": "D:\\Documentos\\Ordahi AIOS",
//     "agentes": [ { "id": "tars", "nome": "Tars", "estado": "active" | "idle" | "waiting" | "error",
//                    "atividade": "Auditoria da inbox", "ferramenta": "Hermes", "quando": "2026-11-01T10:02:03Z",
//                    "origem": "VPS" } ],
//     "pedidos": [ { "id": "requests/x.md", "agente": "tars", "titulo": "Enviar cobrança", "texto": "O texto na íntegra",
//                    "tipo": "enviar", "origem": "hermes", "skill": null, "efeitoExterno": true, "quando": "..." } ],
//     "decisao": "/api/pedido" }
// Cada agente vira um principal na sala do `projeto`, com a identidade fixa da `chave` igual ao `id` em
// identidades.json (ferramenta "externo"). Prompt, argumento e saída não fazem parte do contrato: nunca atravessam.
//
// `pedidos` são os arquivos de `requests/` em `estado: esperando`: viram o cartão de aprovação do agente, por cima do
// mesmo registro das permissões. O arquivo continua sendo a verdade: a decisão volta por POST em `decisao`, um caminho
// na mesma origem da ponte, e o pedido só some do cartão quando a origem confirma. Sem `decisao`, o cartão não decide.
import type { Activity, AgentStatus } from '../../shared/types';
import { maskSecrets } from '../../shared/activity';
import { hash32 } from '../../shared/hash';
import { tr } from '../../shared/i18n';
import { errMsg, log } from '../log';
import type { Identity } from '../model/identities';
import type { Office } from '../model/office';
import type { ExternalDecide, ExternalPermission } from '../permissions/registry';

export interface ExternalAgent {
  id: string;
  nome: string;
  estado: 'active' | 'idle' | 'waiting' | 'error';
  atividade?: string;
  ferramenta?: string;
  quando?: string;
  origem?: string;
}

export interface ExternalRequest {
  id: string;
  agente: string;
  titulo: string;
  texto: string;
  tipo: string;
  origem: string;
  skill?: string;
  efeitoExterno: boolean;
  quando?: string;
}

export interface ExternalFeed {
  projeto: string;
  agentes: ExternalAgent[];
  pedidos: ExternalRequest[];
  decisao?: string;
}

/** Quem guarda os pedidos abertos (PermissionRegistry). */
export interface ExternalRequestSink {
  syncExternal(list: readonly ExternalPermission[], decide?: ExternalDecide): void;
}

/** Conta "fantasia" dos externos: não é uma conta do Claude nem do Codex, não tem uso nem terminal. */
export const EXTERNAL_ACCOUNT = 'externo';
const PREFIX = 'ext:';
const MAX_TEXT = 160;
const MAX_REQUESTS = 30;
const MAX_REQUEST_TEXT = 8_000;
const ESTADOS = new Set(['active', 'idle', 'waiting', 'error']);

/** O JSON da ponte, validado; entradas fora do formato são ignoradas (as outras valem). */
export function parseExternalFeed(raw: unknown): ExternalFeed | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.projeto !== 'string' || !v.projeto.trim() || !Array.isArray(v.agentes)) return null;
  const agentes: ExternalAgent[] = [];
  const seen = new Set<string>();
  for (const item of v.agentes) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    const id = typeof a.id === 'string' ? a.id.trim().toLowerCase() : '';
    const nome = typeof a.nome === 'string' ? a.nome.trim() : '';
    if (!/^[a-z0-9_-]{1,60}$/.test(id) || !nome || seen.has(id)) continue;
    seen.add(id);
    const estado = ESTADOS.has(String(a.estado)) ? (a.estado as ExternalAgent['estado']) : 'idle';
    const out: ExternalAgent = { id, nome: nome.slice(0, 40), estado };
    const text = (x: unknown) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, MAX_TEXT) : undefined);
    const atividade = text(a.atividade);
    const ferramenta = text(a.ferramenta);
    const quando = text(a.quando);
    const origem = text(a.origem);
    if (atividade) out.atividade = atividade;
    if (ferramenta) out.ferramenta = ferramenta;
    if (quando) out.quando = quando;
    if (origem) out.origem = origem;
    agentes.push(out);
  }
  const feed: ExternalFeed = { projeto: v.projeto, agentes, pedidos: parseRequests(v.pedidos) };
  if (typeof v.decisao === 'string' && v.decisao.startsWith('/') && !v.decisao.startsWith('//')) feed.decisao = v.decisao;
  return feed;
}

/** Pedidos da ponte, validados; entrada fora do formato fica de fora e as outras valem. */
function parseRequests(raw: unknown): ExternalRequest[] {
  if (!Array.isArray(raw)) return [];
  const out: ExternalRequest[] = [];
  const text = (x: unknown, max: number) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : undefined);
  for (const item of raw.slice(0, MAX_REQUESTS)) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const id = text(r.id, 300);
    const agente = text(r.agente, 60)?.toLowerCase();
    const titulo = text(r.titulo, MAX_TEXT);
    if (!id || !agente || !titulo || out.some((o) => o.id === id)) continue;
    const req: ExternalRequest = {
      id, agente, titulo,
      texto: typeof r.texto === 'string' ? r.texto.slice(0, MAX_REQUEST_TEXT) : '',
      tipo: text(r.tipo, 40) ?? 'outro',
      origem: text(r.origem, 40) ?? 'hermes',
      efeitoExterno: r.efeitoExterno === true,
    };
    const skill = text(r.skill, 80);
    const quando = text(r.quando, 40);
    if (skill) req.skill = skill;
    if (quando) req.quando = quando;
    out.push(req);
  }
  return out;
}

/** O resumo do cartão: o que o pedido faz e quem o escreveu. */
function requestSummary(r: ExternalRequest): { text: string; icon: string } {
  if (r.tipo === 'evoluir') return { icon: '🧠', text: r.skill ? tr('Melhoria proposta na skill {0}', [r.skill]) : tr('Melhoria proposta no sistema') };
  const quem = tr('Pedido de {0}: {1}', [r.origem, r.tipo]);
  return r.efeitoExterno ? { icon: '📤', text: tr('{0}, com efeito fora do sistema', [quem]) } : { icon: '📝', text: quem };
}

const STATUS: Record<ExternalAgent['estado'], AgentStatus> = { active: 'working', idle: 'idle', waiting: 'waiting', error: 'idle' };

export interface ExternalSourceOptions {
  url: string;
  office: Office;
  /** Identidade fixa pela chave (IdentityFile.external). */
  identity: (key: string) => Identity | undefined;
  /** Registro dos pedidos abertos; ausente = os pedidos da ponte não viram cartão. */
  requests?: ExternalRequestSink;
  intervalMs?: number;
  /** Falhas seguidas até os externos saírem do escritório (a ponte caiu, não os agentes). */
  maxFailures?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class ExternalSource {
  private timer: ReturnType<typeof setInterval> | undefined;
  private failures = 0;
  private busy = false;
  /** Último texto de atividade publicado por agente, para não repetir no feed a cada consulta. */
  private readonly lastText = new Map<string, string>();
  private readonly present = new Set<string>();
  /** Fork Ordahi: os agentes do último retrato, para a tela de Personagens oferecer os perfis que existem. */
  private roster: { chave: string; nome: string }[] = [];

  private requests: ExternalRequestSink | undefined;

  constructor(private readonly opts: ExternalSourceOptions) {
    this.requests = opts.requests;
  }

  /** O registro nasce depois da fonte (server/index.ts). */
  attachRequests(sink: ExternalRequestSink): void {
    this.requests = sink;
  }

  /** Leva a decisão à ponte, na origem dela. Devolve o motivo da falha, ou undefined. */
  private async decide(path: string, key: string, behavior: 'allow' | 'deny'): Promise<string | undefined> {
    const doFetch = this.opts.fetchImpl ?? fetch;
    const res = await doFetch(new URL(path, this.opts.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ arquivo: key, decisao: behavior === 'allow' ? 'aprovado' : 'recusado' }),
      signal: AbortSignal.timeout(4_000),
    });
    if (res.ok) return undefined;
    const body = (await res.json().catch(() => null)) as { porque?: unknown } | null;
    return typeof body?.porque === 'string' ? body.porque : `HTTP ${res.status}`;
  }

  start(): void {
    log.info(tr('Agentes externos: lendo {0}', [this.opts.url]));
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.opts.intervalMs ?? 3_000);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const doFetch = this.opts.fetchImpl ?? fetch;
      const res = await doFetch(this.opts.url, { signal: AbortSignal.timeout(4_000), headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const feed = parseExternalFeed(await res.json());
      if (!feed) throw new Error(tr('resposta fora do formato'));
      this.failures = 0;
      log.clearOnce('external');
      this.apply(feed);
    } catch (e) {
      this.failures++;
      log.warnOnce('external', tr('Agentes externos: sem resposta de {0} ({1})', [this.opts.url, errMsg(e)]));
      if (this.failures >= (this.opts.maxFailures ?? 20)) this.apply(null);
    } finally {
      this.busy = false;
    }
  }

  /** Os perfis que a ponte mostrou por último (a chave é o `id` dela). */
  known(): readonly { chave: string; nome: string }[] {
    return this.roster;
  }

  /** O arquivo de identidades mudou: quem está na sala veste a identidade atual, ou volta ao nome da ponte. */
  refreshIdentities(): void {
    for (const a of this.roster) {
      const id = PREFIX + a.chave;
      if (!this.present.has(id)) continue;
      this.opts.office.wearIdentity(id, this.opts.identity(a.chave) ?? { name: a.nome, provider: 'external', key: a.chave, look: 'm', seed: hash32(a.chave) });
    }
  }

  /** Aplica um retrato ao escritório; null = a ponte caiu e todos os externos saem. */
  apply(feed: ExternalFeed | null): void {
    const { office } = this.opts;
    if (feed) this.roster = feed.agentes.map((a) => ({ chave: a.id, nome: a.nome }));
    const now = (this.opts.now ?? Date.now)();
    const live = new Set<string>();
    for (const a of feed?.agentes ?? []) {
      const id = PREFIX + a.id;
      live.add(id);
      const status = STATUS[a.estado];
      const waitingFor = a.estado === 'waiting' ? a.atividade ?? tr('responder ao agente') : undefined;
      if (!office.has(id) || office.get(id)?.status === 'offline') {
        const identity = this.opts.identity(a.id);
        office.addMain({
          id,
          account: EXTERNAL_ACCOUNT,
          sessionId: id,
          cwd: feed!.projeto,
          role: tr('Agente remoto'),
          startedAt: now,
          status,
          ...(waitingFor ? { waitingFor } : {}),
          // Sem identidade declarada, o nome vem da ponte (o agente já é alguém, não um sorteio).
          identity: identity ?? { name: a.nome, provider: 'external', key: a.id, look: 'm', seed: hash32(a.id) },
          remote: a.origem ? `Hermes · ${a.origem}` : 'Hermes',
        });
        this.present.add(id);
      } else {
        office.setStatus(id, status, waitingFor);
      }
      const text = a.atividade;
      if (text && this.lastText.get(id) !== text) {
        this.lastText.set(id, text);
        const at = Date.parse(a.quando ?? '') || now;
        const activity: Activity = {
          id: `${id}#${hash32(`${text}|${a.quando ?? ''}`)}`,
          kind: a.estado === 'error' ? 'error' : 'other',
          icon: a.estado === 'error' ? '⚠️' : a.ferramenta === 'Finance' ? '💰' : '🛰️',
          text,
          at: Math.min(at, now),
          ...(a.ferramenta ? { tool: a.ferramenta } : {}),
          ...(a.estado === 'error' ? { error: true } : {}),
        };
        office.addActivity(id, activity, true, { feed: a.estado !== 'idle' });
      }
    }
    for (const id of [...this.present]) {
      if (live.has(id)) continue;
      office.closeMain(id);
      this.present.delete(id);
      this.lastText.delete(id);
    }
    this.syncRequests(feed);
  }

  /** Pedido cujo agente não está no retrato fica de fora: sem personagem, não há onde mostrar o cartão. */
  private syncRequests(feed: ExternalFeed | null): void {
    if (!this.requests) return;
    const now = (this.opts.now ?? Date.now)();
    const list: ExternalPermission[] = (feed?.pedidos ?? [])
      .filter((r) => this.present.has(PREFIX + r.agente))
      .map((r) => ({
        key: r.id,
        agentId: PREFIX + r.agente,
        title: maskSecrets(r.titulo),
        input: maskSecrets(r.texto),
        createdAt: Date.parse(r.quando ?? '') || now,
        ...requestSummary(r),
      }));
    const path = feed?.decisao;
    this.requests.syncExternal(list, path ? (key, behavior) => this.decide(path, key, behavior) : undefined);
  }
}
