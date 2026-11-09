import { describe, expect, it } from 'vitest';
import { matchesTagFamily, tagFamily } from './tag-family';

describe('numeric browsing families', () => {
  it.each([
    ['3.11', '3.11'], ['3.11.9', '3.11'], ['3.11-slim', '3.11'],
    ['3.11.9-alpine3.20', '3.11'], ['3', '3'], ['v3.11.9', 'v3.11'],
    ['3.11.0rc1-slim', '3.11'], ['latest', null], ['slim', null], ['3.11foo', null],
  ])('derives %s as %s', (tag, expected) => expect(tagFamily(tag)).toBe(expected));

  it('includes patch versions and variants but excludes adjacent numeric prefixes', () => {
    expect(['3.11', '3.11.9', '3.11.10-slim', '3.11-alpine', '3.11.0rc1'].every((tag) => matchesTagFamily(tag, '3.11'))).toBe(true);
    expect(['3.110', '3.14', '13.11', 'other-3.11', '3.11foo'].some((tag) => matchesTagFamily(tag, '3.11'))).toBe(false);
  });
});
