import type { FormEvent } from 'react';
import { HelpTip } from './HelpTip';

interface Props {
  repository: string;
  path: string;
  onRepositoryChange: (value: string) => void;
  onPathChange: (value: string) => void;
  onAnalyze: (repository: string, path: string) => void;
}

export function RepositoryForm({ repository, path, onRepositoryChange, onPathChange, onAnalyze }: Props) {
  function submit(event: FormEvent) {
    event.preventDefault();
    onAnalyze(repository.trim(), path.trim());
  }

  return <form className="repository-form" aria-label="Compose 분석" onSubmit={submit}>
    <label className="field repository-field">
      <span>GitHub 저장소 URL</span>
      <div className="input-wrap">
        <input required type="url" aria-label="GitHub 저장소 URL" placeholder="https://github.com/owner/repository"
          value={repository} onChange={(event) => onRepositoryChange(event.target.value)} spellCheck={false} />
      </div>
    </label>
    <label className="field path-field">
      <span>Compose 파일 경로</span>
      <div className="input-wrap">
        <input required aria-label="Compose 파일 경로" placeholder="compose.yml" value={path}
          onChange={(event) => onPathChange(event.target.value)} spellCheck={false} />
      </div>
    </label>
    <div className="repository-form-actions">
      <button type="submit" className="primary-button analyze-button">분석</button>
      <HelpTip label="입력 도움말">공개 GitHub 저장소의 기본 브랜치에서 Compose 파일을 읽습니다. Docker Hub 이미지를 지원합니다.</HelpTip>
    </div>
  </form>;
}
