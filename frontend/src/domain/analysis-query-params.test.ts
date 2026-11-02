import { describe, expect, it } from 'vitest';
import { analysisLocationUrl, readAnalysisLocation } from './analysis-query-params';

describe('readAnalysisLocation', () => {
  it.each(['', '?theme=dark', '?url=%20%09&compose=%20%09'])('uses defaults when query values are missing or blank: %s', (search) => {
    expect(readAnalysisLocation(search)).toEqual({ repository: '', path: 'compose.yml' });
  });

  it('trims the repository and defaults an omitted Compose path', () => {
    expect(readAnalysisLocation('?url=%20https%3A%2F%2Fgithub.com%2Fowner%2Frepo%20')).toEqual({
      repository: 'https://github.com/owner/repo', path: 'compose.yml',
    });
  });

  it('decodes a shared analysis link and trims surrounding whitespace', () => {
    expect(readAnalysisLocation('?url=https%3A%2F%2Fgithub.com%2Fowner%2Frepo&compose=%20deploy%2Fcompose.yaml%20')).toEqual({
      repository: 'https://github.com/owner/repo', path: 'deploy/compose.yaml',
    });
  });
});

describe('analysisLocationUrl', () => {
  it.each([
    'deploy/compose with spaces.yml',
    '배포/서비스/compose.yml',
    'deploy/a&b#compose.yml',
  ])('round-trips an encoded Compose path without changing its contents: %s', (path) => {
    const input = { repository: 'https://github.com/owner/repo', path };
    const url = new URL(analysisLocationUrl('https://composelens.example/', input));
    expect(readAnalysisLocation(url.search)).toEqual(input);
    expect(url.hash).toBe('');
  });

  it('preserves unrelated parameters, duplicate values, route and hash while replacing the analysis', () => {
    const url = new URL(analysisLocationUrl('https://composelens.example/inspect?theme=dark&tag=a&tag=b&url=old&compose=old#results', {
      repository: ' https://github.com/owner/repo?ref=a&view=b#readme ',
      path: ' deploy/compose.yml ',
    }));
    expect(url.origin + url.pathname).toBe('https://composelens.example/inspect');
    expect(url.hash).toBe('#results');
    expect(url.searchParams.get('theme')).toBe('dark');
    expect(url.searchParams.getAll('tag')).toEqual(['a', 'b']);
    expect(url.searchParams.getAll('url')).toEqual(['https://github.com/owner/repo?ref=a&view=b#readme']);
    expect(url.searchParams.getAll('compose')).toEqual(['deploy/compose.yml']);
  });

  it('writes the default path for a blank input without adding validation', () => {
    const url = new URL(analysisLocationUrl('https://composelens.example/', { repository: ' ', path: '\t ' }));
    expect(url.searchParams.get('url')).toBe('');
    expect(url.searchParams.get('compose')).toBe('compose.yml');
    expect(readAnalysisLocation(url.search)).toEqual({ repository: '', path: 'compose.yml' });
  });
});
