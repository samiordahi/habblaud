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
//       { "nome": "Codex", "ferramenta": "codex", "pasta": "Ordahi AIOS", ... } ] }
// `pasta` (opcional) é um trecho do caminho do projeto, sem diferenciar caixa; a primeira regra que casa vence, então
// regra com pasta vem antes da regra geral da mesma ferramenta. O arquivo é relido quando muda.
import { readFileSync, statSync } from 'node:fs';
import { parseAppearanceParts, parseCharacterName, parseSeed, type AppearanceParts } from '../../shared/appearance';
import type { Provider } from '../../shared/types';
import { errMsg, log } from '../log';
import { tr } from '../../shared/i18n';

export interface Identity {
  name: string;
  provider: Provider;
  look: 'f' | 'm';
  seed: number;
  parts?: AppearanceParts;
  /** Trecho do caminho do projeto (minúsculo); ausente = qualquer projeto. */
  path?: string;
  /**
   * Casa da identidade: trecho do caminho (minúsculo) onde ela prefere estar. Havendo sessão viva lá, a titular é uma
   * delas; sessões em outras pastas ficam como ajudantes. Ausente = a primeira sessão que chega.
   */
  home?: string;
}

const PROVIDERS: readonly Provider[] = ['claude', 'codex'];

/** Uma entrada do arquivo, ou null se estiver fora do formato (a entrada é ignorada, as outras valem). */
export function parseIdentity(raw: unknown): Identity | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const name = parseCharacterName(v.nome ?? v.name);
  const provider = (v.ferramenta ?? v.provider) as Provider;
  if (!name || !PROVIDERS.includes(provider)) return null;
  const look = v.look === 'f' ? 'f' : 'm';
  const seed = v.seed === undefined ? 0 : parseSeed(v.seed);
  if (seed === null) return null;
  const parts = v.parts === undefined ? {} : parseAppearanceParts(v.parts);
  if (!parts) return null;
  const id: Identity = { name, provider, look, seed };
  if (Object.keys(parts).length) id.parts = parts;
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

/** O caminho contém o trecho (sem diferenciar caixa nem barra). */
export function inFolder(cwd: string, fragment: string): boolean {
  return cwd.replace(/\\/g, '/').toLowerCase().includes(fragment.replace(/\\/g, '/').toLowerCase());
}

/** A sessão nesta pasta está na casa da identidade (sem casa declarada, toda pasta conta como casa). */
export function atHome(ident: Identity, cwd: string): boolean {
  return !ident.home || inFolder(cwd, ident.home);
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
}
