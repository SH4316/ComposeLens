# ComposeLens interface

## Direction

Operate: a desktop dependency inspector. The user's specified topology is the authority: images on the left, CVEs on the right, directed relationships between them. Keep the interface useful for reading dense results while developing; avoid a marketing landing page or ornamental graph controls.

## Structure

- Header: product identity, theme control and source link.
- Input area: public GitHub repository and Compose path, with one clear analysis action.
- Shared toolbar: search, severity and remediation filters, result counts and current lookup state.
- Workspace: independently scrolling image and CVE lists separated by an SVG relationship layer.
- Detail drawer: CVE description, source links and per-image package / installed / fixed version rows. Preserve the previous selection and scroll positions when it closes.
- Narrow screens: stack the lists and retain explicit relationship labels. Do not require hover or a wide graph to read the findings.

## Visual system

- Neutral cool surfaces in light mode; restrained ink surfaces in dark mode. Respect the system theme initially.
- Blue marks actions and the current selection. Red, orange and amber encode severity; text and labels also name every state.
- Use a neutral Korean-capable sans for interface copy. Reserve monospace for image references, digest fragments, CVE identifiers and versions. Keep data numerals tabular.
- Dense horizontal rows use consistent alignment and modest corner radii; generous separation between the two lists gives connections room to read.
- Uncertainty belongs to subdued surfaces, borders, badges and dashed relationships. Do not reduce body text or severity-label contrast to communicate it.

## Interaction and state

- Unselected relationships are quiet; selecting either endpoint emphasizes its connected rows and arrows. Connection highlighting does not change the confidence of an image reference.
- Render connection paths only for visible endpoints and recompute them after scrolling or resizing. Keep offscreen relationship counts available in list content.
- Filters narrow findings before CVE grouping so counts, endpoints and detail content agree.
- Distinguish initial, loading, partial results, filtered-empty, no findings, unavailable analysis and failed lookup states.
- Tag and digest choices are local inspection overrides. Show the original declaration alongside the actual analyzed digest and platform.
- Theme controls, focus rings, scrollbar colors and text selection use the same theme tokens. Respect reduced-motion preferences; motion supports selection and drawer state changes.

## Quality checks

Check desktop and narrow layouts together, both themes, keyboard-only navigation, visible focus, drawer focus return, long references and large result sets. Contrast and readable error recovery take priority over opacity effects.
