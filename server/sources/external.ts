// Fork Ordahi: agentes de fora do computador (o Hermes na VPS e os perfis que ele roda: Tars, Bella…) entram no
// escritório por uma ponte HTTP. Quem sabe ler a VPS é o painel do AIOS (`hermes logs -f` por SSH, reduzido a estado,
// ferramenta e hora); o Habblaud só consulta o recorte pronto em HABBLAUD_EXTERNAL_URL, a cada poucos segundos.
//
// Contrato (GET, JSON):
//   { "projeto": "D:\\Documentos\\Ordahi AIOS",
//     "agentes": [ { "id": "tars", "nome": "Tars", "estado": "active" | "idle" | "waiting" | "error",
//                    "atividade": "Auditoria da inbox", "ferramenta": "Hermes", "quando": "2026-11-01T10:02:03Z",
//                    "origem": "VPS" } ] }
// Cada agente vira um principal na sala do `projeto`, com a identidade fixa da `chave` igual ao `id` em
// identidades.json (ferramenta "externo"). Prompt, argumento e saída não fazem parte do contrato: nunca atravessam.
import type { Activity, AgentStatus } from '../../shared/types';
import { hash32 } from '../../shared/hash';
import { tr } from '../../shared/i18n';
import { errMsg, log } from '../log';
import type { Identity } from '../model/identities';
import type { Office } from '../model/office';

export interface ExternalAgent {
  id: string;
  nome: string;
  estado: 'active' | 'idle' | 'waiting' | 'error';
  atividade?: string;
  ferramenta?: string;
  quando?: string;
  origem?: string;
}

export interface ExternalFeed {
  projeto: string;
  agentes: ExternalAgent[];
}

/** Conta "fantasia" dos externos: não é uma conta do Claude nem do Codex, não tem uso nem terminal. */
export const EXTERNAL_ACCOUNT = 'externo';
const PREFIX = 'ext:';
const MAX_TEXT = 160;
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
  return { projeto: v.projeto, agentes };
}

const STATUS: Record<ExternalAgent['estado'], AgentStatus> = { active: 'working', idle: 'idle', waiting: 'waiting', error: 'idle' };

export interface ExternalSourceOptions {
  url: string;
  office: Office;
  /** Identidade fixa pela chave (IdentityFile.external). */
  identity: (key: string) => Identity | undefined;
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

  constructor(private readonly opts: ExternalSourceOptions) {}

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

  /** Aplica um retrato ao escritório; null = a ponte caiu e todos os externos saem. */
  apply(feed: ExternalFeed | null): void {
    const { office } = this.opts;
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
  }
}
