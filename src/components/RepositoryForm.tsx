import { ArrowRight, FileCode2, Github, LoaderCircle, Play } from 'lucide-react';
import { useState, type FormEvent } from 'react';

interface Props {
  loading: boolean;
  onAnalyze: (repository: string, path: string) => void;
}

export function RepositoryForm({ loading, onAnalyze }: Props) {
  const [repository, setRepository] = useState('');
  const [path, setPath] = useState('compose.yml');

  function submit(event: FormEvent) {
    event.preventDefault();
    onAnalyze(repository.trim(), path.trim());
  }

  function loadExample() {
    const exampleRepository = 'https://github.com/docker/awesome-compose';
    const examplePath = 'wordpress-mysql/compose.yaml';
    setRepository(exampleRepository);
    setPath(examplePath);
    onAnalyze(exampleRepository, examplePath);
  }

  return <section className="source-section" aria-labelledby="source-title">
    <div className="source-heading">
      <div>
        <h1 id="source-title">이미지에서 취약점까지, 한눈에.</h1>
        <p>Compose에 연결된 이미지와 알려진 취약점을 함께 살펴보세요.</p>
      </div>
      <button type="button" className="text-button example-button" onClick={loadExample} disabled={loading}>
        <Play size={14} /> 예제로 살펴보기
      </button>
    </div>
    <form className="repository-form" onSubmit={submit}>
      <label className="field repository-field">
        <span>GitHub 저장소</span>
        <div className="input-wrap"><Github size={17} />
          <input required type="url" aria-label="GitHub 저장소 URL" placeholder="https://github.com/owner/repository"
            value={repository} onChange={(event) => setRepository(event.target.value)} spellCheck={false} />
        </div>
      </label>
      <label className="field path-field">
        <span>Compose 파일 경로</span>
        <div className="input-wrap"><FileCode2 size={17} />
          <input required aria-label="Compose 파일 경로" placeholder="compose.yml" value={path}
            onChange={(event) => setPath(event.target.value)} spellCheck={false} />
        </div>
      </label>
      <button type="submit" className="primary-button analyze-button" disabled={loading}>
        {loading ? <LoaderCircle size={17} className="spin" /> : null}
        {loading ? '조회 중' : '연결 분석'} {!loading && <ArrowRight size={17} />}
      </button>
    </form>
    <p className="form-hint"><span className="status-dot" />공개 저장소 · Docker Hub 이미지 지원 <span className="hint-divider">/</span> 기본 브랜치의 파일을 읽습니다</p>
  </section>;
}
