<p>
  <img src="frontend/public/composelens-logo-smile.png" width="320" alt="여러 레이어로 나뉜 컨테이너를 등에 실은 웃는 고래, ComposeLens 로고" />
</p>

# ComposeLens

공개 GitHub 저장소의 Compose 파일을 읽고, 이미지와 공개 취약점 분석 결과를 연결해서 살펴보는 개발 도구입니다. 저장소 URL과 Compose 파일 경로를 입력하면 좌측에는 이미지, 우측에는 CVE 목록이 표시됩니다.

개발 중 사용하는 컨테이너 이미지에 어떤 취약점이 연결되어 있는지 확인하고, 이미지 안의 패키지와 수정 버전을 살펴볼 수 있습니다. Docker Hub·Scout가 제공하는 기존 분석 결과를 조회합니다.

## 사용 흐름

1. 공개 GitHub 저장소 URL과 저장소 기준의 Compose 파일 경로를 입력합니다.
2. 분석 진행 화면이 끝나면 결과가 표시됩니다. 이미지를 선택해 해당 이미지의 CVE 목록을 확인하고, ‘전체 보기’로 모든 이미지의 결과를 다시 볼 수 있습니다.
3. 검색·심각도·수정 여부로 결과를 좁히고, 상세 패널에서 이미지별 패키지와 버전을 살펴봅니다.
4. 다른 태그나 digest를 선택해 비교할 버전의 취약점을 조회합니다.

## 화면과 데이터

- 이미지를 선택하면 왼쪽 이미지 목록을 유지하면서 오른쪽에 해당 이미지의 CVE만 표시합니다. 선택 이미지의 패키지·심각도를 기준으로 묶고, CVE 상세를 닫아도 이미지 선택과 스크롤 위치를 유지합니다.
- CVE 행에서 패키지·설치 버전·수정 버전을 바로 확인합니다. 일부 패키지만 수정 버전이 제공되는 경우를 구분하고, 상세 패널에서 전체 패키지 정보를 살펴볼 수 있습니다.
- 입력·분석 중·결과는 각각 별도 화면으로 표시됩니다. 결과 화면의 푸터에서 ‘다시 분석’을 누르면 입력값을 유지한 채 입력 화면으로 돌아갑니다.
- 테마와 GitHub 소스 링크는 푸터에 있습니다. 설명은 물음표 버튼에 마우스를 올리거나 키보드로 포커스하면 표시됩니다.
- 검색·심각도·수정 버전 필터는 양쪽 목록에 함께 적용됩니다. 긴 목록은 각 영역 안에서 연속으로 스크롤합니다.
- `latest`를 포함한 태그는 조회 시점에 가리키는 이미지를 사용합니다. digest가 없는 참조에는 버전 미고정 표시를 붙이고, 실제 조회한 digest와 플랫폼을 함께 보여줍니다.
- `build:` 서비스는 저장소와 연결된 GitHub submodule의 Dockerfile을 읽어 최종 스테이지의 베이스 이미지를 조회합니다. `context`·`dockerfile` 경로, 전역 `ARG` 기본값·Compose 빌드 인자, `target`, 이전 스테이지 상속을 해석하며 로컬 출력 태그를 Docker Hub 이미지로 취급하지 않습니다.
- submodule은 상위 저장소에 기록된 커밋으로 조회하며 중첩 경로와 상대 저장소 URL도 지원합니다. 실제 Dockerfile 저장소·커밋·경로는 베이스 이미지 물음표 도움말에서 확인합니다.
- Dockerfile에서 찾은 결과에는 **베이스 기준**을 표시합니다. 베이스의 CVE 목록이며, `RUN`·`COPY`로 추가·삭제한 패키지나 빌드 산출물 전체의 취약점을 검사한 결과는 아닙니다. 파일·대상 스테이지·출력 태그와 제한 사항은 물음표 도움말에서 확인합니다.
- 다른 태그나 digest를 선택해 분석 대상을 바꿀 수 있습니다. GitHub의 Compose 파일은 수정하지 않습니다.
- 상단에 전체 이미지 중 분석 정보가 제공된 수와 확인이 필요한 수를 표시합니다. 이미지별 전체 CVE와 필터 적용 후 표시되는 CVE 수도 구분합니다.
- 테마는 처음에 시스템 설정을 따르며 라이트·다크 모드로 전환할 수 있습니다.

과거 버전 선택은 현재 조회 가능한 태그·digest의 분석을 가져오는 기능입니다. 과거 `latest`의 실제 대상이나 당시 알려졌던 취약점 상태를 복원하지는 않습니다.

분석을 실행하면 주소의 `url`과 `compose` 쿼리 파라미터에 저장소 URL과 파일 경로가 기록됩니다. 주소를 공유하거나 새로고침하면 같은 입력으로 분석을 시작합니다. `compose`가 없으면 `compose.yml`을 사용합니다.

```text
/?url=https%3A%2F%2Fgithub.com%2Fdocker%2Fawesome-compose&compose=wordpress-mysql%2Fcompose.yaml
```

## 구성

```text
React SPA ────────────────→ GitHub REST API: 공개 Compose 파일
    │
    └─→ Pages Functions ─→ Docker Hub: 태그·digest·플랫폼
                        └→ Docker Scout: 기존 패키지·취약점 분석
```

프런트엔드는 React·TypeScript·Vite를 사용하고, 두 목록 사이의 연결은 SVG로 그립니다. Pages Functions는 같은 도메인의 `/api/*` 요청을 처리합니다. 고정된 Docker 조회 경로만 제공하며 임의의 URL을 중계하는 프록시는 아닙니다.

Docker Compose로 실행할 때는 Nginx가 React 빌드 파일을 제공하고 `/api/*`를 내부 Node.js 백엔드로 전달합니다. Node 서버와 Pages Functions는 같은 요청 처리 로직을 사용합니다.

| API | 입력 | 응답 |
| --- | --- | --- |
| `GET /api/images` | `reference`, `platform` | 이미지 메타데이터, 패키지별 취약점, 조회 상태·시각 |
| `GET /api/tags` | `repository`, `page`, `search` | 선택할 수 있는 태그와 다음 페이지 |

브라우저에 넣을 비밀키나 Docker 계정은 필요하지 않습니다. 별도 이미지 스캔·DB 없이 익명으로 제공되는 기존 분석 정보를 사용합니다.

## 디렉터리와 의존성

```text
frontend/
  package.json       # SPA 의존성과 개발·빌드·화면 테스트 명령
  package-lock.json
  index.html
  public/            # 정적 자산과 Pages 라우팅 설정
  src/
    components/      # 화면 컴포넌트
    hooks/           # 화면 상태와 조회 흐름
    domain/
      compose-parser.ts             # Compose 서비스·변수·빌드 설정 해석
      dockerfile-base-resolver.ts   # ARG·target·스테이지에서 외부 베이스 결정
      image-vulnerability-graph.ts  # 이미지·CVE 관계와 필터·선택 범위 구성
      analysis-query-params.ts      # 공유 URL의 분석 입력 읽기·갱신
      analysis-types.ts             # 화면 분석 상태·빌드 출처 타입
      display-formatters.ts         # 날짜·크기·digest 표시 문자열
      safe-external-url.ts          # 외부 링크 URL 검증
    services/
      github-file-client.ts         # 공개 저장소의 Compose·Dockerfile 읽기
      github-submodule-repository.ts # submodule URL을 GitHub 저장소로 해석
      image-api-client.ts           # 이미지 분석·태그 API 호출
      build-image-resolver.ts       # Dockerfile 읽기와 베이스 해석 연결
  tests/             # Playwright 화면 테스트
  Dockerfile         # React 빌드·Nginx 실행 이미지
  nginx.conf         # 정적 파일·API 프록시 설정
  dist/              # SPA 빌드 출력
backend/
  package.json       # Functions 의존성과 개발·빌드 명령
  package-lock.json
  wrangler.jsonc     # Pages 프로젝트와 SPA 출력 위치
  functions/
    api/             # Cloudflare Pages API 엔드포인트
    _lib/            # Docker Hub·Scout 조회 및 응답 정리
  server/            # Docker용 Node.js HTTP 서버
  Dockerfile         # 번들된 백엔드 실행 이미지
  dist/              # Functions·Node 번들 출력
shared/
  package.json       # 비공개 @composelens/shared 패키지
  package-lock.json
  types.ts           # 양쪽이 공유하는 API 계약
  image-reference.ts # 공통 이미지 참조 해석
deployment/
  compose.yml        # Nginx + Node 백엔드 실행
  smoke-test.sh      # 정적 파일·API 라우팅 검사
```

각 디렉터리는 자체 `package.json`·lockfile·TypeScript·테스트 설정을 갖습니다. 루트에는 문서와 Git 설정을 두며 루트 Node 패키지는 없습니다.

프런트엔드와 백엔드는 서로의 구현을 import하지 않습니다. 둘 다 `"@composelens/shared": "file:../shared"` 의존성을 통해 순수 TypeScript로 작성한 공통 API 타입과 이미지 참조 해석을 사용합니다. Compose·관계도·화면 상태 타입은 프런트엔드 안에 둡니다.

관련 단위 테스트는 대상 모듈 옆의 같은 이름 `.test.ts` 파일에 둡니다. Playwright 화면 테스트는 `frontend/tests/`에 둡니다.

## 지원 범위

- 공개 GitHub 저장소의 단일 Compose 파일을 지원합니다. YAML 앵커와 인라인 변수 기본값을 해석합니다.
- `.env`, 외부 `include`·`extends` 파일은 읽지 않습니다. Dockerfile은 선택한 저장소·브랜치와 그 커밋이 연결한 공개 GitHub submodule에서 읽으며 `dockerfile_inline`도 지원합니다. 파일 경로는 상위 저장소의 체크아웃 범위 밖으로 나갈 수 없습니다.
- Compose 파일 자체가 submodule 안에 있어도 지원합니다. submodule은 최대 8단계까지 따라가며, GitHub 외부·비공개 submodule이나 누락된 커밋·파일은 확인 필요로 표시합니다. submodule의 기본 브랜치 최신 커밋으로 대체하지 않습니다.
- 원격 빌드 컨텍스트·추가 이름 지정 컨텍스트·해결할 수 없는 베이스 변수·`scratch` 등 공개 베이스를 결정할 수 없는 항목은 확인 필요로 표시합니다. 다른 서비스의 분석은 계속합니다.
- 이미지 조회는 공개 Docker Hub를 대상으로 합니다. 다른 레지스트리와 공개 분석 데이터가 없는 이미지는 지원·제공 상태를 따로 표시합니다.
- **분석 정보 미제공·조회 실패와 취약점 0개는 다른 상태입니다.** 일부 이미지 조회가 실패해도 다른 이미지의 결과는 유지합니다.
- Docker Scout 웹 API는 공식 외부 연동 계약이 문서화된 API가 아닙니다. 응답 구조·익명 접근 정책이 바뀌면 조회 어댑터 수정이 필요할 수 있습니다. [Docker Scout의 분석 방식](https://docs.docker.com/scout/explore/analysis/)
- GitHub·Docker의 익명 API 요청 제한과 일시적인 네트워크 오류가 적용됩니다.

## 실행과 배포

```bash
docker compose -f deployment/compose.yml up --build -d
```

`http://localhost:8080`에서 접속합니다. React 빌드와 백엔드 번들은 Docker 빌드 중 생성됩니다.

설치·로컬 실행·검증·Cloudflare Pages 자동 배포 방법은 [Deploy.md](Deploy.md)를 참고하세요.
