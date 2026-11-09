import { Check, CircleAlert, ExternalLink, History, LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { HistoricalImage, TagHistoryPage } from '@composelens/shared';
import { shortDigest } from '../domain/display-formatters';
import { safeExternalUrl } from '../domain/safe-external-url';
import { fetchTagHistory } from '../services/image-api-client';
import { HelpTip } from './HelpTip';

interface Props {
  reference: string | null;
  platform: string;
  selectedDigest: string | null;
  onApply: (reference: string, history?: HistoricalImage) => void;
}

function recordedDate(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }).format(new Date(value));
}

export function VersionHistory({ reference, platform, selectedDigest, onApply }: Props) {
  const [result, setResult] = useState<TagHistoryPage | null>(null);
  const [loading, setLoading] = useState(Boolean(reference));
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pageController = useRef<AbortController | null>(null);

  useEffect(() => {
    setResult(null);
    setError(null);
    setLoading(Boolean(reference));
    if (!reference) return;
    const controller = new AbortController();
    pageController.current = controller;
    void fetchTagHistory(reference, platform, 1, controller.signal).then((page) => {
      if (!controller.signal.aborted) setResult(page);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '과거 기록을 불러오지 못했습니다.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); pageController.current?.abort(); };
  }, [reference, platform, attempt]);

  async function loadMore() {
    if (!reference || !result?.nextPage || loading) return;
    const controller = new AbortController();
    pageController.current = controller;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchTagHistory(reference, platform, result.nextPage, controller.signal);
      if (!controller.signal.aborted) setResult((previous) => {
        const entries = [...(previous?.entries ?? []), ...page.entries];
        return { ...page, entries: entries.filter((entry, index) => entries.findIndex((other) => other.digest === entry.digest) === index) };
      });
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '과거 기록을 불러오지 못했습니다.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return <section className="version-history" aria-label="태그의 과거 이미지">
    <div className="detail-section-heading history-heading"><History size={15} /><h3>이 태그의 과거 이미지</h3>
      <HelpTip label="과거 이미지 기록 도움말">Docker 공식 이미지의 공개 기록에서 이 태그와 플랫폼으로 관측된 digest입니다. 기록 시점은 실제 태그 변경 시각과 다를 수 있고, 중간 변경이 누락될 수 있습니다. 취약점은 현재 제공되는 분석을 조회합니다.</HelpTip>
    </div>
    <p className="history-summary" role="status">
      {reference && <code>{reference}</code>}
      <span>{platform}</span>
      <strong>{loading && !result ? '과거 기록 조회 중' : error && !result ? '과거 기록 조회 실패'
        : result?.status === 'unsupported' || !reference ? '과거 기록 지원 대상 아님'
        : `${result?.entries.length ?? 0}개 이미지 확인`}</strong>
    </p>
    {result?.entries.length ? <ul className="history-list">{result.entries.map((entry) => <li className="history-item" key={entry.digest}>
      <button className="history-choice" type="button" onClick={() => onApply(`${entry.sourceReference.split(':')[0]}@${entry.digest}`, entry)}>
        <span className="history-choice-title"><strong>{entry.version ?? entry.sourceReference.split(':')[1]}</strong><span className="confidence-badge">과거 기록</span>{selectedDigest === entry.digest && <Check size={14} aria-label="현재 분석한 이미지" />}</span>
        <code>{shortDigest(entry.digest)}</code>
        <span className="history-recorded-at">기록 {recordedDate(entry.recordedAt)} UTC</span>
      </button>
      <a className="history-source" href={safeExternalUrl(entry.sourceUrl)} target="_blank" rel="noreferrer" aria-label={`${entry.version ?? entry.sourceReference} ${recordedDate(entry.recordedAt)} 기록 보기`}>기록 보기<ExternalLink size={11} /></a>
    </li>)}</ul> : null}
    {loading && <p className="history-message"><LoaderCircle size={14} className="spin" />과거 기록을 불러오는 중</p>}
    {!loading && !error && (!reference || result?.status === 'unsupported') && <p className="history-message">{result?.message ?? '태그가 있는 이미지에서 과거 기록을 조회할 수 있습니다.'}</p>}
    {!loading && !error && result?.status === 'available' && result.entries.length === 0 && <p className="history-message">{result.nextPage ? '이번 조회에 해당 플랫폼의 기록이 없습니다. 이전 기록을 더 조회해 보세요.' : '이 태그와 플랫폼의 공개 기록을 찾지 못했습니다.'}</p>}
    {result?.message && result.status === 'available' && <p className="history-message">{result.message}</p>}
    {error && <div className="history-error" role="alert"><CircleAlert size={14} /><span>{error}</span>
      <button className="text-button" type="button" onClick={() => result?.nextPage ? void loadMore() : setAttempt((value) => value + 1)}>다시 조회</button>
    </div>}
    {result?.nextPage && !loading && !error && <button type="button" className="text-button history-more" onClick={() => void loadMore()}>이전 기록 더 보기</button>}
  </section>;
}
