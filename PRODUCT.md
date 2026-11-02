# ComposeLens

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

User-approved React SPA, Vite, TypeScript, SVG connections, Cloudflare Pages with Pages Functions. GitHub integration deploys the source from SH4316/ComposeLens.

## Users

Developers inspecting Compose dependencies on a desktop while working.

## Product Purpose

Enter a public GitHub repository URL and a Compose path, then explore images and their existing vulnerability analysis as a connected two-column view.

## Capabilities and Constraints

- Left image list, right CVE list, many-to-many arrows; selecting either side highlights its connections.
- Group findings by CVE; the detail drawer retains per-image package and installed/fixed versions.
- Shared severity, remediation and search filters narrow both lists. Lists scroll continuously and independently.
- Floating tags resolve to their current image. Any reference without a digest is visually uncertain. Users can select another tag or digest without changing GitHub files.
- Read one Compose file, YAML anchors and inline variable defaults. Unresolved variables, build-only services and external composition are disclosed.
- Reuse public Docker Hub / Scout analysis. No scanning, user login, permanent API keys or database. Missing analysis is distinct from zero vulnerabilities.
- Scout's web API is an external, undocumented integration whose availability may change.
- Light/dark themes follow the system initially and can be toggled. Korean interface; PC first, usable narrow layout.

## Product Principles

- Keep source references and the actual analyzed digest visible.
- Separate uncertainty of image selection from severity of an existing finding.
- Preserve partial results and explain missing data.
- Keep infrastructure and credentials out of the visitor flow.
