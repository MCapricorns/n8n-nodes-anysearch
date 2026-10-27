# Changelog

All notable changes to this project will be documented in this file.

## 1.0.0

- Reject malformed response envelopes and invalid result arrays instead of returning empty results.
- Surface selected credential read failures; allow blank keys and omit empty Bearer values.
- Assert smoke test outcomes, including authenticated routing, and run regression tests before publishing.
- Add offline regression coverage and exclude review assets from the npm package.

## 0.1.4 (2026-09-23)

- Use the fully-qualified Codex node identifier `n8n-nodes-anysearch.anySearch`.
- Replace the unsupported `AI` Codex category with `Utility`.

## 0.1.0 (2026-09-22)

- Initial release.
- AnySearch node with Search, Extract, and Capability resources.
- AnySearch API credential (optional — the API also allows anonymous access).
