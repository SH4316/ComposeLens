import { ChevronDown, ExternalLink, Github, LoaderCircle, Monitor, Moon, Sun, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConnectionView, type Selection } from './components/ConnectionView';
import { BaseImageHelp } from './components/BaseImageHelp';
import { EMPTY_FILTERS, FilterBar } from './components/FilterBar';
import { HelpTip } from './components/HelpTip';
import { RepositoryForm } from './components/RepositoryForm';
import { VersionPicker } from './components/VersionPicker';
import { VulnerabilityDetail } from './components/VulnerabilityDetail';
import { analysisLocationUrl, readAnalysisLocation } from './domain/analysis-query-params';
import { formatDate } from './domain/display-formatters';
import { safeExternalUrl } from './domain/safe-external-url';
import { buildGraph, focusGraph, imageCveCounts } from './domain/image-vulnerability-graph';
import type { Filters, ImageState } from './domain/analysis-types';
import { useAnalysis } from './hooks/useAnalysis';
import { useTheme } from './hooks/useTheme';

type Screen = 'input' | 'analyzing' | 'results';

export function App() {
  const analysis = useAnalysis();
  const { theme, cycleTheme } = useTheme();
  const [initialLocation] = useState(() => readAnalysisLocation(window.location.search));
  const [screen, setScreen] = useState<Screen>(initialLocation.repository ? 'analyzing' : 'input');
  const [repository, setRepository] = useState(initialLocation.repository);
  const [path, setPath] = useState(initialLocation.path);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [focusedImageId, setFocusedImageId] = useState<string | null>(null);
  const [selectedCveId, setSelectedCveId] = useState<string | null>(null);
  const [openCveId, setOpenCveId] = useState<string | null>(null);
  const [versionImage, setVersionImage] = useState<ImageState | null>(null);
  const mainRef = useRef<HTMLElement>(null);

  const fullGraph = useMemo(() => buildGraph(analysis.images, EMPTY_FILTERS), [analysis.images]);
  const filteredGraph = useMemo(() => buildGraph(analysis.images, filters), [analysis.images, filters]);
  const graph = useMemo(() => focusGraph(filteredGraph, focusedImageId), [filteredGraph, focusedImageId]);
  const totalImageCounts = useMemo(() => imageCveCounts(fullGraph), [fullGraph]);
  const visibleImageCounts = useMemo(() => imageCveCounts(filteredGraph), [filteredGraph]);
  const focusedImage = analysis.images.find((image) => image.spec.id === focusedImageId) ?? null;
  const selectedVulnerability = graph.vulnerabilities.find((node) => node.id === openCveId);
  const selection: Selection = selectedCveId && graph.vulnerabilities.some((node) => node.id === selectedCveId)
    ? { kind: 'vulnerability', id: selectedCveId }
    : focusedImage ? { kind: 'image', id: focusedImage.spec.id } : null;

  const completeCount = analysis.images.filter((image) => image.status === 'done' || image.status === 'error').length;
  const availableCount = analysis.images.filter((image) => image.report?.status === 'available').length;
  const attentionCount = analysis.images.filter((image) => image.status === 'error' || (image.report && image.report.status !== 'available')).length;
  const lastRetrieved = analysis.images.flatMap((image) => image.report?.retrievedAt ? [image.report.retrievedAt] : []).sort().at(-1);
  const scopeTotal = focusedImage ? totalImageCounts.get(focusedImage.spec.id) ?? 0 : fullGraph.vulnerabilities.length;
  const scopeAvailable = !focusedImage || focusedImage.report?.status === 'available';
  const viewKey = JSON.stringify([focusedImageId, focusedImage?.selectedRef, filters]);
  const ThemeIcon = theme === 'system' ? Monitor : theme === 'dark' ? Moon : Sun;
  const themeLabel = theme === 'system' ? '시스템' : theme === 'dark' ? '다크' : '라이트';

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
  }, [screen]);

  useEffect(() => {
    if (!initialLocation.repository) return;
    let active = true;
    void analysis.analyze(initialLocation.repository, initialLocation.path).then((succeeded) => {
      if (active) setScreen(succeeded ? 'results' : 'input');
    });
    return () => { active = false; };
  }, [analysis.analyze, initialLocation]);

  function select(selection: Selection) {
    if (selection?.kind === 'vulnerability') {
      setSelectedCveId(selection.id);
      setOpenCveId(selection.id);
      return;
    }
    setFocusedImageId(selection?.id ?? null);
    setSelectedCveId(null);
    setOpenCveId(null);
  }

  async function analyze(repository: string, path: string) {
    setFilters(EMPTY_FILTERS);
    select(null);
    setVersionImage(null);
    window.history.replaceState(null, '', analysisLocationUrl(window.location.href, { repository, path }));
    setScreen('analyzing');
    const succeeded = await analysis.analyze(repository, path);
    setScreen(succeeded ? 'results' : 'input');
  }

  return <div className="app-shell">
    <main ref={mainRef} tabIndex={-1} className={`app-main screen-${screen}${screen === 'results' ? ' workspace-focused' : ''}`}>
      {screen === 'input' && <div className="input-screen">
        <RepositoryForm repository={repository} path={path} onRepositoryChange={setRepository}
          onPathChange={setPath} onAnalyze={(repository, path) => { void analyze(repository, path); }} />
        {analysis.error && <div className="analysis-error" role="alert">
          <TriangleAlert size={17} /><p>{analysis.error}</p>
        </div>}
      </div>}
      {screen === 'analyzing' && <section className="analysis-progress" role="status" aria-live="polite">
        <LoaderCircle size={26} className="spin progress-indicator" aria-hidden="true" />
        <h1>분석 중</h1>
        <p>{analysis.loadingFile ? '설정 읽는 중' : `${completeCount} / ${analysis.images.length}`}</p>
      </section>}
      {screen === 'results' && analysis.source && <section className="results-section" id="analysis-results" aria-label="분석 결과">
        <div className="results-topline">
          <div className="results-source">
            <h1>{analysis.source.repository}</h1>
            <a href={safeExternalUrl(analysis.source.htmlUrl)} target="_blank" rel="noreferrer">
              <code>{analysis.source.path}</code><ExternalLink size={12} />
            </a>
          </div>
          <span role="status" className={`analysis-status${attentionCount ? ' warning' : ' done'}`}>
            {analysis.busy && <LoaderCircle size={13} className="spin" />}
            {`${analysis.images.length}개 중 ${availableCount}개 분석 제공${attentionCount ? ` · ${attentionCount}개 확인 필요` : ''}`}
          </span>
        </div>
        <FilterBar filters={filters} onChange={setFilters} disabled={false} />
        {analysis.warnings.length > 0 && <details className="compose-warnings">
          <summary><TriangleAlert size={14} />설정 확인 {analysis.warnings.length}개<ChevronDown size={14} /></summary>
          <ul>{analysis.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
        </details>}
        <div className="inspection-summary">
          <div className="selection-context">
            <h3 className="selection-reference">{focusedImage ? `${focusedImage.selectedRef}의 취약점` : '전체 이미지의 취약점'}</h3>
            <p className="inspection-counts" aria-live="polite">
              {scopeAvailable ? `표시 CVE ${graph.vulnerabilities.length}개 / 전체 ${scopeTotal}개`
                : focusedImage?.status === 'idle' || focusedImage?.status === 'loading' ? '조회 중'
                : '분석 정보 없음'}
            </p>
          </div>
          {focusedImage?.spec.origin ? <BaseImageHelp origin={focusedImage.spec.origin} report={focusedImage.report} />
            : focusedImage?.report?.metadata && <HelpTip label="조회 정보" placement="bottom">
            <code>{focusedImage.report.metadata.digest}</code><br />
            {focusedImage.report.metadata.platform}<br />{formatDate(focusedImage.report.retrievedAt)}
          </HelpTip>}
          {focusedImage && <button type="button" className="text-button inspection-clear" onClick={() => select(null)}>전체 보기</button>}
        </div>
        <ConnectionView graph={graph} sourceLoaded loading={analysis.busy}
          selection={selection} focusedImage={focusedImage} visibleImageCounts={visibleImageCounts}
          totalImageCounts={totalImageCounts} viewKey={viewKey} onSelect={select}
          onVersions={setVersionImage} onRetry={analysis.retryImage} />
      </section>}
    </main>
    <footer className="app-footer">
      <span className="footer-brand">ComposeLens</span>
      <div className="footer-actions">
        {screen === 'results' && <button type="button" className="text-button" onClick={() => setScreen('input')}>다시 분석</button>}
        <HelpTip label="데이터 안내" placement="top">
          공개 GitHub 저장소와 Docker Hub·Scout의 기존 분석을 조회합니다.
          분석 미제공·조회 실패는 취약점 0건을 의미하지 않습니다.
          태그는 현재 digest 기준이며, 과거 기록은 관측된 digest로 조회합니다. 취약점은 현재 제공되는 분석입니다.
          점선은 버전 미고정·베이스 기준 연결입니다. 취약점 심각도와 별개입니다.
          {screen === 'results' && lastRetrieved && <><br />조회 {formatDate(lastRetrieved)}</>}
        </HelpTip>
        <button className="icon-button theme-button" type="button" onClick={cycleTheme}
          aria-label={`테마: ${themeLabel}. 다음 테마로 전환`} title={`테마: ${themeLabel}`}><ThemeIcon size={17} /></button>
        <a className="footer-link" href="https://github.com/SH4316/ComposeLens" target="_blank" rel="noreferrer" aria-label="ComposeLens GitHub 소스"><Github size={17} /></a>
      </div>
    </footer>
    {screen === 'results' && selectedVulnerability && <VulnerabilityDetail vulnerability={selectedVulnerability} onClose={() => setOpenCveId(null)} />}
    {screen === 'results' && versionImage && <VersionPicker image={versionImage} onClose={() => setVersionImage(null)} onApply={(reference, history) => {
      analysis.changeReference(versionImage, reference, history);
      select({ kind: 'image', id: versionImage.spec.id });
      setVersionImage(null);
    }} />}
  </div>;
}
