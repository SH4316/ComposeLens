# ComposeLens 실행과 배포

설치부터 로컬 실행, 테스트, Cloudflare Pages의 GitHub 연동 배포까지 안내합니다. 프로젝트의 기능과 구조는 [README.md](README.md)에 설명되어 있습니다.

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

## 검증

```bash
npm --prefix shared run check     # 공통 타입·참조 해석 테스트
npm --prefix frontend run check   # 프런트엔드 타입·단위 테스트
npm --prefix backend run check    # Functions 타입·단위 테스트

npm --prefix shared run build     # 공통 TypeScript 검증
npm --prefix frontend run build   # frontend/dist 생성
npm --prefix backend run build    # Functions를 backend/dist로 컴파일
```

### 화면 테스트

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

자동 배포를 설정하기 전에 GitHub 저장소의 `main` 브랜치에 소스 코드가 push되어 있어야 합니다.

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

### 빌드 출력과 라우팅

Vite는 `frontend/dist/`에 SPA를 만듭니다. 백엔드의 `build`는 `backend/dist/`에 Functions를 컴파일해 검증하는 명령입니다. Pages의 정적 파일 출력 경로는 `frontend/dist/`를 가리킵니다.

`backend/wrangler.jsonc`는 프로젝트명·SPA 출력 위치(`../frontend/dist`)·런타임 호환 날짜를 선언합니다. `frontend/public/_routes.json`은 Vite 빌드 시 `frontend/dist/`로 복사되며 `/api/*`에만 Functions를 적용합니다. 정적 페이지·자산은 Pages에서 제공합니다. 런타임 API 키나 Secret 바인딩을 추가할 필요가 없습니다.

GitHub의 `Check` 워크플로는 push·PR에서 세 패키지를 독립적으로 설치하고 타입·단위 테스트·빌드를 검증합니다. Cloudflare Git 연동 배포는 별도 작업이므로 이 워크플로의 성공을 자동 배포 조건으로 가정하지 않습니다.

최초 배포 후 Preview 또는 production URL에서 Compose 조회, 이미지 정보, CVE 상세, 태그 변경을 확인하세요. 배포 URL은 Cloudflare가 실제 생성한 값을 사용합니다.
