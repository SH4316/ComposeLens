import { ArrowRight, Check, CircleAlert, ExternalLink, LoaderCircle, Search, Tag } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { formatBytes, formatDate, safeExternalUrl, shortDigest } from '../domain/format';
import { parseImageReference } from '../../../shared/image-reference';
import type { TagOption } from '../../../shared/types';
import type { ImageState } from '../domain/types';
import { fetchTags } from '../services/docker';
import { Drawer } from './Drawer';

interface Props { image: ImageState; onApply: (reference: string) => void; onClose: () => void }

export function VersionPicker({ image, onApply, onClose }: Props) {
  const parsed = useMemo(() => {
    try { return parseImageReference(image.selectedRef); } catch { return null; }
  }, [image.selectedRef]);
  const repository = parsed?.repository ?? '';
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
      void fetchTags(repository, search, 1, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        setTags(result.tags);
        setNextPage(result.nextPage);
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '태그를 불러오지 못했습니다.');
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); pageController.current?.abort(); };
  }, [repository, parsed?.registry, search]);

  async function loadMore() {
    if (!nextPage || loading) return;
    const controller = new AbortController();
    pageController.current = controller;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchTags(repository, search, nextPage, controller.signal);
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
    <p className="version-explanation">다른 태그나 digest를 선택해 해당 이미지의 현재 취약점 정보를 조회합니다. GitHub의 Compose 파일은 변경되지 않습니다.</p>
    {image.report?.metadata && <div className="current-image-metadata"><span>현재 분석한 이미지</span><code>{image.report.metadata.digest}</code><p>{image.report.metadata.platform} · {formatBytes(image.report.metadata.size)}</p><a href={safeExternalUrl(image.report.metadata.sourceUrl)} target="_blank" rel="noreferrer">Docker Hub에서 보기<ExternalLink size={12} /></a></div>}
    <form className="version-form" onSubmit={submit}>
      <label className="field"><span>이미지 참조 또는 digest</span><div className="input-wrap"><Tag size={16} />
        <input aria-label="선택할 이미지 참조 또는 digest" value={reference} onChange={(event) => { setReference(event.target.value); setInputError(null); }} spellCheck={false} required /></div></label>
      {inputError && <p className="inline-error" role="alert">{inputError}</p>}
      <button className="primary-button" type="submit">이 버전으로 조회<ArrowRight size={15} /></button>
    </form>
    {image.selectedRef !== image.spec.declaredRef && <button type="button" className="text-button restore-version" onClick={() => onApply(image.spec.declaredRef)}>Compose 원본 버전으로 돌아가기</button>}
    <div className="detail-section-heading tag-heading"><h3>사용 가능한 태그</h3><span>과거 버전 포함</span></div>
    <div className="filter-search tag-search"><Search size={16} /><input aria-label="태그 검색" placeholder="태그 이름 검색" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    {error && <div className="tag-error" role="alert"><CircleAlert size={16} /><span>{error}</span></div>}
    <div className="tag-list">{tags.map((tag) => <div className="tag-item" key={tag.name}>
      <button className="tag-choice" type="button" onClick={() => onApply(`${repository}:${tag.name}`)}>
        <span><Tag size={14} /><strong>{tag.name}</strong>{parsed?.tag === tag.name && <Check size={14} />}</span>
        <span className="tag-date">{formatDate(tag.updatedAt)}</span>
      </button>
      {tag.digest && <button type="button" className="digest-choice" title={tag.digest} onClick={() => onApply(`${repository}@${tag.digest}`)}><code>{shortDigest(tag.digest)}</code><span>digest로 고정<ArrowRight size={12} /></span></button>}
    </div>)}</div>
    {loading && <p className="tag-loading"><LoaderCircle size={16} className="spin" />태그를 불러오는 중</p>}
    {!loading && !error && tags.length === 0 && <p className="tag-loading">일치하는 태그가 없습니다.</p>}
    {nextPage && !loading && <button className="secondary-button load-more" type="button" onClick={() => void loadMore()}>태그 더 보기</button>}
    <p className="version-footnote">태그는 변경될 수 있습니다. 이 목록은 과거에 latest가 가리켰던 이미지나 당시의 취약점 상태를 복원하지 않습니다.</p>
  </Drawer>;
}
