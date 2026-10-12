# Taste

## Workflow
- Prefers to start a substantial feature with a minimal proof-of-concept (e.g., a simple standalone HTML page that runs) before wiring it into the larger project. Confidence: 0.6

## Tooling / Architecture
- Favors fully client-side, no-server solutions: functionality should run in the browser with nothing compiled or executed on a backend. Confidence: 0.7
- Prefers to commit built artifacts (e.g., wasm bundles, packed assets) into the repo rather than gitignore them, so the project can be served later without a build step. Confidence: 0.85

## Version Control
- Wants work committed as it progresses ("keep committing"), rather than leaving changes uncommitted. Confidence: 0.7
