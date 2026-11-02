# ComposeLens

공개 GitHub 저장소의 Compose 파일을 읽고, 이미지와 공개 취약점 분석 결과를 연결해서 살펴보는 개발 도구입니다. 저장소 URL과 Compose 파일 경로를 입력하면 좌측에는 이미지, 우측에는 CVE 목록이 표시됩니다.

## 화면과 데이터

- 이미지 또는 CVE를 선택하면 연결된 항목과 화살표를 강조합니다. 동일 CVE는 하나로 묶고, 상세 패널에서는 이미지별 패키지·설치 버전·수정 버전을 구분합니다.
- 검색·심각도·수정 버전 필터는 양쪽 목록에 함께 적용됩니다. 긴 목록은 각 영역 안에서 연속으로 스크롤합니다.
- `latest`를 포함한 태그는 조회 시점에 가리키는 이미지를 사용합니다. digest가 없는 참조에는 버전 미고정 표시를 붙이고, 실제 조회한 digest와 플랫폼을 함께 보여줍니다.
- 다른 태그나 digest를 선택해 분석 대상을 바꿀 수 있습니다. GitHub의 Compose 파일은 수정하지 않습니다.
- 테마는 처음에 시스템 설정을 따르며 라이트·다크 모드로 전환할 수 있습니다.

과거 버전 선택은 현재 조회 가능한 태그·digest의 분석을 가져오는 기능입니다. 과거 `latest`의 실제 대상이나 당시 알려졌던 취약점 상태를 복원하지는 않습니다.

## 구성

```text
React SPA ────────────────→ GitHub REST API: 공개 Compose 파일
    │
    └─→ Pages Functions ─→ Docker Hub: 태그·digest·플랫폼
                        └→ Docker Scout: 기존 패키지·취약점 분석
```

프런트엔드는 React·TypeScript·Vite를 사용하고, 두 목록 사이의 연결은 SVG로 그립니다. Pages Functions는 같은 도메인의 `/api/*` 요청을 처리합니다. 고정된 Docker 조회 경로만 제공하며 임의의 URL을 중계하는 프록시는 아닙니다.

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
    domain/          # Compose 해석, 관계 구성, UI 전용 타입
    services/        # 브라우저의 GitHub·앱 API 호출
  tests/             # Playwright 화면 테스트
  dist/              # SPA 빌드 출력
backend/
  package.json       # Functions 의존성과 개발·빌드 명령
  package-lock.json
  wrangler.jsonc     # Pages 프로젝트와 SPA 출력 위치
  functions/
    api/             # Cloudflare Pages API 엔드포인트
    _lib/            # Docker Hub·Scout 조회 및 응답 정리
  dist/              # Functions 컴파일 검증 출력
shared/
  package.json       # 비공개 @composelens/shared 패키지
  package-lock.json
  types.ts           # 양쪽이 공유하는 API 계약
  image-reference.ts # 공통 이미지 참조 해석
```

각 디렉터리는 자체 `package.json`·lockfile·TypeScript·테스트 설정을 갖습니다. 루트에는 문서와 Git 설정을 두며 루트 Node 패키지는 없습니다.

프런트엔드와 백엔드는 서로의 구현을 import하지 않습니다. 둘 다 `"@composelens/shared": "file:../shared"` 의존성을 통해 순수 TypeScript로 작성한 공통 API 타입과 이미지 참조 해석을 사용합니다. Compose·관계도·화면 상태 타입은 프런트엔드 안에 둡니다.

Vite는 `frontend/`에서 실행해 `frontend/dist/`에 SPA를 만듭니다. Cloudflare 프로젝트 루트는 `backend/`로 설정하며, 그 안의 `functions/`와 `wrangler.jsonc`를 사용해 동일한 Pages 프로젝트에서 SPA와 API를 함께 제공합니다. 백엔드의 `build`는 `backend/dist/`에 Functions를 컴파일해 검증하는 명령으로, SPA 빌드 출력과 구분합니다.

## 지원 범위

- 공개 GitHub 저장소의 단일 Compose 파일을 지원합니다. YAML 앵커와 인라인 변수 기본값을 해석합니다.
- `.env`, 외부 `include`·`extends` 파일은 읽지 않습니다. 값이 없는 변수, `build:`만 있는 서비스 등은 미해결 항목으로 표시합니다.
- 이미지 조회는 공개 Docker Hub를 대상으로 합니다. 다른 레지스트리와 공개 분석 데이터가 없는 이미지는 지원·제공 상태를 따로 표시합니다.
- **분석 정보 미제공·조회 실패와 취약점 0개는 다른 상태입니다.** 일부 이미지 조회가 실패해도 다른 이미지의 결과는 유지합니다.
- Docker Scout 웹 API는 공식 외부 연동 계약이 문서화된 API가 아닙니다. 응답 구조·익명 접근 정책이 바뀌면 조회 어댑터 수정이 필요할 수 있습니다. [Docker Scout의 분석 방식](https://docs.docker.com/scout/explore/analysis/)
- GitHub·Docker의 익명 API 요청 제한과 일시적인 네트워크 오류가 적용됩니다.

## 로컬 실행

Node.js 24와 npm을 사용합니다. 다음 명령은 저장소 루트에서 실행합니다.

```bash
npm --prefix frontend ci
npm --prefix backend ci
npm --prefix shared ci

npm --prefix frontend run build
npm --prefix backend run dev
```

`http://localhost:8788`에서 SPA와 Functions를 함께 확인할 수 있습니다. 프런트엔드 변경을 즉시 반영하려면 위 서버를 유지하고 다른 터미널에서 실행합니다.

```bash
npm --prefix frontend run dev
```

Vite의 `http://localhost:5173`에서 `/api` 요청은 로컬 Pages 서버의 `8788` 포트로 전달됩니다. 실제 공개 API 조회에는 인터넷 연결이 필요합니다.

```bash
npm --prefix shared run check     # 공통 타입·참조 해석 테스트
npm --prefix frontend run check   # 프런트엔드 타입·단위 테스트
npm --prefix backend run check    # Functions 타입·단위 테스트

npm --prefix shared run build     # 공통 TypeScript 검증
npm --prefix frontend run build   # frontend/dist 생성
npm --prefix backend run build    # Functions를 backend/dist로 컴파일
```

화면 테스트는 프런트엔드 패키지에서 실행합니다. 앞서 안내한 백엔드 의존성 설치도 완료되어 있어야 합니다.

```bash
npm --prefix frontend exec -- playwright install chromium
npm --prefix frontend run test:e2e
```

Playwright 설정이 SPA 빌드와 백엔드의 로컬 Pages 서버 실행을 처리합니다. 테스트 파일은 `frontend/tests/`에 있습니다.

단위 테스트는 외부 API를 모의 응답으로 검사합니다. 공개 API와의 실제 연동은 로컬 Pages 서버 또는 Cloudflare Preview에서 별도로 확인합니다.

## Cloudflare Pages 자동 배포

소스 저장소: [SH4316/ComposeLens](https://github.com/SH4316/ComposeLens)

Cloudflare 계정에서 최초 한 번 GitHub 저장소 접근을 연결해야 합니다. 저장소에 있는 설정 파일만으로 계정 인증이나 Pages 프로젝트 연결이 생성되지는 않습니다.

1. Cloudflare 대시보드에서 **Workers & Pages → Create application → Pages → Connect to Git**으로 이동합니다.
2. GitHub의 `SH4316/ComposeLens` 저장소를 선택합니다.
3. 아래 빌드 설정으로 Pages 프로젝트를 만듭니다.

| 설정 | 값 |
| --- | --- |
| 프로젝트 이름 | `composelens` |
| Production branch | `main` |
| Root directory | `backend` |
| Build command | `npm --prefix ../frontend ci && npm --prefix ../frontend run build` |
| Build output directory | `../frontend/dist` |
| Node.js 설정 | 빌드 환경변수 `NODE_VERSION=24` |

Cloudflare는 프로젝트 루트인 `backend/`의 의존성을 설치하고 `backend/functions/`를 번들합니다. 빌드 명령은 프런트엔드 의존성을 설치한 뒤 SPA를 만듭니다. `shared/`는 로컬 `file:` 의존성으로 연결된 순수 TypeScript 패키지이므로 production 빌드에 공통 패키지의 개발 의존성을 별도로 설치할 필요는 없습니다.

이후 `main`에 push하면 Pages가 SPA와 Functions를 같은 프로젝트에 함께 배포합니다. [Git 연동 안내](https://developers.cloudflare.com/pages/get-started/git-integration/), [Functions 배포 안내](https://developers.cloudflare.com/pages/functions/get-started/)

`backend/wrangler.jsonc`는 프로젝트명·SPA 출력 위치(`../frontend/dist`)·런타임 호환 날짜를 선언합니다. `frontend/public/_routes.json`은 Vite 빌드 시 `frontend/dist/`로 복사되며 `/api/*`에만 Functions를 적용합니다. 정적 페이지·자산은 Pages에서 제공합니다. 런타임 API 키나 Secret 바인딩을 추가할 필요가 없습니다.

GitHub의 `Check` 워크플로는 push·PR에서 세 패키지를 독립적으로 설치하고 타입·단위 테스트·빌드를 검증합니다. Cloudflare Git 연동 배포는 별도 작업이므로 이 워크플로의 성공을 자동 배포 조건으로 가정하지 않습니다.

최초 배포 후 Preview 또는 production URL에서 Compose 조회, 이미지 정보, CVE 상세, 태그 변경을 확인하세요. 배포 URL은 Cloudflare가 실제 생성한 값을 사용합니다.
