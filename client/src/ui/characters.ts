// Fork Ordahi: tela de Personagens. Cria, muda e apaga os personagens fixos (<dataDir>/identidades.json) sem depender do
// Habblaud World, com o mesmo editor de peças dele e mais o que só existe no escritório: peças próprias, cor livre e
// personalidade declarada. As regras puras estão em characters-model.ts; quem grava é o servidor (GET/PUT
// /api/personagens), e a sala veste a mudança na hora.
import { NAME_MAX, nameKey } from '../../../shared/appearance';
import { CATCHPHRASE_MAX } from '../../../shared/persona';
import { TRAIT_IDS, type TraitId } from '../../../shared/world/protocol';
import { TRAITS } from '../../../shared/world/traits';
import { appearanceFromSeed } from '../art';
import { access } from '../net/access';
import { bondBetween, personaFor } from '../world/social/persona';
import { AppearanceFields } from './appearance-fields';
import { createAvatar } from './avatar';
import {
  appearanceOf,
  draftOf,
  draftProblem,
  entryOf,
  folderOf,
  linkOwner,
  linkText,
  newDraft,
  type BondChoice,
  type CharacterEntry,
  type CharacterList,
  type Draft,
  type DraftTab,
  type Tool,
} from './characters-model';
import type { UiComponent, UiContext } from './context';
import { h, iconButton, setAttr, setHidden, setText } from './dom';
import { ICONS } from './icons';
import { toggleTrait, traitBlock } from './world/world-model';
import { tr } from '../../../shared/i18n';

const randomSeed = (): number => crypto.getRandomValues(new Uint32Array(1))[0];

const TOOLS: readonly [Tool, string][] = [
  ['claude', 'Claude'],
  ['codex', 'Codex'],
  ['externo', tr('Perfil do Hermes')],
  ['nenhuma', tr('Guardado')],
];

const TABS: readonly [DraftTab, string][] = [
  ['look', tr('Aparência')],
  ['persona', tr('Personalidade')],
  ['link', tr('Ligação')],
];

const BONDS: readonly [BondChoice, string][] = [
  ['acaso', tr('Ao acaso')],
  ['amigo', tr('Amizade')],
  ['rival', tr('Rivalidade')],
];

async function errorOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === 'string' ? body.error : tr('Não foi possível salvar o personagem (erro {0}).', [res.status]);
}

export class CharactersDialog implements UiComponent {
  /** Botão da barra do topo. */
  readonly button: HTMLButtonElement;
  readonly el: HTMLDialogElement;
  private data: CharacterList = { personagens: [], perfis: [] };
  private draft: Draft | null = null;
  private tab: DraftTab = 'look';
  private dirty = false;
  private busy = false;
  private confirmingDelete = false;
  /** O que fazer depois de "Descartar" (trocar de personagem, fechar). */
  private pending: (() => void) | null = null;

  private readonly fields = new AppearanceFields(() => this.touch(), { office: true, previewScale: 5 });
  private readonly list = h('ul', { class: 'ui-people__list', attrs: { 'aria-label': tr('Personagens') } });
  private readonly editor: HTMLElement;
  private readonly blank: HTMLElement;
  private readonly title = h('h3', { class: 'ui-people__title' });
  private readonly sub = h('p', { class: 'ui-set__hint' });
  private readonly nameInput: HTMLInputElement;
  private readonly tabs = new Map<DraftTab, HTMLButtonElement>();
  private readonly panels = new Map<DraftTab, HTMLElement>();
  private readonly lookChips = new Map<'f' | 'm', HTMLButtonElement>();
  private readonly personaPanel = h('div', { class: 'ui-people__stack' });
  private readonly linkPanel = h('div', { class: 'ui-people__stack' });
  private readonly error = h('p', { class: 'ui-char__error', role: 'alert', hidden: true });
  private readonly guard: HTMLElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly deleteBtn: HTMLButtonElement;
  private readonly copyBtn: HTMLButtonElement;

  constructor(private readonly ctx: UiContext) {
    this.button = iconButton(ICONS.people, tr('Personagens: criar e editar quem trabalha na sala'), () => this.toggle(), 'ui-btn-people');
    setAttr(this.button, 'aria-haspopup', 'dialog');
    this.button.hidden = true;

    this.nameInput = h('input', {
      class: 'ui-char__name',
      type: 'text',
      attrs: { maxlength: NAME_MAX, autocomplete: 'off', spellcheck: 'false' },
      on: {
        input: () => {
          if (this.draft) this.draft.nome = this.nameInput.value;
          this.touch();
        },
      },
    });
    const rollLook = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Sortear visual'), title: tr('Só as peças; a personalidade fica'), on: { click: () => this.rollLook() } });
    const turn = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Girar'), title: tr('Ver de outro lado'), on: { click: () => this.fields.turn() } });
    const lookGroup = h(
      'div',
      { class: 'ui-char__opts', role: 'radiogroup', attrs: { 'aria-label': tr('Dica visual') } },
      ...([
        ['f', tr('Feminina')],
        ['m', tr('Masculina')],
      ] as const).map(([v, label]) => {
        const b = h('button', { class: 'ui-char__chip', type: 'button', role: 'radio', text: label, on: { click: () => this.setLook(v) } });
        this.lookChips.set(v, b);
        return b;
      }),
    );

    const tablist = h('div', { class: 'ui-people__tabs', role: 'tablist', attrs: { 'aria-label': tr('Partes do personagem') } });
    for (const [id, label] of TABS) {
      const b = h('button', { class: 'ui-people__tab', type: 'button', role: 'tab', text: label, on: { click: () => this.setTab(id) } });
      this.tabs.set(id, b);
      tablist.append(b);
    }
    this.panels.set('look', h('div', { class: 'ui-people__panel', role: 'tabpanel' }, this.fields.groups));
    this.panels.set('persona', h('div', { class: 'ui-people__panel', role: 'tabpanel' }, this.personaPanel));
    this.panels.set('link', h('div', { class: 'ui-people__panel', role: 'tabpanel' }, this.linkPanel));

    this.saveBtn = h('button', { class: 'ui-btn ui-btn--primary', type: 'button', text: tr('Salvar'), on: { click: () => void this.save() } });
    this.copyBtn = h('button', { class: 'ui-btn', type: 'button', text: tr('Duplicar'), title: tr('Começar um personagem novo a partir deste'), on: { click: () => this.duplicate() } });
    this.deleteBtn = h('button', { class: 'ui-link-btn ui-char__reset', type: 'button', text: tr('Apagar'), on: { click: () => void this.remove() } });

    this.guard = h(
      'div',
      { class: 'ui-people__guard', role: 'alert', hidden: true },
      h('span', { text: tr('Há alterações sem salvar.') }),
      h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Continuar editando'), on: { click: () => this.keepEditing() } }),
      h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Descartar'), on: { click: () => this.discard() } }),
    );

    this.editor = h(
      'section',
      { class: 'ui-people__editor', hidden: true },
      h(
        'div',
        { class: 'ui-people__hero' },
        this.fields.preview,
        h(
          'div',
          { class: 'ui-people__who' },
          this.title,
          this.sub,
          h('label', { class: 'ui-char__label' }, h('span', { text: tr('Nome') }), this.nameInput),
          lookGroup,
          h('div', { class: 'ui-people__tools' }, rollLook, turn),
        ),
      ),
      tablist,
      ...this.panels.values(),
      h('footer', { class: 'ui-people__foot' }, this.error, this.guard, h('div', { class: 'ui-char__actions' }, this.saveBtn, this.copyBtn, this.deleteBtn)),
    );
    this.blank = h('p', { class: 'ui-people__blank', text: tr('Escolha um personagem na lista, ou crie um novo.') });

    const add = h('button', { class: 'ui-btn ui-btn--primary', type: 'button', text: tr('Novo personagem'), on: { click: () => this.leaveThen(() => this.startNew()) } });
    const close = iconButton(ICONS.close, tr('Fechar'), () => this.requestClose(), 'ui-icon-btn--sm');
    this.el = h(
      'dialog',
      { class: 'ui-dialog ui-people', attrs: { 'aria-labelledby': 'ui-people-title' } },
      h('div', { class: 'ui-dialog__head' }, h('h2', { text: tr('Personagens'), attrs: { id: 'ui-people-title' } }), close),
      h('div', { class: 'ui-people__body' }, h('aside', { class: 'ui-people__side' }, add, this.list), this.blank, this.editor),
    ) as HTMLDialogElement;
    this.el.addEventListener('cancel', (ev) => {
      ev.preventDefault();
      this.requestClose();
    });
  }

  render(): void {
    const { store } = this.ctx;
    setHidden(this.button, !(store.snapshot?.meta.terminal && access().local) || store.mock || store.replaying);
  }

  get isOpen(): boolean {
    return this.el.open;
  }

  toggle(): void {
    if (this.el.open) this.requestClose();
    else void this.open();
  }

  /** Abre a tela; com `name`, já no personagem (o lápis da gaveta). Sem ele no arquivo, começa um novo com esse agente. */
  async open(name?: string, fromAgentId?: string): Promise<void> {
    if (!this.el.open) this.el.showModal();
    await this.load();
    const entry = name ? this.find(name) : undefined;
    if (entry) this.select(entry);
    else if (name) this.startFromAgent(name, fromAgentId);
    else if (!this.draft) this.paintBlank();
  }

  private find(name: string): CharacterEntry | undefined {
    return this.data.personagens.find((e) => nameKey(e.nome) === nameKey(name));
  }

  private async load(): Promise<void> {
    try {
      const res = await fetch('/api/personagens', { cache: 'no-store' });
      if (!res.ok) throw new Error(await errorOf(res));
      this.data = (await res.json()) as CharacterList;
    } catch (e) {
      this.showError(e instanceof Error ? e.message : tr('Sem conexão com o Habblaud.'));
    }
    this.paintList();
  }

  private paintList(): void {
    const agents = this.ctx.store.snapshot?.agents ?? [];
    this.list.replaceChildren(
      ...this.data.personagens.map((e) => {
        const here = agents.some((a) => a.identity === e.nome && a.status !== 'offline');
        const current = this.draft?.previous !== undefined && nameKey(this.draft.previous) === nameKey(e.nome);
        return h(
          'li',
          {},
          h(
            'button',
            {
              class: 'ui-people__row',
              type: 'button',
              attrs: { 'aria-current': current ? 'true' : undefined, 'data-name': e.nome },
              on: { click: () => this.leaveThen(() => this.select(e)) },
            },
            createAvatar({ seed: e.seed, look: e.look, kind: 'main', parts: e.parts }, 'md'),
            h(
              'span',
              { class: 'ui-people__rowtext' },
              h('strong', { text: e.nome }),
              h('span', { text: linkText(e, this.data.perfis) }),
              here ? h('span', { class: 'ui-people__here', text: tr('Na sala agora') }) : '',
            ),
          ),
        );
      }),
    );
  }

  private paintBlank(): void {
    setHidden(this.blank, false);
    setHidden(this.editor, true);
  }

  private begin(d: Draft, a: ReturnType<typeof appearanceFromSeed>): void {
    this.draft = d;
    this.dirty = false;
    this.confirmingDelete = false;
    this.pending = null;
    setHidden(this.guard, true);
    setText(this.deleteBtn, tr('Apagar'));
    setHidden(this.deleteBtn, d.previous === undefined);
    setHidden(this.copyBtn, d.previous === undefined);
    this.showError(null);
    this.fields.set({ ...a, look: d.look });
    this.nameInput.value = d.nome;
    setHidden(this.blank, true);
    setHidden(this.editor, false);
    this.paintHead();
    this.paintLook();
    this.paintPersona();
    this.paintLink();
    this.setTab(this.tab);
    for (const p of this.panels.values()) p.scrollTop = 0;
    this.paintList();
  }

  private select(e: CharacterEntry): void {
    this.begin(draftOf(e), appearanceOf(e));
  }

  private startNew(): void {
    const seed = randomSeed();
    const look = seed % 2 ? 'm' : 'f';
    this.tab = 'look';
    this.begin(newDraft(seed, look), appearanceFromSeed(seed, { look }));
    this.nameInput.focus();
  }

  /** Agente de fora ainda sem personagem no arquivo (o nome veio da ponte): já começa ligado a ele. */
  private startFromAgent(name: string, agentId?: string): void {
    const agent = agentId ? this.ctx.agent(agentId) : undefined;
    const seed = agent?.seed ?? randomSeed();
    const look = agent?.look ?? 'm';
    const d = newDraft(seed, look);
    d.nome = name;
    if (agent?.remote && agentId?.startsWith('ext:')) {
      d.ferramenta = 'externo';
      d.chave = agentId.slice('ext:'.length);
    }
    this.begin(d, appearanceFromSeed(seed, { look, parts: agent?.parts }));
    this.dirty = true;
  }

  private duplicate(): void {
    const d = this.draft;
    const a = this.fields.value;
    if (!d || !a) return;
    this.leaveThen(() => {
      const copy: Draft = { ...d, previous: undefined, nome: '', ferramenta: 'nenhuma', chave: '', pasta: '', casa: '', bonds: {} };
      this.begin(copy, a);
      this.nameInput.focus();
    });
  }

  private paintHead(): void {
    const d = this.draft;
    if (!d) return;
    setText(this.title, d.previous ?? tr('Novo personagem'));
    setText(this.sub, linkText(d, this.data.perfis));
  }

  private paintLook(): void {
    const look = this.draft?.look;
    for (const [v, b] of this.lookChips) setAttr(b, 'aria-checked', String(v === look));
  }

  private setLook(look: 'f' | 'm'): void {
    const d = this.draft;
    const a = this.fields.value;
    if (!d || !a) return;
    d.look = look;
    this.fields.set({ ...a, look });
    this.paintLook();
    this.touch();
  }

  private rollLook(): void {
    const d = this.draft;
    if (!d) return;
    this.fields.set(appearanceFromSeed(randomSeed(), { look: d.look }));
    this.touch();
  }

  private setTab(tab: DraftTab): void {
    this.tab = tab;
    for (const [id, b] of this.tabs) setAttr(b, 'aria-selected', String(id === tab));
    for (const [id, p] of this.panels) setHidden(p, id !== tab);
  }

  private touch(): void {
    this.dirty = true;
    if (this.confirmingDelete) {
      this.confirmingDelete = false;
      setText(this.deleteBtn, tr('Apagar'));
    }
  }

  // ---------------------------------------------------------------- personalidade

  private paintPersona(): void {
    const d = this.draft;
    if (!d) return;
    const seedPersona = personaFor(d.seed);
    const count = h('span', { class: 'ui-world__count' });
    const chips = new Map<TraitId, HTMLButtonElement>();
    const sync = () => {
      setText(count, tr('{0} de 3', [d.traits.length]));
      for (const [t, b] of chips) {
        const block = traitBlock(d.traits, t);
        setAttr(b, 'aria-pressed', String(d.traits.includes(t)));
        setAttr(b, 'aria-disabled', block ? 'true' : null);
        b.title = block ? (block.reason === 'full' ? tr('Já são 3 traços: desmarque um para trocar.') : tr('Não combina com {0}.', [TRAITS[block.with].label])) : TRAITS[t].desc;
      }
    };
    for (const t of TRAIT_IDS) {
      const info = TRAITS[t];
      const b = h('button', {
        class: 'ui-world__trait-opt',
        type: 'button',
        text: `${info.emoji} ${info.label}`,
        on: {
          click: () => {
            if (b.getAttribute('aria-disabled') === 'true') return;
            d.traits = toggleTrait(d.traits, t);
            this.touch();
            sync();
          },
        },
      });
      chips.set(t, b);
    }
    sync();

    const phrase = h('input', {
      class: 'ui-char__name',
      type: 'text',
      attrs: { maxlength: CATCHPHRASE_MAX, autocomplete: 'off', placeholder: seedPersona.catchphrase },
      on: {
        input: () => {
          d.bordao = phrase.value;
          this.touch();
        },
      },
    });
    phrase.value = d.bordao;

    const others = this.data.personagens.filter((e) => d.previous === undefined || nameKey(e.nome) !== nameKey(d.previous));
    const roll = h('button', {
      class: 'ui-btn ui-btn--sm',
      type: 'button',
      text: tr('Sortear personalidade'),
      title: tr('Troca a semente: traços, bordão e vínculos ao acaso mudam; a aparência fica'),
      on: { click: () => this.rollPersona() },
    });

    this.personaPanel.replaceChildren(
      h(
        'fieldset',
        { class: 'ui-char__group ui-world__traitset' },
        h('legend', {}, tr('Traços'), ' ', count),
        h('p', { class: 'ui-set__hint', text: tr('Escolha 2 ou 3. Eles decidem o que o personagem faz nas horas vagas e com quem se junta.') }),
        h('div', { class: 'ui-world__traitopts', role: 'group', attrs: { 'aria-label': tr('Traços') } }, ...chips.values()),
      ),
      h(
        'fieldset',
        { class: 'ui-char__group' },
        h('legend', { text: tr('Bordão') }),
        h('label', { class: 'ui-char__label' }, h('span', { text: tr('Em branco, fica o da semente, que aparece aqui em cinza.') }), phrase),
      ),
      others.length
        ? h(
            'fieldset',
            { class: 'ui-char__group' },
            h('legend', { text: tr('Amizades e rivalidades') }),
            h('p', { class: 'ui-set__hint', text: tr('Vale para os dois lados. Ao acaso, quem decide é a semente de cada um.') }),
            ...others.map((e) => this.bondRow(d, e)),
          )
        : '',
      h('div', { class: 'ui-people__tools' }, roll),
    );
  }

  private bondRow(d: Draft, other: CharacterEntry): HTMLElement {
    const current = d.bonds[other.nome] ?? 'acaso';
    const natural = bondBetween(d.seed, other.seed);
    const buttons = BONDS.map(([v, label]) =>
      h('button', {
        class: 'ui-char__chip',
        type: 'button',
        role: 'radio',
        text: label,
        title: v === 'acaso' && natural ? tr('Hoje a semente dá: {0}', [natural]) : undefined,
        attrs: { 'aria-checked': String(v === current) },
        on: {
          click: () => {
            if (v === 'acaso') delete d.bonds[other.nome];
            else d.bonds[other.nome] = v;
            this.touch();
            this.paintPersona();
          },
        },
      }),
    );
    return h(
      'div',
      { class: 'ui-char__row' },
      h('span', { class: 'ui-char__row-label', text: other.nome }),
      h('div', { class: 'ui-char__opts', role: 'radiogroup', attrs: { 'aria-label': other.nome } }, ...buttons),
    );
  }

  private rollPersona(): void {
    const d = this.draft;
    if (!d) return;
    d.seed = randomSeed();
    d.traits = [...personaFor(d.seed).traits];
    d.bordao = '';
    this.touch();
    this.paintPersona();
  }

  // ---------------------------------------------------------------- ligação

  private paintLink(): void {
    const d = this.draft;
    if (!d) return;
    const toolChips = TOOLS.map(([v, label]) =>
      h('button', {
        class: 'ui-char__chip',
        type: 'button',
        role: 'radio',
        text: label,
        attrs: { 'aria-checked': String(v === d.ferramenta) },
        on: {
          click: () => {
            d.ferramenta = v;
            this.linkChanged();
          },
        },
      }),
    );
    const blocks: (HTMLElement | string)[] = [
      h(
        'fieldset',
        { class: 'ui-char__group' },
        h('legend', { text: tr('Quem é este personagem') }),
        h('div', { class: 'ui-char__opts', role: 'radiogroup', attrs: { 'aria-label': tr('Agente') } }, ...toolChips),
        h('p', { class: 'ui-set__hint', text: this.linkHint(d.ferramenta) }),
      ),
    ];
    if (d.ferramenta === 'externo') blocks.push(this.profileBlock(d));
    if (d.ferramenta === 'claude' || d.ferramenta === 'codex') blocks.push(this.folderBlock(d));
    const owner = linkOwner(this.data.personagens, d);
    if (owner) blocks.push(h('p', { class: 'ui-char__error', text: tr('Esse agente já é {0}. Mude a ligação dele antes, ou escolha uma pasta.', [owner.nome]) }));
    this.linkPanel.replaceChildren(...blocks);
  }

  private linkHint(tool: Tool): string {
    if (tool === 'nenhuma') return tr('Fica guardado aqui e não entra em nenhuma sala, até você ligar a um agente.');
    if (tool === 'externo') return tr('Um perfil que já roda no Hermes. Perfil novo se cria no Hermes, não aqui.');
    return tr('A primeira sessão veste o personagem. As outras abertas ao mesmo tempo viram ajudantes dele.');
  }

  private profileBlock(d: Draft): HTMLElement {
    const profiles = this.data.perfis;
    const chips = profiles.map((p) => {
      const owner = linkOwner(this.data.personagens, { ...d, chave: p.chave });
      return h('button', {
        class: 'ui-char__chip',
        type: 'button',
        role: 'radio',
        text: p.nome,
        title: owner ? tr('Hoje é {0}', [owner.nome]) : undefined,
        attrs: { 'aria-checked': String(p.chave === d.chave) },
        on: {
          click: () => {
            d.chave = p.chave;
            this.linkChanged();
          },
        },
      });
    });
    return h(
      'fieldset',
      { class: 'ui-char__group' },
      h('legend', { text: tr('Perfil') }),
      profiles.length ? h('div', { class: 'ui-char__opts', role: 'radiogroup', attrs: { 'aria-label': tr('Perfil') } }, ...chips) : h('p', { class: 'ui-set__hint', text: tr('A ponte com o Hermes não mostrou nenhum perfil agora.') }),
    );
  }

  private folderBlock(d: Draft): HTMLElement {
    const folders = [...new Set((this.ctx.store.snapshot?.rooms ?? []).map((r) => folderOf(r.path ?? r.id)))];
    const input = (value: string, label: string, write: (v: string) => void, placeholder: string) => {
      const el = h('input', {
        class: 'ui-char__name',
        type: 'text',
        attrs: { autocomplete: 'off', spellcheck: 'false', placeholder },
        on: {
          input: () => {
            write(el.value);
            this.touch();
            this.paintHead();
          },
          change: () => this.paintLink(),
        },
      });
      el.value = value;
      return h('label', { class: 'ui-char__label' }, h('span', { text: label }), el);
    };
    return h(
      'fieldset',
      { class: 'ui-char__group' },
      h('legend', { text: tr('Onde') }),
      h(
        'div',
        { class: 'ui-char__opts', role: 'radiogroup', attrs: { 'aria-label': tr('Pasta') } },
        h('button', {
          class: 'ui-char__chip',
          type: 'button',
          role: 'radio',
          text: tr('Em qualquer pasta'),
          attrs: { 'aria-checked': String(!d.pasta) },
          on: {
            click: () => {
              d.pasta = '';
              this.linkChanged();
            },
          },
        }),
        ...folders.map((f) =>
          h('button', {
            class: 'ui-char__chip',
            type: 'button',
            role: 'radio',
            text: f,
            attrs: { 'aria-checked': String(d.pasta.toLowerCase() === f.toLowerCase()) },
            on: {
              click: () => {
                d.pasta = f;
                this.linkChanged();
              },
            },
          }),
        ),
      ),
      input(d.pasta, tr('Só nesta pasta (um trecho do caminho)'), (v) => (d.pasta = v), tr('ex.: Evolua')),
      input(d.casa, tr('Casa: onde prefere estar, havendo mais de uma sessão'), (v) => (d.casa = v), tr('opcional')),
    );
  }

  private linkChanged(): void {
    this.touch();
    this.paintHead();
    this.paintLink();
  }

  // ---------------------------------------------------------------- gravar

  private showError(message: string | null): void {
    setText(this.error, message ?? '');
    setHidden(this.error, !message);
  }

  private async save(): Promise<void> {
    const d = this.draft;
    const a = this.fields.value;
    if (this.busy || !d || !a) return;
    const problem = draftProblem(d);
    if (problem) {
      this.setTab(problem.tab);
      return this.showError(problem.message);
    }
    const entry = entryOf(d, a);
    await this.send(
      () =>
        fetch('/api/personagens', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...(d.previous !== undefined ? { anterior: d.previous } : {}), personagem: entry }),
        }),
      async () => {
        await this.load();
        const saved = this.find(entry.nome);
        if (saved) this.select(saved);
        this.ctx.announce(tr('Personagem salvo: {0}.', [entry.nome]));
      },
    );
  }

  private async remove(): Promise<void> {
    const d = this.draft;
    if (this.busy || d?.previous === undefined) return;
    if (!this.confirmingDelete) {
      this.confirmingDelete = true;
      setText(this.deleteBtn, tr('Confirmar: apagar {0}', [d.previous]));
      return;
    }
    const name = d.previous;
    await this.send(
      () => fetch(`/api/personagens/${encodeURIComponent(name)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
      async () => {
        this.draft = null;
        this.dirty = false;
        await this.load();
        this.paintBlank();
        this.ctx.announce(tr('Personagem apagado: {0}.', [name]));
      },
    );
  }

  private async send(request: () => Promise<Response>, done: () => Promise<void>): Promise<void> {
    this.busy = true;
    this.saveBtn.disabled = true;
    this.showError(null);
    try {
      const res = await request();
      if (res.ok) await done();
      else this.showError(await errorOf(res));
    } catch {
      this.showError(tr('Sem conexão com o Habblaud.'));
    }
    this.busy = false;
    this.saveBtn.disabled = false;
  }

  // ---------------------------------------------------------------- sair sem perder o que mudou

  private leaveThen(next: () => void): void {
    if (!this.dirty) return next();
    this.pending = next;
    setHidden(this.guard, false);
  }

  private requestClose(): void {
    this.leaveThen(() => {
      this.draft = null;
      this.dirty = false;
      this.paintBlank();
      this.el.close();
      this.button.focus();
    });
  }

  private keepEditing(): void {
    this.pending = null;
    setHidden(this.guard, true);
  }

  private discard(): void {
    const next = this.pending;
    this.pending = null;
    this.dirty = false;
    setHidden(this.guard, true);
    next?.();
  }
}
