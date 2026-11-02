import type { Severity } from '../../../shared/types';

export const SEVERITY_LABELS: Record<Severity, string> = {
  CRITICAL: 'Critical', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low', UNKNOWN: 'Unknown',
};

export function SeverityBadge({ severity, small = false }: { severity: Severity; small?: boolean }) {
  return <span className={`severity severity-${severity.toLowerCase()}${small ? ' severity-small' : ''}`}>
    <span className="severity-dot" />{SEVERITY_LABELS[severity]}
  </span>;
}
