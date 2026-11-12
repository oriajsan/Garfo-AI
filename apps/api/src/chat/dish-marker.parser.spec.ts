import { DishMarkerParser } from './dish-marker.parser';

const A = '3b241101-e2bb-4255-8caf-4136c566a962';
const B = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function run(deltas: string[]): { text: string; parser: DishMarkerParser; emitted: string[] } {
  const parser = new DishMarkerParser();
  const emitted = deltas.map((delta) => parser.push(delta));
  emitted.push(parser.flush());
  return { text: emitted.join(''), parser, emitted };
}

const chars = (text: string): string[] => [...text];

describe('DishMarkerParser', () => {
  it('removes a whole marker and collects its id', () => {
    const { text, parser } = run([`Pizza boa [[dish:${A}]] e barata.`]);
    expect(text).toBe('Pizza boa e barata.');
    expect(parser.ids).toEqual([A]);
  });

  it('handles a marker split across two deltas', () => {
    const { text, parser } = run(['Veja [[dis', `h:${A}]] agora`]);
    expect(text).toBe('Veja agora');
    expect(parser.ids).toEqual([A]);
  });

  it('handles one character per delta and never leaks the opener', () => {
    const input = `Opção 1: Salada [[dish:${A}]]. Opção 2: Wrap [[dish:${B}]]!`;
    const { text, parser, emitted } = run(chars(input));
    expect(text).toBe('Opção 1: Salada. Opção 2: Wrap!');
    expect(parser.ids).toEqual([A, B]);
    for (const piece of emitted) expect(piece).not.toContain('[[dish:');
    for (let i = 1; i <= emitted.length; i += 1) {
      expect(emitted.slice(0, i).join('')).not.toMatch(/\[\[?d?i?s?h?:?/);
    }
  });

  it('collects two markers in order, without repeats', () => {
    const { text, parser } = run([`[[dish:${B}]] ou [[dish:${A}]] ou [[dish:${B}]]`]);
    expect(text).toBe('ou ou');
    expect(parser.ids).toEqual([B, A]);
  });

  it('removes a marker at the end of the text', () => {
    const { text } = run(['Peça este ', `[[dish:${A}]]`]);
    expect(text).toBe('Peça este');
  });

  it('collapses spaces around adjacent markers', () => {
    const { text } = run([`A [[dish:${A}]] [[dish:${B}]] b`]);
    expect(text).toBe('A b');
  });

  it('emits a lone bracket and other bracketed text normally', () => {
    expect(run(['preço [x', ' e [[outra coisa]] fim [']).text).toBe(
      'preço [x e [[outra coisa]] fim [',
    );
  });

  it('holds a trailing "[" until the next delta decides', () => {
    const parser = new DishMarkerParser();
    expect(parser.push('oi [')).toBe('oi');
    expect(parser.push('[x]]')).toBe(' [[x]]');
  });

  it('drops a marker with an invalid uuid and counts it', () => {
    const { text, parser } = run(['Veja [[dish:123]] isso']);
    expect(text).toBe('Veja isso');
    expect(parser.ids).toEqual([]);
    expect(parser.malformed).toBe(1);
  });

  it('never emits an unclosed opener, even at the end of the stream', () => {
    expect(run([`Veja [[dish:${A}`]).text).not.toContain('[[dish:');
    expect(run(['Veja [[dish:abc']).text).toBe('Veja abc');
    const long = run([`x [[dish:${'a'.repeat(100)} resto`]);
    expect(long.text).not.toContain('[[dish:');
  });

  it('accepts upper-case uuids and returns them lower-cased', () => {
    const { parser } = run([`[[dish:${A.toUpperCase()}]]`]);
    expect(parser.ids).toEqual([A]);
  });

  it('keeps newlines and markdown untouched', () => {
    const { text } = run([`- **Salada** [[dish:${A}]]\n- **Wrap**`]);
    expect(text).toBe('- **Salada**\n- **Wrap**');
  });

  it('does not touch text without markers', () => {
    expect(run(['Olá, tudo bem?  Dois espaços aqui.']).text).toBe(
      'Olá, tudo bem?  Dois espaços aqui.',
    );
  });
});
