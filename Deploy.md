# ComposeLens 실행과 배포

Docker Compose 실행, Node.js 로컬 개발, Cloudflare Pages 배포를 안내합니다. 프로젝트의 기능과 구조는 [README.md](README.md)에 설명되어 있습니다.

## Docker Compose

Docker Engine과 Docker Compose 플러그인이 필요합니다. 다음 명령은 저장소 루트에서 실행합니다. 호스트에 Node.js나 Nginx를 별도로 설치할 필요는 없습니다.

```bash
docker compose -f deployment/compose.yml up --build -d
```

`http://localhost:8080`으로 접속합니다. React를 빌드한 정적 파일은 Nginx가 제공하며, `/api`와 `/api/*`는 내부 백엔드 컨테이너의 `3000` 포트로 전달합니다. 백엔드 포트는 호스트에 공개하지 않습니다. 두 서비스의 `/healthz` 검사를 사용하며, 백엔드가 준비되면 Nginx를 시작합니다.

두 서비스는 같은 `app` 브리지 네트워크에 연결됩니다. Nginx는 Docker DNS(`127.0.0.11`)와 동적 upstream을 사용해 `backend` 주소를 다시 조회합니다. 시작할 때 DNS가 잠시 응답하지 않아도 Nginx가 종료되지 않으며, 백엔드를 재생성해 IP가 바뀌어도 재조회합니다. DNS가 복구되기 전 API는 `502`를 반환할 수 있습니다. [Nginx 동적 주소 조회](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#resolve), [Docker DNS](https://docs.docker.com/engine/network/#dns-services)

이전 설정에서 `host not found in upstream "backend"`가 발생했다면 수정된 Nginx 이미지와 네트워크를 적용하도록 두 컨테이너를 재생성합니다.

```bash
docker compose -f deployment/compose.yml up --build -d --force-recreate
```

```text
브라우저 → localhost:8080 → Nginx
                            ├─ /, /assets/* → React 빌드 파일
                            └─ /api/*       → Node.js 백엔드:3000
```

프런트엔드·백엔드 이미지는 각각 여러 단계로 빌드합니다. 프런트엔드 실행 이미지에는 빌드된 정적 파일과 Nginx만 복사합니다. 백엔드는 기존 Pages API와 같은 요청 처리 로직을 Node.js HTTP 서버로 실행하며, 실행 이미지에는 번들된 `server.mjs`만 복사하고 npm·Yarn을 제거합니다. 두 프로세스는 일반 사용자로 실행합니다.

```bash
# 포트 변경
PORT=9090 docker compose -f deployment/compose.yml up --build -d

# 상태, 로그, 라우팅 확인
docker compose -f deployment/compose.yml ps
docker compose -f deployment/compose.yml logs -f
sh deployment/smoke-test.sh http://localhost:9090

# 종료
docker compose -f deployment/compose.yml down
```

### Cloudflare Tunnel (선택)

기존 Nginx를 Cloudflare Tunnel로 공개하려면 저장소 루트에서 예제 파일을 복사합니다.

```bash
cp deployment/.env.example deployment/.env
```

Cloudflare 대시보드에서 원격 관리 Tunnel을 만들고 발급받은 토큰을 `deployment/.env`의 `CLOUDFLARE_TUNNEL_TOKEN`에 넣습니다. 공개 호스트명에 연결할 서비스는 **HTTP · `web:8080`** (`http://web:8080`)으로 지정합니다. `localhost` 대신 같은 Compose 네트워크의 Nginx 서비스 이름을 사용합니다. [Tunnel 설정 안내](https://developers.cloudflare.com/tunnel/get-started/)

토큰은 **Tunnels → 해당 Tunnel → Add a replica**의 커넥터 설치 명령에서 `--token` 뒤에 있는 긴 `eyJ...` 문자열입니다. 명령 전체, Tunnel ID(UUID), Cloudflare 계정의 API 토큰을 입력하면 `Provided Tunnel token is not valid.` 오류가 발생합니다. [Tunnel 토큰 가져오기](https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/)

```bash
docker compose -f deployment/compose.yml up --build -d
docker compose -f deployment/compose.yml logs -f cloudflared
```

토큰을 수정한 뒤에는 `docker compose -f deployment/compose.yml up -d --force-recreate cloudflared`로 커넥터를 재생성하면 됩니다. `restart`만 실행하면 기존 컨테이너의 환경변수는 바뀌지 않습니다.

Compose는 `deployment/.env`를 자동으로 읽습니다. 토큰이 있으면 예제의 `CLOUDFLARE_TUNNEL_REPLICAS` 표현식이 `1`로 평가되어 커넥터를 실행합니다. `.env`가 없거나 토큰이 비어 있으면 `0`으로 설정되어 Tunnel 컨테이너를 생성하지 않습니다. [Compose 환경변수 보간](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)

Tunnel을 끄려면 토큰을 비우고 같은 `up --build -d` 명령을 다시 실행합니다. 기존 커넥터도 0개로 줄어들어 종료됩니다. `.env`는 Git과 Docker 빌드 컨텍스트에서 제외되며, 토큰은 커넥터 컨테이너에만 전달합니다. 별도 환경변수로 `CLOUDFLARE_TUNNEL_REPLICAS`를 고정했다면 자동 설정보다 우선합니다.

```text
브라우저 → Cloudflare Tunnel → cloudflared → web:8080 → backend:3000
```

Tunnel은 앱으로 들어오는 연결을 처리합니다. Docker Hub·Scout 조회는 이 Compose 백엔드가 실행되는 서버에서 나갑니다. 커넥터 이미지는 공식 `cloudflare/cloudflared:2026.10.7`의 amd64·arm64 digest로 고정했습니다. [cloudflared 릴리스](https://github.com/cloudflare/cloudflared/releases/tag/2026.10.7)

### 베이스 이미지

2026-11-02 기준 최신 정식 Node.js `26.13.0`과 최신 Nginx mainline `1.31.8`의 공식 이미지 변형을 비교했습니다. Docker Hub 태그와 OCI manifest를 대조해 digest를 고정했으며, 두 이미지 모두 amd64·arm64를 지원합니다. [Node 공식 이미지](https://hub.docker.com/_/node), [Nginx 공식 이미지](https://hub.docker.com/_/nginx)

| 용도 | 고정한 이미지 | OCI index digest |
| --- | --- | --- |
| React 빌드·Node 백엔드 | `node:26.13.0-alpine3.24` | `sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94` |
| Nginx | `nginx:1.31.8-alpine3.24-slim` | `sha256:f45171d36c76a8b2f5ef97108a3a8a2294248a6578a0a180edc2d78f7d2edc26` |

동일 플랫폼의 Docker Scout 기존 분석에서 Node Alpine은 고유 CVE 20건, Debian slim은 57~70건이었습니다. Nginx Alpine slim은 1건, 일반 Alpine은 37건, Debian은 96건으로, 비교한 최신 공식 변형 중 적게 보고된 구성을 선택했습니다. 분석 미제공을 0건으로 세지 않았습니다.

Node의 19건은 실제 이미지의 `/usr/local/lib/node_modules/npm/node_modules/`에 있는 패키지에서 확인되어 실행 이미지에서 npm과 함께 제거합니다. 남은 musl 1건(`CVE-2026-107891`)은 Scout가 다른 Alpine 브랜치의 수정 버전을 적용한 것으로 보이며, Alpine 3.24 공식 트래커는 이미지에 포함된 `1.2.6-r3`을 수정 완료로 표시합니다. [Alpine 보안 트래커](https://security.alpinelinux.org/vuln/CVE-2026-107891)

이는 베이스 이미지의 해당 시점 분석이며, 최종 애플리케이션 이미지의 직접 스캔 결과는 아닙니다. digest를 고정하므로 같은 명령으로 빌드해도 베이스 이미지가 자동 변경되지 않습니다. 갱신할 때 `NODE_IMAGE`·`NGINX_IMAGE` 빌드 인자를 새 버전과 digest로 지정하거나 Dockerfile·Compose 기본값을 함께 갱신합니다.

GitHub `Check` 워크플로의 `containers` 작업은 실제 Docker 환경에서 Compose 설정 검사, 이미지 빌드·기동 및 `deployment/smoke-test.sh`를 수행합니다. 이 검사는 정적 파일·SPA 경로·API 프록시·오류 상태를 확인하며 취약점 스캐너를 실행하는 작업은 아닙니다.

`deployment/check-dns-recovery.sh`는 별도 테스트 프로젝트에서 백엔드 없이 Nginx를 먼저 시작한 뒤 백엔드 추가·재생성 후 API가 복구되는지 확인합니다. Nginx 컨테이너의 재시작 없이 복구되어야 통과합니다. 테스트 포트는 기본 `18080`이며 `DNS_TEST_PORT`로 바꿀 수 있습니다.

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
npm --prefix backend run build:node # backend/dist/server.mjs 생성
```

### 화면 테스트

화면 테스트는 프런트엔드 패키지에서 실행합니다. 앞서 안내한 백엔드 의존성 설치도 완료되어 있어야 합니다.

```bash
npm --prefix frontend exec -- playwright install chromium
npm --prefix frontend run test:e2e
```

Playwright 설정이 SPA 빌드와 백엔드의 로컬 Pages 서버 실행을 처리합니다. 테스트 파일은 `frontend/tests/`에 있습니다.

단위 테스트는 외부 API를 모의 응답으로 검사합니다. 공개 API와의 실제 연동은 로컬 Pages 서버 또는 Cloudflare Preview에서 별도로 확인합니다.

Docker 없이 Node 백엔드만 실행하려면 `npm --prefix backend run build:node` 후 `npm --prefix backend start`를 실행합니다. 기본 주소는 `http://localhost:3000`이며 `HOST`·`PORT`로 바꿀 수 있습니다. 이 서버는 API만 제공합니다. 위의 Vite 개발 모드는 `8788`의 Pages 백엔드에 연결하며, Node 서버와 정적 프런트엔드를 함께 제공하는 구성은 Docker Compose의 Nginx 설정을 참고하세요.

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
| Build command | `npm run build:pages` |
| Build output directory | `dist/pages` (`wrangler.jsonc`에서 지정) |
| Node.js 설정 | `backend/.node-version`의 `24` (환경변수로 지정한다면 `NODE_VERSION=24`) |

Cloudflare는 프로젝트 루트인 `backend/`의 의존성을 설치하고 `backend/functions/`를 번들합니다. `build:pages`는 프런트엔드 의존성을 설치한 뒤 SPA를 `backend/dist/pages/`에 만듭니다. `shared/`는 로컬 `file:` 의존성으로 연결된 순수 TypeScript 패키지이므로 production 빌드에 공통 패키지의 개발 의존성을 별도로 설치할 필요는 없습니다.

기존 프로젝트라면 대시보드의 Build command도 `npm run build:pages`로 바꾸세요. 출력 경로는 Wrangler 설정이 적용하며 대시보드에서 편집할 필요가 없습니다. 기존 `../frontend/dist` 설정은 Pages 프로젝트 루트 밖으로 나가 `build output directory is outside of the repository` 오류를 일으킵니다. Node 버전을 별도 환경변수로 고정했다면 production·preview 모두 `24`로 맞추세요. [Wrangler 설정 우선순위](https://developers.cloudflare.com/pages/functions/wrangler-configuration/#source-of-truth), [빌드 Node 버전 지정](https://developers.cloudflare.com/pages/configuration/build-image/)

이후 `main`에 push하면 Pages가 SPA와 Functions를 같은 프로젝트에 함께 배포합니다. [Git 연동 안내](https://developers.cloudflare.com/pages/get-started/git-integration/), [Functions 배포 안내](https://developers.cloudflare.com/pages/functions/get-started/)

### 빌드 출력과 라우팅

일반 Vite 빌드는 `frontend/dist/`에 SPA를 만듭니다. Docker와 로컬 개발은 이 경로를 계속 사용하며, `backend`의 `dev` 명령도 해당 경로를 명시합니다. Pages 전용 `npm --prefix backend run build:pages`는 출력 경로만 `backend/dist/pages/`로 바꿉니다. 백엔드의 `build`는 `backend/dist/`에 Functions를 컴파일해 검증하는 별도 명령입니다.

`backend/wrangler.jsonc`는 프로젝트명·SPA 출력 위치(`./dist/pages`)·런타임 호환 날짜를 선언합니다. Pages 정적 출력에는 SPA 파일만 포함되며, 같은 `backend/dist/`의 Functions·Node 번들은 포함되지 않습니다. `frontend/public/_routes.json`은 Vite 빌드 시 정적 출력으로 복사되며 `/api/*`에만 Functions를 적용합니다. 정적 페이지·자산은 Pages에서 제공합니다. 런타임 API 키나 Secret 바인딩을 추가할 필요가 없습니다.

GitHub의 `Check` 워크플로는 push·PR에서 세 패키지를 독립적으로 설치하고 타입·단위 테스트·빌드를 검증합니다. Pages 전용 빌드도 실행해 Wrangler의 출력 경로가 `backend/` 안에 있고 SPA·API 라우팅 파일이 생성됐는지 확인합니다. Cloudflare Git 연동 배포는 별도 작업이므로 이 워크플로의 성공을 자동 배포 조건으로 가정하지 않습니다.

최초 배포 후 Preview 또는 production URL에서 Compose 조회, 이미지 정보, CVE 상세, 태그 변경을 확인하세요. 배포 URL은 Cloudflare가 실제 생성한 값을 사용합니다.
