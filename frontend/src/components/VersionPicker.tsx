import { ArrowRight, Check, CircleAlert, ExternalLink, LoaderCircle, Search, Tag } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { formatBytes, formatDate, shortDigest } from '../domain/display-formatters';
import { safeExternalUrl } from '../domain/safe-external-url';
import { parseImageReference } from '@composelens/shared/image-reference';
import { tagFamily } from '@composelens/shared/tag-family';
import type { HistoricalImage, TagOption } from '@composelens/shared';
import type { ImageState } from '../domain/analysis-types';
import { versionSource } from '../domain/version-source';
import { fetchTags } from '../services/image-api-client';
import { Drawer } from './Drawer';
import { BaseImageHelp } from './BaseImageHelp';
import { HelpTip } from './HelpTip';
import { VersionHistory } from './VersionHistory';

interface Props { image: ImageState; onApply: (reference: string, history?: HistoricalImage) => void; onClose: () => void }

export function VersionPicker({ image, onApply, onClose }: Props) {
  const parsed = useMemo(() => {
    try { return parseImageReference(image.selectedRef); } catch { return null; }
  }, [image.selectedRef]);
  const repository = parsed?.repository ?? '';
  const sourceReference = versionSource(image);
  const family = useMemo(() => {
    try { return tagFamily(parseImageReference(sourceReference ?? image.selectedRef).tag); } catch { return null; }
  }, [sourceReference, image.selectedRef]);
  const [scope, setScope] = useState<'family' | 'all'>(family ? 'family' : 'all');
  const activeFamily = scope === 'family' ? family ?? '' : '';
  const [reference, setReference] = useState(image.selectedRef);
  const [search, setSearch] = useState('');
  const [tags, setTags] = useState<TagOption[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const pageController = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!repository || parsed?.registry !== 'docker.io') {
      setError('Docker Hub 이미지의 태그 목록을 지원합니다.');
      return;
    }
    const controller = new AbortController();
    pageController.current?.abort();
    pageController.current = controller;
    setLoading(true);
    setError(null);
    setTags([]);
    setNextPage(null);
    const timer = setTimeout(() => {
      void fetchTags(repository, search, 1, controller.signal, activeFamily).then((result) => {
        if (controller.signal.aborted) return;
        setTags(result.tags);
        setNextPage(result.nextPage);
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '태그를 불러오지 못했습니다.');
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); pageController.current?.abort(); };
  }, [repository, parsed?.registry, search, activeFamily]);

  async function loadMore() {
    if (!nextPage || loading) return;
    const controller = new AbortController();
    pageController.current = controller;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchTags(repository, search, nextPage, controller.signal, activeFamily);
      if (!controller.signal.aborted) {
        setTags((previous) => [...previous, ...result.tags]);
        setNextPage(result.nextPage);
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '태그를 불러오지 못했습니다.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = reference.trim();
    const fullReference = value.startsWith('sha256:') ? `${repository}@${value}`
      : !value.includes('/') && !value.includes(':') && !value.includes('@') ? `${repository}:${value}` : value;
    try {
      const selected = parseImageReference(fullReference);
      if (selected.registry !== 'docker.io') throw new Error('Docker Hub 이미지 참조를 입력해주세요.');
      onApply(fullReference);
    } catch (reason) {
      setInputError(reason instanceof Error ? reason.message : '이미지 참조를 확인해주세요.');
    }
  }

  return <Drawer title="다른 버전 선택" subtitle={repository} onClose={onClose}>
    <VersionHistory reference={sourceReference} platform={image.spec.platform} selectedDigest={image.report?.metadata?.digest ?? parsed?.digest ?? null} onApply={onApply} />
    <dl className="version-reference-list">
      <div><dt>{image.spec.origin ? 'Dockerfile 원본 베이스' : 'Compose 원본 참조'}{image.spec.origin && <BaseImageHelp origin={image.spec.origin} />}</dt><dd><code>{image.spec.declaredRef}</code></dd></div>
      <div><dt>현재 조회 참조 <HelpTip label="버전 조회 도움말" placement="bottom">태그나 digest로 이 화면에서 조회할 이미지를 선택합니다. GitHub의 Compose 파일은 변경되지 않습니다. digest로 조회하면 해당 이미지의 제공된 분석을 확인합니다.</HelpTip></dt><dd><code>{image.selectedRef}</code>{image.history && <span className="confidence-badge">과거 기록</span>}</dd></div>
    </dl>
    {image.report?.metadata && <div className="current-image-metadata"><span>현재 분석한 digest</span><code>{image.report.metadata.digest}</code><p>{image.report.metadata.platform} · {formatBytes(image.report.metadata.size)}</p><a href={safeExternalUrl(image.report.metadata.sourceUrl)} target="_blank" rel="noreferrer">Docker Hub에서 보기<ExternalLink size={12} /></a></div>}
    <form className="version-form" onSubmit={submit}>
      <label className="field"><span>이미지 참조 또는 digest</span><div className="input-wrap"><Tag size={16} />
        <input aria-label="선택할 이미지 참조 또는 digest" value={reference} onChange={(event) => { setReference(event.target.value); setInputError(null); }} spellCheck={false} required /></div></label>
      {inputError && <p className="inline-error" role="alert">{inputError}</p>}
      <button className="primary-button" type="submit">이 버전으로 조회<ArrowRight size={15} /></button>
    </form>
    {image.selectedRef !== image.spec.declaredRef && <button type="button" className="text-button restore-version" onClick={() => onApply(image.spec.declaredRef)}>{image.spec.origin ? '원본 베이스로 돌아가기' : 'Compose 원본 버전으로 돌아가기'}</button>}
    <div className="detail-section-heading tag-heading"><h3>현재 태그</h3><HelpTip label="태그 목록 도움말">현재 Docker Hub에 있는 태그입니다. 같은 버전 계열은 태그 이름의 숫자 접두사로 분류하며, 위의 과거 기록과는 별개입니다. 같은 계열의 slim·alpine 등 변형도 포함합니다.</HelpTip></div>
    {family && <div className="tag-scope" role="group" aria-label="태그 목록 범위">
      <button type="button" aria-pressed={scope === 'family'} onClick={() => setScope('family')}>{family} 계열</button>
      <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>전체 태그</button>
    </div>}
    <div className="filter-search tag-search"><Search size={16} /><input aria-label="태그 검색" placeholder="태그 이름 검색" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    {error && <div className="tag-error" role="alert"><CircleAlert size={16} /><span>{error}</span></div>}
    <div className="tag-list">{tags.map((tag) => <div className="tag-item" key={tag.name}>
      <button className="tag-choice" type="button" onClick={() => onApply(`${repository}:${tag.name}`)}>
        <span><Tag size={14} /><strong>{tag.name}</strong>{activeFamily && <span className="confidence-badge">같은 계열</span>}{parsed?.tag === tag.name && <Check size={14} />}</span>
        <span className="tag-date">{formatDate(tag.updatedAt)}</span>
      </button>
      {tag.digest && <button type="button" className="digest-choice" title={tag.digest} onClick={() => onApply(`${repository}@${tag.digest}`)}><code>{shortDigest(tag.digest)}</code><span>이 digest로 조회<ArrowRight size={12} /></span></button>}
    </div>)}</div>
    {loading && <p className="tag-loading"><LoaderCircle size={16} className="spin" />태그를 불러오는 중</p>}
    {!loading && !error && tags.length === 0 && <p className="tag-loading">{nextPage ? '이번 조회에 일치하는 태그가 없습니다. 다음 태그를 더 조회해 보세요.' : '일치하는 태그가 없습니다.'}</p>}
    {nextPage && !loading && <button className="secondary-button load-more" type="button" onClick={() => void loadMore()}>태그 더 보기</button>}
  </Drawer>;
}
