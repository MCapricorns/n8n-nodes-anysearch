# Changelog

All notable changes to this project will be documented in this file.

## 1.1.2 (2026-11-05)

- Verify REST-only requests and ensure saved Feedback steps cannot send requests in any n8n error mode.
- Rebuild before packing and consolidate REST request handling.
- Remove the duplicate smoke runner and catalog fixture tests; retain focused contracts and the live capability matrix.

## 1.1.1 (2026-11-04)

- Remove Feedback > Submit Score and the embedded MCP client to comply with n8n community node verification requirements; all remaining operations use the AnySearch REST API.
- Remove feedback from the live workflow runner and add regression coverage ensuring saved Feedback steps cannot send requests.
- Document migration to n8n's built-in MCP Client Tool for MCP-only operations.
- Stop tracking the docs directory and remove the README link to it.

## 1.1.0 (2026-11-04)

- Add parallel Batch Search and MCP score feedback with validated input and partial-failure output.
- Preserve request IDs and HTTP status while removing raw upstream error messages and credential-bearing bodies.
- Validate search, extraction, and capability responses; enforce search bounds, request timeouts, and redirect restrictions.
- Support n8n error-output routing with diagnostic fields and retain input pairing across searches and failures.
- Add a dark credential icon and document discovery, provider parameters, extraction limits, feedback, and Cloud availability.
- Add real n8n workflow, AI Agent, transport fault, and live capability acceptance coverage.
- Update development and release tooling.

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
