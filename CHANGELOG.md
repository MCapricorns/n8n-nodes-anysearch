# Changelog

All notable changes to this project will be documented in this file.

## 1.1.6 (2026-11-27)

- Validate individual threat-intelligence indicators and the three-letter shape of flight currency codes in Search and Batch Search.
- Check calendar values in recognized energy and patent date formats. Reject inverted electricity and round-trip flight dates, and validate A-share tickers in operations that use them.
- Preserve only the HTTP status and request ID from quota responses in acceptance logs. Verify outgoing request bodies separately.
- Compare search results and metadata with the captured response. Distinguish confirmed mismatches, missing evidence and nonempty results without a source-specific check.

## 1.1.5 (2026-11-27)

- Keep a single AnySearch node version and apply the same documented parameter validation and defaults in Search and Batch Search.
- Verify required fields, supported tags and documented parameter formats, choices and conditional constraints against the reviewed AnySearch capability catalog.
- Follow the documented DOI, ORCID and ISO identifier standards, apply submission limits before sending requests, and keep malformed batch queries out of error details.
- Preserve HTTP status, request ID, business code and optional error code in n8n error output. Limit HTTP 402 diagnostics to status and request ID.
- Verify outgoing requests and error diagnostics in real n8n. Run isolated fault tests without an AnySearch account.

## 1.1.4 (2026-11-27)

- Enforce the earnings calendar period, the unused fundamental ticker and esports parameter formats and choices in Search and Batch Search.
- Route errors with request IDs, HTTP status and batch indexes to the dedicated error output on n8n 2.17.3.
- Verify source links, document types and exact record identities in acceptance runs. Report empty results and upstream mismatches with their request IDs.
- Check every reviewed capability field through both search operations and compare field definitions with live discovery in CI.

## 1.1.3 (2026-11-26)

- Supply the documented airport and ticker placeholders for flight status, company overviews and A-share fundamentals. Default earnings calendars to 90 days.
- Validate conditional esports, crypto quote and single-citation parameters in Search and Batch Search. Report missing catalog field names on HTTP 400 while preserving the request ID and keeping upstream bodies private.
- Repair the duplicated Reddit origin in comment URLs and correct the finance quote parameter example in the node editor.
- Add live n8n acceptance checks for outgoing requests, returned data, local validation and batch error isolation.
- Forward explicit JSON format, validate complete capability tags, and verify all documented search fields against the live catalog. Reuse the same domain loader for the operation and the picker.

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
