export function shortDigest(digest: string) {
  return `${digest.slice(0, 19)}…`;
}

export function formatBytes(bytes: number | null) {
  if (bytes === null) return '크기 미제공';
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDate(value: string | null) {
  if (!value) return '시각 미제공';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '시각 미제공' : new Intl.DateTimeFormat('ko-KR', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

export function safeExternalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}
