import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowRight, Box, GitFork, ScanLine, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ImageState, RelationGraph } from '../domain/types';
import { ImageRow } from './ImageRow';
import { VulnerabilityRow } from './VulnerabilityRow';

export type Selection = { kind: 'image' | 'vulnerability'; id: string } | null;

interface Props {
  graph: RelationGraph;
  sourceLoaded: boolean;
  loading: boolean;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  onVersions: (image: ImageState) => void;
  onRetry: (image: ImageState) => void;
}

interface Segment { id: string; path: string; highlighted: boolean; uncertain: boolean }

function emptyVulnerabilityState(graph: RelationGraph, sourceLoaded: boolean, loading: boolean) {
  if (loading) return { title: '이미지의 취약점을 조회하고 있습니다', description: '결과가 도착하는 대로 연결을 표시합니다.' };
  if (!sourceLoaded) return { title: '이미지에 연결된 취약점을 찾아요', description: '알려진 CVE와 영향을 받는 패키지를\n이미지별 연결로 확인할 수 있습니다.' };
  if (!graph.images.length) return { title: '필터에 일치하는 취약점이 없습니다', description: '필터를 변경해 다른 연결을 살펴보세요.' };
  const available = graph.images.filter((image) => image.report?.status === 'available').length;
  if (available === graph.images.length) return { title: '조회된 취약점이 없습니다', description: '현재 필터 또는 분석 결과에 해당하는 CVE가 없습니다.' };
  return { title: available ? '제공된 분석에 표시할 취약점이 없습니다' : '표시할 취약점 정보가 없습니다', description: '이미지의 조회 상태와 안내를 확인해주세요.\n정보 미제공은 취약점 0건을 의미하지 않습니다.' };
}

function visibleAnchors(container: HTMLElement, selector: string, attribute: string, side: 'left' | 'right', origin: DOMRect) {
  const bounds = container.getBoundingClientRect();
  const anchors = new Map<string, { x: number; y: number }>();
  container.querySelectorAll<HTMLElement>(selector).forEach((element) => {
    const rectangle = element.getBoundingClientRect();
    const center = rectangle.top + rectangle.height / 2;
    if (center < bounds.top || center > bounds.bottom) return;
    const id = element.getAttribute(attribute);
    if (id) anchors.set(id, { x: rectangle[side] - origin.left, y: center - origin.top });
  });
  return anchors;
}

export function ConnectionView({ graph, sourceLoaded, loading, selection, onSelect, onVersions, onRetry }: Props) {
  const boardRef = useRef<HTMLDivElement>(null);
  const imageScroll = useRef<HTMLDivElement>(null);
  const vulnerabilityScroll = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const markerId = useId().replaceAll(':', '');

  const imageVirtualizer = useVirtualizer({
    count: graph.images.length, getScrollElement: () => imageScroll.current,
    estimateSize: () => 184, gap: 12, overscan: 3, getItemKey: (index) => graph.images[index].spec.id,
  });
  const vulnerabilityVirtualizer = useVirtualizer({
    count: graph.vulnerabilities.length, getScrollElement: () => vulnerabilityScroll.current,
    estimateSize: () => 108, gap: 10, overscan: 4, getItemKey: (index) => graph.vulnerabilities[index].id,
  });
  const imageRows = imageVirtualizer.getVirtualItems();
  const vulnerabilityRows = vulnerabilityVirtualizer.getVirtualItems();
  const imageRange = imageRows.map((row) => `${row.key}:${row.start}`).join(',');
  const vulnerabilityRange = vulnerabilityRows.map((row) => `${row.key}:${row.start}`).join(',');

  const edgeSelected = useCallback((imageId: string, vulnerabilityId: string) => !!selection && (
    selection.kind === 'image' ? selection.id === imageId : selection.id === vulnerabilityId
  ), [selection]);

  const measure = useCallback(() => {
    const board = boardRef.current;
    const left = imageScroll.current;
    const right = vulnerabilityScroll.current;
    if (!board || !left || !right) return;
    const origin = board.getBoundingClientRect();
    const images = visibleAnchors(left, '[data-image-id]', 'data-image-id', 'right', origin);
    const vulnerabilities = visibleAnchors(right, '[data-vulnerability-id]', 'data-vulnerability-id', 'left', origin);
    setSegments(graph.edges.flatMap((edge) => {
      const from = images.get(edge.imageId);
      const to = vulnerabilities.get(edge.vulnerabilityId);
      if (!from || !to) return [];
      const bend = Math.max(28, (to.x - from.x) * .48);
      return [{ id: edge.id, uncertain: edge.uncertain, highlighted: edgeSelected(edge.imageId, edge.vulnerabilityId),
        path: `M ${from.x + 1} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x - 3} ${to.y}` }];
    }));
  }, [graph.edges, edgeSelected]);

  const scheduleMeasure = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => { frame.current = null; measure(); });
  }, [measure]);

  useLayoutEffect(scheduleMeasure, [scheduleMeasure, imageRange, vulnerabilityRange]);
  useEffect(() => {
    const observer = new ResizeObserver(scheduleMeasure);
    if (boardRef.current) observer.observe(boardRef.current);
    return () => { observer.disconnect(); if (frame.current !== null) cancelAnimationFrame(frame.current); };
  }, [scheduleMeasure]);

  const relatedImages = new Set(graph.edges.filter((edge) => edgeSelected(edge.imageId, edge.vulnerabilityId)).map((edge) => edge.imageId));
  const relatedVulnerabilities = new Set(graph.edges.filter((edge) => edgeSelected(edge.imageId, edge.vulnerabilityId)).map((edge) => edge.vulnerabilityId));
  const findingCounts = new Map<string, number>();
  graph.edges.forEach((edge) => findingCounts.set(edge.imageId, (findingCounts.get(edge.imageId) ?? 0) + 1));
  const hiddenConnections = Math.max(0, graph.edges.length - segments.length);
  const emptyState = emptyVulnerabilityState(graph, sourceLoaded, loading);

  return <section className="connection-section" aria-label="이미지와 취약점 관계">
    <div className="connection-headings">
      <div className="pane-heading"><Box size={17} /><h2>컨테이너 이미지</h2><span className="count-badge">{graph.images.length}</span></div>
      <div className="connection-heading"><GitFork size={14} /><span>연결</span></div>
      <div className="pane-heading"><ShieldCheck size={17} /><h2>연결된 취약점</h2><span className="count-badge">{graph.vulnerabilities.length}</span><span className="pane-subtitle">심각도순</span></div>
    </div>
    <div className="connection-board" ref={boardRef}>
      <div className="list-pane image-pane" ref={imageScroll} onScroll={scheduleMeasure} tabIndex={0} role="region" aria-label="이미지 목록">
        {graph.images.length ? <div className="virtual-list" style={{ height: imageVirtualizer.getTotalSize() }}>
          {imageRows.map((row) => {
            const image = graph.images[row.index];
            return <div key={row.key} className="virtual-row" style={{ height: row.size, transform: `translateY(${row.start}px)` }}>
              <ImageRow image={image} selected={selection?.kind === 'image' && selection.id === image.spec.id}
                related={relatedImages.has(image.spec.id)} findingCount={findingCounts.get(image.spec.id) ?? 0}
                onSelect={() => onSelect(selection?.kind === 'image' && selection.id === image.spec.id ? null : { kind: 'image', id: image.spec.id })}
                onVersions={() => onVersions(image)} onRetry={() => onRetry(image)} />
            </div>;
          })}
        </div> : <div className="pane-empty"><span className="empty-icon"><Box size={28} strokeWidth={1.4} /></span>
          <h3>{sourceLoaded ? '일치하는 이미지가 없습니다' : '어떤 이미지로 구성되어 있나요?'}</h3>
          <p>{sourceLoaded ? '필터를 변경해 다른 연결을 살펴보세요.' : '저장소와 Compose 경로를 입력하면\n서비스가 사용하는 이미지를 불러옵니다.'}</p>
        </div>}
      </div>
      <div className="connection-gutter" aria-hidden="true"><span className="gutter-line" />{!sourceLoaded && <span className="gutter-arrow"><ArrowRight size={22} /></span>}</div>
      <div className="list-pane vulnerability-pane" ref={vulnerabilityScroll} onScroll={scheduleMeasure} tabIndex={0} role="region" aria-label="취약점 목록">
        {graph.vulnerabilities.length ? <div className="virtual-list" style={{ height: vulnerabilityVirtualizer.getTotalSize() }}>
          {vulnerabilityRows.map((row) => {
            const vulnerability = graph.vulnerabilities[row.index];
            return <div key={row.key} className="virtual-row" style={{ height: row.size, transform: `translateY(${row.start}px)` }}>
              <VulnerabilityRow vulnerability={vulnerability} selected={selection?.kind === 'vulnerability' && selection.id === vulnerability.id}
                related={relatedVulnerabilities.has(vulnerability.id)} onSelect={() => onSelect({ kind: 'vulnerability', id: vulnerability.id })} />
            </div>;
          })}
        </div> : <div className="pane-empty"><span className="empty-icon"><ScanLine size={29} strokeWidth={1.4} /></span>
          <h3>{emptyState.title}</h3><p>{emptyState.description}</p>
        </div>}
      </div>
      <svg className="connection-lines" aria-label={`${graph.edges.length}개의 이미지·취약점 연결`}>
        <defs>{['muted', 'active'].map((kind) => <marker key={kind} id={`${markerId}-${kind}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 6 3 L 0 6" fill="none" className={`arrow-${kind}`} /></marker>)}</defs>
        {[...segments].sort((a, b) => Number(a.highlighted) - Number(b.highlighted)).map((segment) => <path key={segment.id}
          d={segment.path} className={`connection-path${segment.highlighted ? ' highlighted' : ''}${segment.uncertain ? ' uncertain' : ''}`}
          markerEnd={`url(#${markerId}-${segment.highlighted ? 'active' : 'muted'})`} />)}
      </svg>
    </div>
    <div className="connection-footer"><span><span className="legend-line" />연결 <span className="legend-line dashed" />버전 미고정</span>
      <span>{sourceLoaded ? `${graph.edges.length}개 연결${hiddenConnections ? ` · 화면 밖 ${hiddenConnections}개` : ''}` : '이미지 또는 CVE를 선택해 연결을 강조하세요'}</span>
    </div>
  </section>;
}
