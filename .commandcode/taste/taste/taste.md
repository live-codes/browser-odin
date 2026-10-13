# Taste
- Prefers combining capabilities into a single unified option rather than forcing the user to choose between mutually exclusive modes/targets (e.g., wanting stdin and JS/DOM in the same target). Confidence: 0.5
- Prefers to start a substantial feature with a minimal proof-of-concept (e.g., a simple standalone HTML page that runs) before wiring it into the larger project. Confidence: 0.6
- Favors fully client-side, no-server solutions: functionality should run in the browser with nothing compiled or executed on a backend. Confidence: 0.7
- Targets LiveCodes as the delivery surface for these browser-POC projects: wants compiled output surfaced in LiveCodes' compiled-code viewer and executed in the result page, not only a standalone page, and wants deliverables framed "for use in LiveCodes". Confidence: 0.6
- Prefers to commit built artifacts (e.g., wasm bundles, packed assets) into the repo rather than gitignore them, so the project can be served later without a build step. Confidence: 0.85
- Wants work committed as it progresses ("keep committing"), rather than leaving changes uncommitted. Confidence: 0.7
- Values genuinely readable compiled output rather than opaque wrappers — rejects "compiled JS" that merely embeds a wasm blob, since it is "no use for anyone to read". Confidence: 0.6
- Prefers new features to follow the existing conventions/patterns of comparable implementations in the codebase (e.g., building an Odin wasm language "like other wasm languages" by simulating the sibling wasm languages) rather than inventing a new mechanism. Confidence: 0.75
- Expects the project's own contribution/docs guide to be read and followed when working inside a repo (e.g., pointing to the "adding languages" guide before doing a LiveCodes integration), and expects the full documented set of integration touchpoints to be covered. Confidence: 0.55
dence: 0.65
- Favors packaging functionality as a self-contained, publishable/reusable npm package (own README as the contract, LICENSE, third-party notices, its own copy of assets) so it can be embedded by LiveCodes and other consumers, rather than keeping it only inside the app. Confidence: 0.55
- Cares that documentation stays current and accurate: expects READMEs/docs (and the concrete numbers/claims in them) to be verified against reality and updated before publishing or integrating. Confidence: 0.5
- Expects shipped starter/sample templates to genuinely work interactively end-to-end, not merely compile — he exercises the demo behavior himself (e.g. clicking through the template) and reports when it doesn't behave as advertised. Confidence: 0.5
- Pushes for edge cases to be handled at the correct layer with idiomatic, language-expected behavior (asking "what would a developer of that language expect / what's the usual behaviour?") rather than patching symptoms or silently papering over them upstream. Confidence: 0.5
- Expects user-facing language docs to cover the interoperability surface (JavaScript interop, DOM access, canvas) and not just the basic "hello world" usage. Confidence: 0.45
- Asks for a readiness audit before publishing/integrating ("do we need to do anything before we publish... are the docs up to date?"): expects publish blockers and stale docs to be surfaced and fixed in advance rather than discovered later. Confidence: 0.5
