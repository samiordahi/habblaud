// Fork Ordahi: o painel do AIOS embute o escritório; site de fora, nunca.
import { describe, expect, it } from 'vitest';
import { parseFrameAncestors } from './static';

describe('HABBLAUD_FRAME_ANCESTORS', () => {
  it('aceita só origens do próprio computador, sem repetir', () => {
    expect(parseFrameAncestors('http://127.0.0.1:4360 http://localhost:4360/painel/, http://127.0.0.1:4360')).toEqual([
      'http://127.0.0.1:4360',
      'http://localhost:4360',
    ]);
    expect(parseFrameAncestors('https://evil.example http://192.168.0.5:4360 javascript:alert(1) lixo')).toEqual([]);
    expect(parseFrameAncestors(undefined)).toEqual([]);
  });
});
