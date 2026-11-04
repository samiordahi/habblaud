// Identidades fixas (fork Ordahi): um agente é sempre a mesma pessoa, não uma pessoa por sessão.
//
// O Habblaud original sorteia um nome por sessão. Aqui, cada ferramenta (Claude, Codex) pode ter um personagem fixo,
// declarado em <dataDir>/identidades.json. A primeira sessão viva daquela ferramenta veste a identidade (a titular);
// as outras sessões abertas ao mesmo tempo entram como ajudantes dela, cada uma com o próprio terminal, permissões e
// mensagens, que no Habblaud são por sessão. Quando a titular sai, o ajudante mais antigo assume a identidade.
//
// Formato do arquivo:
//   { "identidades": [
//       { "nome": "Cody", "ferramenta": "claude", "look": "m", "seed": 3, "parts": { ...AppearanceParts } },
//       { "nome": "Codex", "ferramenta": "codex", "pasta": "Ordahi AIOS", ... },
//       { "nome": "Tars", "ferramenta": "externo", "chave": "tars", ... },
//       { "nome": "Sofia", "ferramenta": "nenhuma", ... } ] }
// `ferramenta: "externo"` é um agente de fora (Hermes na VPS, server/sources/external.ts), achado pela `chave`.
// `ferramenta: "nenhuma"` é um personagem guardado: existe na tela de Personagens e não entra em nenhuma sala.
// `personalidade` (opcional): { "tracos": [...], "bordao": "...", "amigos": [...], "rivais": [...] }; shared/persona.ts.
// `pasta` (opcional) é um trecho do caminho do projeto, sem diferenciar caixa; a primeira regra que casa vence, então
// regra com pasta vem antes da regra geral da mesma ferramenta. O arquivo é relido quando muda.
import { copyFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { nameKey, parseAppearanceParts, parseCharacterName, parseSeed, type AppearanceParts } from '../../shared/appearance';
import { parseDeclaredPersona, type DeclaredPersona } from '../../shared/persona';
import type { Provider } from '../../shared/types';
import { errMsg, log } from '../log';
import { tr } from '../../shared/i18n';

/** Ferramenta da identidade: as do Habblaud, um agente de fora (fonte externa) ou nenhuma (personagem guardado). */
export type IdentityProvider = Provider | 'external' | 'none';

export interface Identity {
  name: string;
  provider: IdentityProvider;
  /** Só externos: o id do agente na fonte externa (ex.: "tars"), minúsculo. */
  key?: string;
  look: 'f' | 'm';
  seed: number;
  parts?: AppearanceParts;
  persona?: DeclaredPersona;
  /** Trecho do caminho do projeto (minúsculo); ausente = qualquer projeto. */
  path?: string;
  /**
   * Casa da identidade: trecho do caminho (minúsculo) onde ela prefere estar. Havendo sessão viva lá, a titular é uma
   * delas; sessões em outras pastas ficam como ajudantes. Ausente = a primeira sessão que chega.
   */
  home?: string;
}

const PROVIDERS: readonly IdentityProvider[] = ['claude', 'codex', 'external', 'none'];
const ALIASES: Readonly<Record<string, IdentityProvider>> = { externo: 'external', nenhuma: 'none' };

/** Uma entrada do arquivo, ou null se estiver fora do formato (a entrada é ignorada, as outras valem). */
export function parseIdentity(raw: unknown): Identity | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const name = parseCharacterName(v.nome ?? v.name);
  const rawProvider = String(v.ferramenta ?? v.provider ?? '');
  const provider = (ALIASES[rawProvider] ?? rawProvider) as IdentityProvider;
  if (!name || !PROVIDERS.includes(provider)) return null;
  const key = typeof (v.chave ?? v.key) === 'string' ? String(v.chave ?? v.key).trim().toLowerCase() : '';
  if (provider === 'external' && !key) return null;
  const look = v.look === 'f' ? 'f' : 'm';
  const seed = v.seed === undefined ? 0 : parseSeed(v.seed);
  if (seed === null) return null;
  const parts = v.parts === undefined ? {} : parseAppearanceParts(v.parts);
  if (!parts) return null;
  const persona = v.personalidade === undefined ? {} : parseDeclaredPersona(v.personalidade);
  if (!persona) return null;
  const id: Identity = { name, provider, look, seed };
  if (key) id.key = key;
  if (Object.keys(parts).length) id.parts = parts;
  if (Object.keys(persona).length) id.persona = persona;
  const path = v.pasta ?? v.path;
  if (typeof path === 'string' && path.trim()) id.path = path.trim().toLowerCase();
  const home = v.casa ?? v.home;
  if (typeof home === 'string' && home.trim()) id.home = home.trim().toLowerCase();
  return id;
}

export function parseIdentities(raw: unknown): Identity[] {
  const list = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).identidades ?? (raw as Record<string, unknown>).identities : undefined;
  if (!Array.isArray(list)) return [];
  const out: Identity[] = [];
  for (const item of list) {
    const id = parseIdentity(item);
    if (id) out.push(id);
  }
  return out;
}

/** Um personagem no formato do arquivo, que é também o da tela de Personagens. */
export interface CharacterEntry {
  nome: string;
  ferramenta: 'claude' | 'codex' | 'externo' | 'nenhuma';
  chave?: string;
  pasta?: string;
  casa?: string;
  look: 'f' | 'm';
  seed: number;
  parts?: AppearanceParts;
  personalidade?: { tracos?: string[]; bordao?: string; amigos?: string[]; rivais?: string[] };
}

const FILE_PROVIDER: Readonly<Record<IdentityProvider, CharacterEntry['ferramenta']>> = { claude: 'claude', codex: 'codex', external: 'externo', none: 'nenhuma' };

/** Entrada validada no formato do arquivo (pasta e casa com a caixa original), ou null. */
export function toEntry(raw: unknown): CharacterEntry | null {
  const id = parseIdentity(raw);
  if (!id) return null;
  const v = raw as Record<string, unknown>;
  const out: CharacterEntry = { nome: id.name, ferramenta: FILE_PROVIDER[id.provider], look: id.look, seed: id.seed };
  if (id.key) out.chave = id.key;
  const path = v.pasta ?? v.path;
  if (id.path) out.pasta = String(path).trim();
  const home = v.casa ?? v.home;
  if (id.home) out.casa = String(home).trim();
  if (id.parts) out.parts = id.parts;
  const p = id.persona;
  if (p) {
    out.personalidade = {
      ...(p.traits ? { tracos: p.traits } : {}),
      ...(p.catchphrase ? { bordao: p.catchphrase } : {}),
      ...(p.friends ? { amigos: p.friends } : {}),
      ...(p.rivals ? { rivais: p.rivals } : {}),
    };
  }
  return out;
}

export type CharacterChange =
  | { ok: true; list: unknown[]; renamed?: readonly [string, string] }
  | { ok: false; status: 400 | 404 | 409; error: string };

const sameName = (a: string, b: string): boolean => nameKey(a) === nameKey(b);

/** Tira os nomes de `gone` dos vínculos de uma entrada; com `entry`, refaz o vínculo com ela conforme ela declara. */
function syncBonds(other: unknown, gone: readonly string[], entry?: CharacterEntry): unknown {
  const id = parseIdentity(other);
  if (!id) return other;
  const raw = other as Record<string, unknown>;
  const p = { ...((raw.personalidade as Record<string, unknown> | undefined) ?? {}) };
  const keep = (list: unknown): string[] => (Array.isArray(list) ? (list as string[]).filter((n) => !gone.some((g) => sameName(g, n))) : []);
  const friends = keep(p.amigos);
  const rivals = keep(p.rivais);
  if (entry?.personalidade?.amigos?.some((n) => sameName(n, id.name))) friends.push(entry.nome);
  if (entry?.personalidade?.rivais?.some((n) => sameName(n, id.name))) rivals.push(entry.nome);
  delete p.amigos;
  delete p.rivais;
  if (friends.length) p.amigos = friends;
  if (rivals.length) p.rivais = rivals;
  const out = { ...raw };
  if (Object.keys(p).length) out.personalidade = p;
  else delete out.personalidade;
  return out;
}

/** Regra com pasta vem antes da regra geral (a primeira que casa vence); dentro de cada grupo, a ordem fica. */
function withFoldersFirst(list: readonly unknown[]): unknown[] {
  const folder = (e: unknown) => !!parseIdentity(e)?.path;
  return [...list.filter(folder), ...list.filter((e) => !folder(e))];
}

/**
 * Cria ou muda um personagem na lista do arquivo. `previous` é o nome atual dele (ausente = novo). Entrada que estava
 * fora do formato fica como está: a tela não apaga o que não entende.
 */
export function saveCharacter(list: readonly unknown[], previous: string | undefined, raw: unknown): CharacterChange {
  const entry = toEntry(raw);
  if (!entry) return { ok: false, status: 400, error: tr('Personagem fora do formato.') };
  const id = parseIdentity(entry)!;
  const parsed = list.map(parseIdentity);
  const at = previous === undefined ? -1 : parsed.findIndex((p) => p && sameName(p.name, previous));
  if (previous !== undefined && at < 0) return { ok: false, status: 404, error: tr('Esse personagem não existe mais.') };
  for (const [i, p] of parsed.entries()) {
    if (!p || i === at) continue;
    if (sameName(p.name, id.name)) return { ok: false, status: 409, error: tr('Já existe um personagem chamado {0}.', [p.name]) };
    if (id.provider === 'none' || p.provider !== id.provider) continue;
    if (id.provider === 'external' ? p.key === id.key : (p.path ?? '') === (id.path ?? '')) {
      return { ok: false, status: 409, error: tr('Esse agente já é {0}. Mude a ligação dele antes, ou escolha uma pasta.', [p.name]) };
    }
  }
  const before = at >= 0 ? parsed[at]!.name : undefined;
  const gone = [id.name, ...(before ? [before] : [])];
  const next = list.map((e, i) => (i === at ? entry : syncBonds(e, gone, entry)));
  if (at < 0) next.push(entry);
  return { ok: true, list: withFoldersFirst(next), ...(before && before !== id.name ? { renamed: [before, id.name] as const } : {}) };
}

/** Tira o personagem da lista e dos vínculos dos outros. */
export function removeCharacter(list: readonly unknown[], name: string): CharacterChange {
  const at = list.findIndex((e) => {
    const p = parseIdentity(e);
    return !!p && sameName(p.name, name);
  });
  if (at < 0) return { ok: false, status: 404, error: tr('Esse personagem não existe mais.') };
  return { ok: true, list: list.filter((_, i) => i !== at).map((e) => syncBonds(e, [name])) };
}

/** O caminho contém o trecho (sem diferenciar caixa nem barra). */
export function inFolder(cwd: string, fragment: string): boolean {
  return cwd.replace(/\\/g, '/').toLowerCase().includes(fragment.replace(/\\/g, '/').toLowerCase());
}

/** A sessão nesta pasta está na casa da identidade (sem casa declarada, toda pasta conta como casa). */
export function atHome(ident: Identity, cwd: string): boolean {
  return !ident.home || inFolder(cwd, ident.home);
}

/** Identidade de um agente externo pela chave dele. */
export function matchExternal(list: readonly Identity[], key: string): Identity | undefined {
  const k = key.toLowerCase();
  return list.find((i) => i.provider === 'external' && i.key === k);
}

/** Primeira identidade que casa com a ferramenta e o projeto. */
export function matchIdentity(list: readonly Identity[], provider: Provider, cwd: string): Identity | undefined {
  return list.find((i) => i.provider === provider && (!i.path || inFolder(cwd, i.path)));
}

/** Lê <dataDir>/identidades.json e relê quando o arquivo muda (mtime). Sem arquivo = sem identidades fixas. */
export class IdentityFile {
  private list: Identity[] = [];
  private mtime = -1;
  private warned = false;

  constructor(private readonly file: string) {}

  current(): readonly Identity[] {
    let m: number;
    try {
      m = statSync(this.file).mtimeMs;
    } catch {
      this.list = [];
      this.mtime = -1;
      return this.list;
    }
    if (m === this.mtime) return this.list;
    this.mtime = m;
    try {
      this.list = parseIdentities(JSON.parse(readFileSync(this.file, 'utf8')));
      this.warned = false;
      log.info(tr('Identidades fixas: {0} em {1}', [this.list.map((i) => i.name).join(', ') || tr('nenhuma'), this.file]));
    } catch (e) {
      this.list = [];
      if (!this.warned) log.warn(tr('Não consegui ler {0}: {1}', [this.file, errMsg(e)]));
      this.warned = true;
    }
    return this.list;
  }

  match(provider: Provider, cwd: string): Identity | undefined {
    return matchIdentity(this.current(), provider, cwd);
  }

  external(key: string): Identity | undefined {
    return matchExternal(this.current(), key);
  }

  /** Os personagens válidos do arquivo, no formato dele. */
  entries(): CharacterEntry[] {
    return this.readList().list.flatMap((e) => toEntry(e) ?? []);
  }

  /**
   * Muda a lista e grava: arquivo temporário e troca, para uma queda no meio não deixar o arquivo pela metade, com a
   * versão anterior em `.bak`. Arquivo ilegível não é sobrescrito: quem o escreveu à mão decide.
   */
  change(fn: (list: readonly unknown[]) => CharacterChange): CharacterChange {
    let current: { doc: Record<string, unknown>; list: unknown[] };
    try {
      current = this.readList();
    } catch (e) {
      return { ok: false, status: 409, error: tr('Não consegui ler {0}: {1}', [this.file, errMsg(e)]) };
    }
    const result = fn(current.list);
    if (!result.ok) return result;
    const { identities: _alias, ...rest } = current.doc;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ ...rest, identidades: result.list }, null, 2)}\n`, 'utf8');
    if (existsSync(this.file)) copyFileSync(this.file, `${this.file}.bak`);
    renameSync(tmp, this.file);
    this.mtime = -1;
    return result;
  }

  private readList(): { doc: Record<string, unknown>; list: unknown[] } {
    if (!existsSync(this.file)) return { doc: {}, list: [] };
    const doc = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, unknown>;
    const list = doc?.identidades ?? doc?.identities;
    return { doc, list: Array.isArray(list) ? list : [] };
  }
}
