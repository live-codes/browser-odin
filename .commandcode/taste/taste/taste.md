# Taste
- Prefers combining capabilities into a single unified option rather than forcing the user to choose between mutually exclusive modes/targets (e.g., wanting stdin and JS/DOM in the same target). Confidence: 0.5
- Prefers to start a substantial feature with a minimal proof-of-concept (e.g., a simple standalone HTML page that runs) before wiring it into the larger project. Confidence: 0.6
- Favors fully client-side, no-server solutions: functionality should run in the browser with nothing compiled or executed on a backend. Confidence: 0.7
- Targets LiveCodes as the delivery surface for these browser-POC projects: wants compiled output surfaced in LiveCodes' compiled-code viewer and executed in the result page, not only a standalone page. Confidence: 0.5
- Prefers to commit built artifacts (e.g., wasm bundles, packed assets) into the repo rather than gitignore them, so the project can be served later without a build step. Confidence: 0.85
- Wants work committed as it progresses ("keep committing"), rather than leaving changes uncommitted. Confidence: 0.7
- Values genuinely readable compiled output rather than opaque wrappers — rejects "compiled JS" that merely embeds a wasm blob, since it is "no use for anyone to read". Confidence: 0.6
- Prefers new features to follow the existing conventions/patterns of comparable implementations in the codebase (e.g., building an Odin wasm language "like other wasm languages") rather than inventing a new mechanism. Confidence: 0.5
