# ComposeLens interface

## Direction

Operate: a desktop image vulnerability inspector. The primary task is determining which known CVEs exist in an image. The user's specified topology is the authority: images on the left, CVEs on the right, directed relationships between them. Keep the interface useful for reading dense results while developing; avoid a marketing landing page or ornamental graph controls.

## Structure

- UI implementation and assets live in `frontend/`; this source boundary does not change the approved screen layout or behavior.
- Screens are mutually exclusive: input, initial-analysis progress, results. The initial screen shows only GitHub URL and Compose path fields, the analysis button and contextual help. No slogan, intro, example, placeholder results or marketing headline.
- Progress replaces the form until the file and every initial image lookup have settled. It shows a spinner, “분석 중” and the current file/lookup progress, without an artificial minimum delay. A file error restores the form and its values. Per-image retries and version changes keep the result workspace visible.
- No site header. A small footer contains product identity, theme, GitHub source, data help and a results-only reanalysis action. Reanalysis returns to the retained input values.
- Explanations are hidden behind question-mark help buttons, revealed on hover or keyboard focus and dismissible with Escape. Keep critical states such as missing analysis and lookup failure visible; do not replace actual vulnerability data with help text.
- Submitted input is reflected in `?url=...&compose=...`. Direct links initialize and run analysis; omitted Compose paths default to `compose.yml`. Preserve unrelated query parameters and fragments when updating the address.
- Shared toolbar: search, severity and remediation filters, result counts and current lookup state.
- Workspace: independently scrolling image and CVE lists separated by an SVG relationship layer. An image selection scopes the right list to its CVEs; the filtered image inventory stays available on the left. Show the chosen reference and displayed/total CVE counts with an explicit all-images action. Keep additional digest/query metadata in contextual help; the image row retains its analyzed digest and uncertainty badge.
- CVE rows: severity plus package / installed / fixed version summaries, including partial remediation and overflow disclosure.
- Build services show their resolved Dockerfile base reference with a concise “베이스 기준” badge. Keep build provenance (Dockerfile, stage, output tag) and the limitation about RUN/COPY changes in contextual help. Preserve the marker through base-version changes and CVE details; a digest-pinned base still uses subdued surfaces and dashed relationships because it is not the final image analysis.
- For Dockerfiles reached through GitHub submodules, include the actual repository, abbreviated pinned commit and file path in that same help. Resolve Compose-relative paths in the superproject checkout, following each nested submodule's recorded commit.
- Detail drawer: CVE description, source links and package / installed / fixed version rows for the current image scope. Preserve image selection, CVE highlighting and scroll positions when it closes.
- Device scope: PC. Preserve the existing narrow fallback without adding a separate mobile interaction design.

## Implementation boundaries

Keep components, hooks, browser services and UI domain state under `frontend/src/`. API handlers and Docker adapters live under `backend/functions/`. Each of `frontend/`, `backend/` and `shared/` owns its package manifest, lockfile, TypeScript and test configuration; the repository root has no Node package.

Frontend and backend depend on the private `@composelens/shared` package through `file:../shared`. It contains pure TypeScript API contracts and image-reference parsing. Neither layer imports the other layer's implementation. Visual state, Compose parsing and relation-building types stay with the frontend.

Within the frontend domain, `analysis-query-params.ts` handles shared input URLs, `display-formatters.ts` handles display strings and `safe-external-url.ts` validates external links. Browser services use `github-file-client.ts` and `image-api-client.ts`; `build-image-resolver.ts` connects repository file reads to the Dockerfile base resolver.

Build UI assets into `frontend/dist/`. Cloudflare uses `backend/` as its project root and serves that SPA output with `backend/functions/` in one Pages project. The source and package separation preserves the approved visual layout and API behavior.

The Docker Compose deployment under `deployment/` builds those same UI assets into an Nginx image. Same-origin `/api` requests are proxied to a private Node.js backend container that reuses the Pages API handlers. Container deployment does not change the UI flow or public endpoints.

## Visual system

- Neutral cool surfaces in light mode; restrained ink surfaces in dark mode. Respect the system theme initially.
- Blue marks actions and the current selection. Red, orange and amber encode severity; text and labels also name every state.
- Use a neutral Korean-capable sans for interface copy. Reserve monospace for image references, digest fragments, CVE identifiers and versions. Keep data numerals tabular.
- Dense horizontal rows use consistent alignment and modest corner radii; generous separation between the two lists gives connections room to read.
- Uncertainty belongs to subdued surfaces, borders, badges and dashed relationships. Do not reduce body text or severity-label contrast to communicate it.

## Interaction and state

- Unselected relationships are quiet. Image selection scopes findings and highlights its relationships; CVE selection emphasizes its connected endpoints. Connection highlighting does not change the confidence of an image reference. Dashed connections indicate unpinned tags or Dockerfile-base analysis; never label a pinned base as an unpinned tag.
- Image scope recomputes CVE severity and package details using only that image's findings. Left-side CVE counts remain based on the inventory filters, so inspecting one image does not turn unrelated images' counts into zero.
- Reset the right list to the beginning when image scope, its chosen reference or filters change. Opening and closing details does not reset either list.
- Render connection paths only for visible endpoints and recompute them after scrolling or resizing. Keep offscreen relationship counts available in list content.
- Filters narrow findings before CVE grouping so counts, endpoints and detail content agree.
- Distinguish initial, loading, partial results, filtered-empty, no findings, unavailable analysis and failed lookup states. Show coverage and attention counts once at the top. Keep retrieval details in help rather than a duplicate coverage row.
- Tag and digest choices are local inspection overrides. Show the original declaration alongside the chosen reference, actual analyzed digest and platform. Use “이 digest로 조회” to name the action; choosing a tag is a current lookup, not reconstruction of historical latest or past CVE knowledge.
- Theme controls, focus rings, scrollbar colors and text selection use the same theme tokens. Respect reduced-motion preferences; motion supports selection and drawer state changes.

## Quality checks

Check PC layouts in both themes, keyboard-only navigation, visible focus, drawer focus return, long references and large result sets. Verify the three screens, retained inputs, file-error recovery, shared links and encoded paths, help hover/focus/Escape, image scope, filtered versus true zero, partial coverage, version changes and preserved scroll on detail close. Contrast and readable error recovery take priority over opacity effects.
