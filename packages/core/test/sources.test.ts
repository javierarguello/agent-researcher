import { describe, it, expect } from 'vitest';
import { normalizeUrl, dedupeSources } from '../src/tools/sources.js';

describe('source url normalization + dedupe', () => {
  it('normalizes host case, www, trailing slash, fragment, tracking params', () => {
    expect(normalizeUrl('https://WWW.Example.com/a/?utm_source=x#frag')).toBe('https://example.com/a');
    expect(normalizeUrl('http://example.com/a/')).toBe('http://example.com/a');
    expect(normalizeUrl('https://example.com/y?utm_medium=e&keep=1')).toBe('https://example.com/y?keep=1');
  });

  it('dedupes by canonical url, keeping first + order, dropping empties', () => {
    const src = [
      { title: 'A', url: 'https://example.com/x', snippet: '' },
      { title: 'A-dup', url: 'https://www.example.com/x/', snippet: '' },
      { title: 'B', url: 'https://example.com/y?utm_source=z', snippet: '' },
      { title: 'B-dup', url: 'https://example.com/y', snippet: '' },
      { title: 'no-url', url: '', snippet: '' },
    ];
    expect(dedupeSources(src).map((s) => s.title)).toEqual(['A', 'B']);
  });
});
