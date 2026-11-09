/** Formats analysis data for display. */
import type { Finding } from '@composelens/shared';

/** Use only the findings in the current image scope and filters. */
export function formatMaxCvssScore(findings: readonly Pick<Finding, 'score'>[]): string {
  const score = findings.reduce<number | null>((highest, finding) => (
    finding.score !== null && (highest === null || finding.score > highest) ? finding.score : highest
  ), null);
  return score === null ? '미제공' : score.toFixed(1);
}

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
