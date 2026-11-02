import type { ImageReport } from '@composelens/shared';
import { formatDate } from '../domain/display-formatters';
import type { BuildOrigin } from '../domain/analysis-types';
import { HelpTip } from './HelpTip';

interface Props {
  origin: BuildOrigin;
  report?: ImageReport | null;
  placement?: 'top' | 'bottom';
}

export function BaseImageHelp({ origin, report, placement = 'bottom' }: Props) {
  return <HelpTip label="베이스 이미지 안내" placement={placement}>
    베이스 이미지 기준입니다. RUN·COPY로 추가·삭제된 패키지는 반영하지 않습니다.
    <br />{origin.dockerfile} · {origin.stage}
    {origin.source && <><br /><code>{origin.source.repository}@{origin.source.ref.slice(0, 7)} · {origin.source.path}</code></>}
    {origin.outputRef && <><br />빌드 태그: <code>{origin.outputRef}</code></>}
    {report?.metadata && <><br /><code>{report.metadata.digest}</code><br />{formatDate(report.retrievedAt)}</>}
  </HelpTip>;
}
