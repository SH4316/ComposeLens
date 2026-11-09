/** Numeric tag families are a browsing aid, not evidence of tag history. */
export function tagFamily(tag: string | null | undefined): string | null {
  const match = tag?.match(/^(v?\d+(?:\.\d+)*)(.*)$/);
  if (!match || (match[2] && !/^(?:[._-]|(?:a|b|rc)\d)/.test(match[2]))) return null;
  return match[1].split('.').slice(0, 2).join('.');
}

export function matchesTagFamily(tag: string, family: string): boolean {
  if (!tag.startsWith(family)) return false;
  const remainder = tag.slice(family.length);
  return !remainder || /^(?:[._-]|(?:a|b|rc)\d)/.test(remainder);
}
