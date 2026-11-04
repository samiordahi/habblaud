// Fork Ordahi: seletor de cor livre do personagem, no visual da sala (o do sistema operacional destoa dela). Quadrado de
// saturação e brilho, faixa de matiz e o código `#rrggbb`. Teclado: setas nos dois controles. As contas estão em
// color-picker-model.ts.
import { hexToHsv, hsvToHex, parseHex, type Hsv } from './color-picker-model';
import { h, setStyleVar } from './dom';
import { tr } from '../../../shared/i18n';

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export class ColorPicker {
  readonly el: HTMLElement;
  private readonly area: HTMLElement;
  private readonly hue: HTMLElement;
  private readonly hex: HTMLInputElement;
  private hsv: Hsv = { h: 0, s: 0, v: 0 };

  /** `onLive` a cada movimento; `onDone` ao soltar ou confirmar o código. */
  constructor(
    private readonly onLive: (hex: string) => void,
    private readonly onDone: (hex: string) => void,
  ) {
    this.area = h('div', {
      class: 'ui-color__area',
      role: 'slider',
      tabIndex: 0,
      attrs: { 'aria-label': tr('Saturação e brilho') },
      on: { keydown: (ev) => this.onAreaKey(ev) },
    });
    this.hue = h('div', {
      class: 'ui-color__hue',
      role: 'slider',
      tabIndex: 0,
      attrs: { 'aria-label': tr('Matiz'), 'aria-valuemin': '0', 'aria-valuemax': '360' },
      on: { keydown: (ev) => this.onHueKey(ev) },
    });
    this.hex = h('input', {
      class: 'ui-color__hex',
      type: 'text',
      attrs: { maxlength: 7, spellcheck: 'false', autocomplete: 'off', 'aria-label': tr('Código da cor') },
      on: {
        input: () => this.onHexInput(),
        keydown: (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            this.commit();
          }
        },
        blur: () => this.sync(),
      },
    });
    this.drag(this.area, (x, y) => {
      this.hsv = { ...this.hsv, s: x, v: 1 - y };
      this.emit();
    });
    this.drag(this.hue, (x) => {
      this.hsv = { ...this.hsv, h: x * 360 };
      this.emit();
    });
    this.el = h('div', { class: 'ui-color' }, this.area, this.hue, this.hex);
  }

  /** Mostra uma cor, sem avisar ninguém. */
  set(hex: string): void {
    this.hsv = hexToHsv(hex, this.hsv.h);
    this.sync();
  }

  private get value(): string {
    return hsvToHex(this.hsv);
  }

  private emit(): void {
    this.sync();
    this.onLive(this.value);
  }

  private commit(): void {
    this.onDone(this.value);
  }

  private sync(): void {
    const { h: hue, s, v } = this.hsv;
    setStyleVar(this.el, '--hue', String(hue));
    setStyleVar(this.el, '--x', `${s * 100}%`);
    setStyleVar(this.el, '--y', `${(1 - v) * 100}%`);
    setStyleVar(this.el, '--h', `${(hue / 360) * 100}%`);
    setStyleVar(this.el, '--pick', this.value);
    this.area.setAttribute('aria-valuetext', this.value);
    this.hue.setAttribute('aria-valuenow', String(Math.round(hue)));
    if (document.activeElement !== this.hex) this.hex.value = this.value;
  }

  private drag(target: HTMLElement, move: (x: number, y: number) => void): void {
    const at = (ev: PointerEvent) => {
      const r = target.getBoundingClientRect();
      move(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
    };
    target.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      target.focus();
      target.setPointerCapture(ev.pointerId);
      at(ev);
    });
    target.addEventListener('pointermove', (ev) => {
      if (target.hasPointerCapture(ev.pointerId)) at(ev);
    });
    target.addEventListener('pointerup', (ev) => {
      if (!target.hasPointerCapture(ev.pointerId)) return;
      target.releasePointerCapture(ev.pointerId);
      this.commit();
    });
  }

  private onAreaKey(ev: KeyboardEvent): void {
    const step = ev.shiftKey ? 0.1 : 0.02;
    const dx = ev.key === 'ArrowRight' ? step : ev.key === 'ArrowLeft' ? -step : 0;
    const dy = ev.key === 'ArrowUp' ? step : ev.key === 'ArrowDown' ? -step : 0;
    if (!dx && !dy) return;
    ev.preventDefault();
    this.hsv = { ...this.hsv, s: clamp(this.hsv.s + dx, 0, 1), v: clamp(this.hsv.v + dy, 0, 1) };
    this.emit();
    this.commit();
  }

  private onHueKey(ev: KeyboardEvent): void {
    const step = ev.shiftKey ? 20 : 4;
    const d = ev.key === 'ArrowRight' || ev.key === 'ArrowUp' ? step : ev.key === 'ArrowLeft' || ev.key === 'ArrowDown' ? -step : 0;
    if (!d) return;
    ev.preventDefault();
    this.hsv = { ...this.hsv, h: clamp(this.hsv.h + d, 0, 360) };
    this.emit();
    this.commit();
  }

  private onHexInput(): void {
    const hex = parseHex(this.hex.value);
    if (!hex) return;
    this.hsv = hexToHsv(hex, this.hsv.h);
    this.sync();
    this.onLive(hex);
  }
}
