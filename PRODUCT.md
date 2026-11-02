# ComposeLens

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

User-approved React SPA, Vite, TypeScript, SVG connections, Cloudflare Pages with Pages Functions. GitHub integration deploys the source from SH4316/ComposeLens.

The user-approved source structure has independent `frontend/`, `backend/` and `shared/` packages, each with its own manifest, lockfile, TypeScript and test configuration. The repository root holds documentation and Git metadata, with no root Node package. API handlers and Docker adapters live in `backend/functions/`.

Frontend and backend use the private pure-TypeScript `@composelens/shared` package through `file:../shared` for API types and image-reference parsing. Server code does not import frontend implementation. UI-only contracts (`analysis-types.ts`), Compose and Dockerfile parsing (`compose-parser.ts`, `dockerfile-base-resolver.ts`) and finding relationships (`image-vulnerability-graph.ts`) remain in `frontend/src/domain/`.

Vite builds the SPA into `frontend/dist/`. Cloudflare uses `backend/` as its project root and deploys its Functions with the SPA from `../frontend/dist` in the same Pages project. Package separation preserves the public API and user workflow.

Docker Compose is an additional deployment path in `deployment/compose.yml`. A multi-stage frontend image builds React and serves it through Nginx; Nginx routes `/api` requests to a private Node.js backend container. The Node HTTP entrypoint and Pages Functions share the same API handlers. Runtime images pin current official versions by digest, and the Node runtime omits package managers.

## Users

Developers checking whether a Compose image has known vulnerabilities and reading that image's CVE list on a desktop while working. Mobile-specific improvements are outside the current scope.

## Product Purpose

Enter a public GitHub repository URL and a Compose path, then select an image to inspect its existing vulnerability analysis in a connected two-column view.

## Capabilities and Constraints

- Left image inventory, right CVE list, many-to-many arrows. Selecting an image scopes the right list to that image without removing the other images from the inventory; an explicit all-images action restores the complete view.
- Group findings by CVE. Rows summarize packages and installed/fixed versions, with partial remediation distinguished from all-package remediation. Image scope also applies to CVE severity and detail findings.
- Opening and closing a CVE detail drawer preserves image scope, selection and list scroll positions.
- Use three separate screens: two input fields and an analysis action; progress while the initial analysis runs; results after every initial image lookup settles. Per-image retry and version lookup remain on the results screen.
- The initial screen has no headline, slogan, example, empty results, or visible explanatory paragraphs. Keep copy minimal and reveal explanations through contextual question-mark help on hover or keyboard focus.
- Remove the site header. Keep product identity, theme, source link, data help and the results screen's reanalysis action in the footer. Reanalysis returns to the saved input values.
- Store the submitted GitHub URL and Compose path in the `url` and `compose` query parameters. Shared links start analysis automatically; a missing Compose parameter defaults to `compose.yml`.
- Keep analysis coverage visible above the lists; missing or failed analysis never implies zero CVEs.
- Shared severity, remediation and search filters narrow both lists. Lists scroll continuously and independently.
- Floating tags resolve to their current image. Any reference without a digest is visually uncertain. Users can select another tag or digest without changing GitHub files.
- Read one Compose file, YAML anchors and inline variable defaults. For services with `build`, resolve the repository-local or inline Dockerfile, global ARG defaults and Compose overrides, target stage and inherited stage base. Analyze only the selected stage's external base, preserving the declared output tag as provenance.
- Follow public GitHub submodules at the superproject's recorded gitlink commits for both Compose and Dockerfile paths, including nested mounts and relative repository URLs, up to eight hops. Keep logical checkout paths for build resolution and actual repository/commit/path provenance in contextual help. Unavailable commits, private or non-GitHub submodules remain unknown; never substitute a default branch.
- Dockerfile findings are explicitly base-image analysis, not a scan of the derived image or its RUN/COPY changes. Keep separate build services distinct even when their bases match. Missing files, unsupported contexts, scratch and unresolved bases remain unknown without discarding other services.
- Reuse public Docker Hub / Scout analysis. No scanning, user login, permanent API keys or database. Missing analysis is distinct from zero vulnerabilities.
- Scout's web API is an external, undocumented integration whose availability may change.
- Light/dark themes follow the system initially and can be toggled. Korean interface focused on PC use.

## Product Principles

- Keep source references and the actual analyzed digest visible.
- Separate uncertainty of image selection from severity of an existing finding.
- Preserve partial results and explain missing data.
- Keep infrastructure and credentials out of the visitor flow.
