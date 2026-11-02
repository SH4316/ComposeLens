import { ListFilter, Search, X } from 'lucide-react';
import { SEVERITIES, type Severity } from '@composelens/shared';
import type { Filters } from '../domain/types';
import { SEVERITY_LABELS } from './SeverityBadge';

export const EMPTY_FILTERS: Filters = { search: '', severities: [], fix: 'all' };

interface Props {
  filters: Filters;
  onChange: (filters: Filters) => void;
  disabled: boolean;
}

export function FilterBar({ filters, onChange, disabled }: Props) {
  const active = !!filters.search || !!filters.severities.length || filters.fix !== 'all';

  function toggleSeverity(severity: Severity) {
    onChange({ ...filters, severities: filters.severities.includes(severity)
      ? filters.severities.filter((value) => value !== severity)
      : [...filters.severities, severity] });
  }

  return <div className="filter-bar" aria-label="분석 결과 필터">
    <div className="filter-search"><Search size={16} />
      <input aria-label="이미지·CVE·패키지 검색" placeholder="이미지, CVE, 패키지 검색" disabled={disabled}
        value={filters.search} onChange={(event) => onChange({ ...filters, search: event.target.value })} />
      {filters.search && <button className="icon-button small" aria-label="검색어 지우기" onClick={() => onChange({ ...filters, search: '' })}><X size={14} /></button>}
    </div>
    <div className="severity-filters" role="group" aria-label="심각도 필터">
      {SEVERITIES.map((severity) => <button key={severity} type="button"
        className={`severity-filter severity-filter-${severity.toLowerCase()}${filters.severities.includes(severity) ? ' active' : ''}`}
        aria-pressed={filters.severities.includes(severity)} disabled={disabled} onClick={() => toggleSeverity(severity)}>
        <span className="severity-dot" />{SEVERITY_LABELS[severity]}
      </button>)}
    </div>
    <label className="fix-filter"><ListFilter size={15} />
      <select aria-label="수정 버전 필터" value={filters.fix} disabled={disabled}
        onChange={(event) => onChange({ ...filters, fix: event.target.value as Filters['fix'] })}>
        <option value="all">수정 여부 전체</option>
        <option value="available">수정 버전 있음</option>
        <option value="unavailable">수정 버전 미제공</option>
      </select>
    </label>
    {active && <button className="text-button reset-button" onClick={() => onChange(EMPTY_FILTERS)}><X size={14} /> 초기화</button>}
  </div>;
}
