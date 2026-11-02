import { Box, Check, ChevronDown, ExternalLink, FileCode2, GitBranch, Github, Globe2, Layers3, LoaderCircle, Monitor, Moon, Shield, Sun, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConnectionView, type Selection } from './components/ConnectionView';
import { EMPTY_FILTERS, FilterBar } from './components/FilterBar';
import { RepositoryForm } from './components/RepositoryForm';
import { VersionPicker } from './components/VersionPicker';
import { VulnerabilityDetail } from './components/VulnerabilityDetail';
import { formatDate, safeExternalUrl } from './domain/format';
import { buildGraph } from './domain/relations';
import type { Filters, ImageState } from './domain/types';
import { useAnalysis } from './hooks/useAnalysis';
import { useTheme } from './hooks/useTheme';

export function App() {
  const analysis = useAnalysis();
  const { theme, cycleTheme } = useTheme();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selection, setSelection] = useState<Selection>(null);
  const [versionImage, setVersionImage] = useState<ImageState | null>(null);

  const fullGraph = useMemo(() => buildGraph(analysis.images, EMPTY_FILTERS), [analysis.images]);
  const graph = useMemo(() => buildGraph(analysis.images, filters), [analysis.images, filters]);
  const selectedVulnerability = selection?.kind === 'vulnerability'
    ? graph.vulnerabilities.find((vulnerability) => vulnerability.id === selection.id) : undefined;
  const completeCount = analysis.images.filter((image) => image.status === 'done' || image.status === 'error').length;
  const availableCount = analysis.images.filter((image) => image.report?.status === 'available').length;
  const attentionCount = analysis.images.filter((image) => image.status === 'error' || (image.report && image.report.status !== 'available')).length;
  const critical = fullGraph.vulnerabilities.filter((node) => node.severity === 'CRITICAL').length;
  const high = fullGraph.vulnerabilities.filter((node) => node.severity === 'HIGH').length;
  const lastRetrieved = analysis.images.flatMap((image) => image.report?.retrievedAt ? [image.report.retrievedAt] : []).sort().at(-1);
  const ThemeIcon = theme === 'system' ? Monitor : theme === 'dark' ? Moon : Sun;
  const themeLabel = theme === 'system' ? '시스템' : theme === 'dark' ? '다크' : '라이트';

  function analyze(repository: string, path: string) {
    setFilters(EMPTY_FILTERS);
    setSelection(null);
    setVersionImage(null);
    void analysis.analyze(repository, path);
  }

  return <>
    <a className="skip-link" href="#analysis-results">분석 결과로 건너뛰기</a>
    <header className="app-header"><div className="header-inner">
      <a className="brand" href="/" aria-label="ComposeLens 홈"><span className="brand-mark"><Layers3 size={23} strokeWidth={1.8} /></span><span>Compose<span className="brand-lens">Lens</span></span></a>
      <span className="header-description">Compose 취약점 탐색기</span>
      <div className="header-actions"><span className="public-badge"><Globe2 size={13} />공개 데이터</span>
        <button className="icon-button theme-button" type="button" onClick={cycleTheme} aria-label={`테마: ${themeLabel}. 다음 테마로 전환`} title={`테마: ${themeLabel}`}><ThemeIcon size={18} /></button>
        <a className="icon-button github-link" href="https://github.com/SH4316/ComposeLens" target="_blank" rel="noreferrer" aria-label="ComposeLens GitHub 소스"><Github size={19} /></a>
      </div>
    </div></header>
    <main className="app-main">
      <RepositoryForm loading={analysis.busy} onAnalyze={analyze} />
      {analysis.error && <div className="analysis-error" role="alert"><TriangleAlert size={19} /><div><strong>Compose 파일을 불러오지 못했습니다</strong><p>{analysis.error}</p></div></div>}
      <section className="results-section" id="analysis-results" aria-label="분석 결과">
        <div className="results-topline"><div className="results-title"><span className="workspace-icon"><GitBranch size={16} /></span><h2>의존 관계 탐색</h2>
          {analysis.busy ? <span className="analysis-status" role="status"><LoaderCircle size={13} className="spin" />{analysis.loadingFile ? 'Compose 읽는 중' : `${completeCount}/${analysis.images.length} 조회 완료`}</span>
            : analysis.source ? <span className="analysis-status done"><Check size={13} />조회 완료</span> : <span className="analysis-status">분석 대기</span>}
        </div>
          {analysis.source && <div className="result-totals"><span><Box size={13} />이미지 <strong>{analysis.images.length}</strong></span><span><Shield size={13} />CVE <strong>{fullGraph.vulnerabilities.length}</strong></span>{critical > 0 && <span className="total-critical">Critical <strong>{critical}</strong></span>}{high > 0 && <span className="total-high">High <strong>{high}</strong></span>}</div>}
        </div>
        {analysis.source && <div className="source-breadcrumb"><Github size={13} /><span>{analysis.source.repository}</span><span className="breadcrumb-slash">/</span><FileCode2 size={13} /><a href={safeExternalUrl(analysis.source.htmlUrl)} target="_blank" rel="noreferrer">{analysis.source.path}<ExternalLink size={11} /></a><span className="branch-label"><GitBranch size={12} />{analysis.source.branch}</span></div>}
        <FilterBar filters={filters} onChange={setFilters} disabled={!analysis.source} />
        {analysis.warnings.length > 0 && <details className="compose-warnings"><summary><TriangleAlert size={14} />설정 확인이 필요한 항목 {analysis.warnings.length}개<ChevronDown size={14} /></summary><ul>{analysis.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
        <ConnectionView graph={graph} sourceLoaded={!!analysis.source} loading={analysis.busy}
          selection={selection} onSelect={setSelection} onVersions={setVersionImage} onRetry={analysis.retryImage} />
        {analysis.source && <div className="coverage-summary"><span>{availableCount}/{analysis.images.length}개 이미지 분석 정보 제공{attentionCount > 0 && ` · ${attentionCount}개 확인 필요`}</span><span>{lastRetrieved ? `최근 조회 ${formatDate(lastRetrieved)}` : '이미지별 결과를 조회하고 있습니다'}</span></div>}
      </section>
      <footer className="app-footer"><p>이미지 참조를 기준으로 Docker Hub·Scout의 기존 분석 정보를 조회합니다.</p><span>버전 미고정 표시와 취약점 심각도는 서로 다른 정보입니다.</span></footer>
    </main>
    {selectedVulnerability && <VulnerabilityDetail vulnerability={selectedVulnerability} onClose={() => setSelection(null)} />}
    {versionImage && <VersionPicker image={versionImage} onClose={() => setVersionImage(null)} onApply={(reference) => {
      analysis.changeReference(versionImage, reference);
      setVersionImage(null);
      setSelection({ kind: 'image', id: versionImage.spec.id });
    }} />}
  </>;
}
