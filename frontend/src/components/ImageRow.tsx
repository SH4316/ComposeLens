import { Box, Check, ChevronDown, CircleAlert, Link2, LoaderCircle, RotateCcw } from 'lucide-react';
import { formatBytes, shortDigest } from '../domain/format';
import { parseImageReference } from '@composelens/shared/image-reference';
import type { ImageState } from '../domain/types';

interface Props {
  image: ImageState;
  selected: boolean;
  related: boolean;
  findingCount: number;
  onSelect: () => void;
  onVersions: () => void;
  onRetry: () => void;
}

export function isUncertain(reference: string) {
  try { return !parseImageReference(reference).pinned; } catch { return true; }
}

export function ImageRow({ image, selected, related, findingCount, onSelect, onVersions, onRetry }: Props) {
  const { spec, report } = image;
  const uncertain = isUncertain(image.selectedRef);
  const loading = image.status === 'idle' || image.status === 'loading';
  const available = report?.status === 'available';
  const failure = image.error || report?.message;
  const modified = image.selectedRef !== spec.declaredRef;
  const retryable = !spec.issue && (image.status === 'error' || report?.status === 'unavailable');
  const unavailableLabel = spec.issue ? '확인 필요'
    : retryable ? '취약점 조회 실패'
    : report?.status === 'unsupported' ? '지원 대상 아님' : '분석 정보 미제공';

  return <div className={`image-item${selected ? ' selected' : ''}${related ? ' related' : ''}${uncertain ? ' uncertain' : ''}`}
    data-image-id={spec.id}>
    <button type="button" className="image-main" onClick={onSelect} aria-pressed={selected}
      aria-label={`${image.selectedRef} 이미지 관계 선택`}>
      <div className="image-title-line"><span className="image-icon"><Box size={19} /></span>
        <span className="image-name" title={image.selectedRef}>{image.selectedRef}</span>
        <span className={`selection-indicator${selected ? ' checked' : ''}`}>{selected && <Check size={11} />}</span>
      </div>
      <div className="image-services" title={spec.services.join(', ')}>{spec.services.join(' · ')}<span className="inline-separator">/</span>{spec.platform}</div>
      <div className="image-evidence">
        <span className={`confidence-badge${uncertain ? '' : ' pinned'}`} title={uncertain
          ? '태그가 가리키는 이미지는 바뀔 수 있습니다. 아래 digest는 현재 조회한 이미지입니다.'
          : '지정한 digest의 이미지를 조회합니다.'}><Link2 size={12} />{uncertain ? '태그 미고정' : 'digest 고정'}</span>
        {modified && <span className="modified-label">다른 버전</span>}
        {report?.metadata && <span className="digest" title={report.metadata.digest}>{shortDigest(report.metadata.digest)}</span>}
      </div>
      <div className="image-result-line">
        {loading ? <span className="image-pending"><LoaderCircle size={13} className="spin" />이미지·취약점 조회 중</span>
          : available ? <><span className="finding-count">연결된 CVE <strong>{findingCount}</strong></span><span>{formatBytes(report.metadata?.size ?? null)}</span></>
          : <span className="image-unavailable" title={failure ?? '취약점 정보가 제공되지 않습니다.'}><CircleAlert size={13} />{unavailableLabel}</span>}
      </div>
    </button>
    <div className="image-actions">
      {failure ? <span className="image-message" title={failure}>{failure}</span> : <span className="image-message">{modified ? `원본: ${spec.declaredRef}` : '현재 선택한 이미지 기준'}</span>}
      {retryable && <button className="row-action" onClick={onRetry}><RotateCcw size={12} />다시 조회</button>}
      {!spec.issue && <button className="row-action" disabled={loading} onClick={onVersions}>버전 선택<ChevronDown size={12} /></button>}
    </div>
  </div>;
}
