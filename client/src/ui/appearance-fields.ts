// Peças do personagem (pele, cabelo e estilo, olhos, roupa, calça, sapato, acessório, barba) com a prévia de corpo
// inteiro: o miolo do editor de personagem, usado na gaveta do agente (character-editor.ts) e no personagem do Habblaud
// World (world/settings-world.ts). Quem usa guarda o nome, salva e decide o que mandar; aqui só se escolhe a aparência.
import type { PartKey } from '../../../shared/appearance';
import { characterSprite, editorConflict, editorOptions, fitToOptions } from '../art';
import type { Appearance, Dir } from '../art/api';
import { EDITOR_GROUPS, rowVisible, styleLabel, type EditorRow } from './character-model';
import { ColorPicker } from './color-picker';
import { h } from './dom';
import { tr } from '../../../shared/i18n';

/** Pixels de tela por pixel do personagem na prévia. */
const PREVIEW_SCALE = 4;
const TURN: readonly Dir[] = ['down', 'left', 'up', 'right'];

/** Fork Ordahi: `office` libera as peças próprias e a cor livre. O personagem do mundo fica sem: lá, as listas são fechadas. */
export interface FieldsOptions {
  office?: boolean;
  previewScale?: number;
}

export class AppearanceFields {
  /** Prévia de corpo inteiro (canvas). */
  readonly preview: HTMLCanvasElement;
  /** Grupos de peças (pele, cabelo...), redesenhados a cada escolha. */
  readonly groups: HTMLElement;
  private draft: Appearance | null = null;
  private dir: Dir = 'down';
  /** Linha com o seletor de cor aberto. */
  private colorKey: PartKey | null = null;
  private readonly picker: ColorPicker;

  constructor(
    private readonly onChange: (a: Appearance) => void = () => {},
    private readonly options: FieldsOptions = {},
  ) {
    this.preview = h('canvas', { class: 'ui-char__preview', role: 'img', attrs: { 'aria-label': tr('Prévia do personagem') } });
    this.groups = h('div', { class: 'ui-char__groups' });
    this.picker = new ColorPicker(
      (hex) => this.colorLive(hex),
      () => this.paint(),
    );
  }

  /** Mostra a prévia pelo próximo lado (frente, perfil, costas, outro perfil). */
  turn(): void {
    this.dir = TURN[(TURN.indexOf(this.dir) + 1) % TURN.length];
    if (this.draft) this.drawPreview(this.draft);
  }

  /** Aparência em edição (null antes do primeiro `set`). */
  get value(): Appearance | null {
    return this.draft;
  }

  /** Troca a aparência inteira (começo da edição, "Sortear") e redesenha. */
  set(a: Appearance): void {
    this.draft = a;
    this.colorKey = null;
    this.paint();
  }

  private pick(key: PartKey, value: string): void {
    if (!this.draft) return;
    this.draft = fitToOptions({ ...this.draft, [key]: value }, this.options);
    if (this.colorKey === key) this.picker.set(value);
    this.paint(key);
    this.onChange(this.draft);
  }

  /** Cor mudando no seletor: redesenha só a prévia e a amostra, para não refazer o seletor no meio do arrasto. */
  private colorLive(hex: string): void {
    const key = this.colorKey;
    if (!this.draft || !key) return;
    this.draft = { ...this.draft, [key]: hex };
    this.drawPreview(this.draft);
    this.groups.querySelector<HTMLElement>(`[data-key="${key}"] [aria-checked="true"]`)?.style.setProperty('--swatch', hex);
    this.onChange(this.draft);
  }

  private toggleColor(key: PartKey): void {
    this.colorKey = this.colorKey === key ? null : key;
    if (this.colorKey && this.draft) this.picker.set(this.draft[key] ?? '#000000');
    this.paint();
  }

  /** Redesenha a prévia e as opções; `focusKey` devolve o foco à opção marcada daquela linha. */
  paint(focusKey?: PartKey): void {
    const a = this.draft;
    if (!a) return;
    this.drawPreview(a);
    const options = editorOptions(a, this.options);
    this.groups.replaceChildren(
      ...EDITOR_GROUPS.map((g) =>
        h(
          'fieldset',
          { class: 'ui-char__group' },
          h('legend', { text: g.title }),
          ...g.rows.filter((r) => rowVisible(r, a)).map((r) => this.row(g.title, r, a, options[r.key])),
        ),
      ),
    );
    if (focusKey) this.groups.querySelector<HTMLElement>(`[data-key="${focusKey}"] [aria-checked="true"]`)?.focus();
  }

  private row(group: string, r: EditorRow, a: Appearance, values: readonly string[]): HTMLElement {
    const current = a[r.key] ?? '';
    const isColor = r.kind === 'color';
    const free = isColor && this.options.office === true;
    // Cor livre que está em uso entra na linha, para aparecer marcada.
    const shown = free && current && !values.includes(current) ? [...values, current] : values;
    const buttons = shown.map((v) => {
      const conflict = editorConflict(a, r.key, v);
      const label = isColor ? v : styleLabel(r.key, v);
      return h('button', {
        class: isColor ? 'ui-char__swatch' : 'ui-char__chip',
        type: 'button',
        role: 'radio',
        tabIndex: v === current ? 0 : -1,
        title: conflict ?? label,
        style: isColor ? `--swatch: ${v}` : undefined,
        text: isColor ? undefined : label,
        attrs: { 'aria-checked': String(v === current), 'aria-disabled': conflict ? 'true' : undefined, 'aria-label': isColor ? v : undefined },
        on: { click: () => (conflict ? undefined : this.pick(r.key, v)) },
      });
    });
    if (buttons.length && !buttons.some((b) => b.tabIndex === 0)) buttons[0].tabIndex = 0;
    const list = h(
      'div',
      { class: `ui-char__opts ui-char__opts--${r.kind}`, role: 'radiogroup', attrs: { 'aria-label': `${group}: ${r.label}`, 'data-key': r.key } },
      ...buttons,
    );
    list.addEventListener('keydown', (ev) => this.onRadioKey(ev, buttons, r.key, shown));
    const open = this.colorKey === r.key;
    const more = free
      ? h('button', {
          class: 'ui-char__more',
          type: 'button',
          text: '+',
          title: tr('Escolher qualquer cor'),
          attrs: { 'aria-label': tr('Escolher qualquer cor: {0}', [`${group}, ${r.label}`]), 'aria-expanded': String(open) },
          on: { click: () => this.toggleColor(r.key) },
        })
      : '';
    return h('div', { class: 'ui-char__row' }, h('span', { class: 'ui-char__row-label', text: r.label }), h('div', { class: 'ui-char__line' }, list, more), open ? this.picker.el : '');
  }

  /** Setas mudam a escolha dentro da linha (padrão de radiogroup), pulando opções desabilitadas. */
  private onRadioKey(ev: KeyboardEvent, buttons: HTMLButtonElement[], key: PartKey, values: readonly string[]): void {
    const step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    ev.preventDefault();
    const n = buttons.length;
    const from = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
    for (let i = 1; i < n; i++) {
      const j = (((from + step * i) % n) + n) % n;
      if (buttons[j].getAttribute('aria-disabled') !== 'true') return this.pick(key, values[j]);
    }
  }

  private drawPreview(a: Appearance): void {
    try {
      const s = characterSprite({ appearance: a, dir: this.dir, pose: 'stand', frame: 0 });
      const c = this.preview;
      const scale = this.options.previewScale ?? PREVIEW_SCALE;
      c.width = s.canvas.width * scale;
      c.height = s.canvas.height * scale;
      const g = c.getContext('2d');
      if (!g) return;
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(s.canvas, 0, 0, c.width, c.height);
    } catch (err) {
      // A arte ainda pode estar em construção: o editor continua utilizável sem a prévia.
      console.warn('[ui] falha ao desenhar a prévia do personagem', err);
    }
  }
}
