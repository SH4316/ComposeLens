# ComposeLens

공개 GitHub 저장소의 Compose 파일을 읽고, 이미지와 공개 취약점 분석 결과를 연결해서 살펴보는 개발 도구입니다. 저장소 URL과 Compose 파일 경로를 입력하면 좌측에는 이미지, 우측에는 CVE 목록이 표시됩니다.

개발 중 사용하는 컨테이너 이미지에 어떤 취약점이 연결되어 있는지 확인하고, 이미지 안의 패키지와 수정 버전을 살펴볼 수 있습니다. Docker Hub·Scout가 제공하는 기존 분석 결과를 조회합니다.

## 사용 흐름

1. 공개 GitHub 저장소 URL과 저장소 기준의 Compose 파일 경로를 입력합니다.
2. 이미지 또는 CVE를 선택해 연결된 항목을 확인합니다.
3. 검색·심각도·수정 여부로 결과를 좁히고, 상세 패널에서 이미지별 패키지와 버전을 살펴봅니다.
4. 다른 태그나 digest를 선택해 비교할 버전의 취약점을 조회합니다.

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

## 지원 범위

- 공개 GitHub 저장소의 단일 Compose 파일을 지원합니다. YAML 앵커와 인라인 변수 기본값을 해석합니다.
- `.env`, 외부 `include`·`extends` 파일은 읽지 않습니다. 값이 없는 변수, `build:`만 있는 서비스 등은 미해결 항목으로 표시합니다.
- 이미지 조회는 공개 Docker Hub를 대상으로 합니다. 다른 레지스트리와 공개 분석 데이터가 없는 이미지는 지원·제공 상태를 따로 표시합니다.
- **분석 정보 미제공·조회 실패와 취약점 0개는 다른 상태입니다.** 일부 이미지 조회가 실패해도 다른 이미지의 결과는 유지합니다.
- Docker Scout 웹 API는 공식 외부 연동 계약이 문서화된 API가 아닙니다. 응답 구조·익명 접근 정책이 바뀌면 조회 어댑터 수정이 필요할 수 있습니다. [Docker Scout의 분석 방식](https://docs.docker.com/scout/explore/analysis/)
- GitHub·Docker의 익명 API 요청 제한과 일시적인 네트워크 오류가 적용됩니다.

## 실행과 배포

설치·로컬 실행·검증·Cloudflare Pages 자동 배포 방법은 [Deploy.md](Deploy.md)를 참고하세요.
