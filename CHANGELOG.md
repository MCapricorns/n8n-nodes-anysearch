# Changelog

All notable changes to this project will be documented in this file.

## 1.2.0 (2026-11-27)

This release replaces the transitional builds 1.1.3 to 1.1.11.

### Capability catalog

- Sync the bundled capability catalog with `GET /v1/sub-domains`, reviewed on 2026-11-27: 17 domains, 40 capability tags, and 206 tag-specific fields, 25 of them required. `agriculture.fao` becomes `agriculture.stats` with a required `item`. `security.intel`, `security.noise`, and `security.scan` become `security.asset`, `security.malware`, and `security.threat_intel`. The catalog gains the tag `resource.video`, and `resource.image` gains `type`. `code.snippet` gains `regex`, `gaming.esports` gains `count`, and `gaming.store` gains `language` and `region`.
- Read required flags and descriptions together. `market` is now required by `finance.quote`, `finance.fundamental`, `finance.macro`, and `finance.screen`. `academic.citation` needs `id` for every operation except a metadata keyword search, and `academic.paper` accepts a DOI lookup as a bare DOI, a `doi:` prefix, or an `http(s)://doi.org/` URL. A request that misses a required field stops in n8n with the field name instead of reaching AnySearch.
- Reject fields and types that the catalog no longer defines: `cn_code`, `country`, the earlier citation and dataset fields, the flight `origin`, `destination`, and `type` fields, `type` in `travel.flight_status` and `environment.aqi`, and the `finance.news` types `flash` and `announcement`.
- Validate the current definitions: finance news types and long-form sources; calendar types, date types, event types, and exchanges; fundamental report bases, selections, metric IDs, and filing types; macro periods, measures, and tenors; quote operations, frequencies, adjustments, and NAV types; screen ranges, sorts, and snapshot dates; citation operations with the identifier that each one supports; DataCite resource types; agriculture domains and years; air quality locations; esports regions, tiers, divisions, queues, and Riot IDs; and threat-intel subject types.
- Enforce the conditions stated in field descriptions: market and type support, symbols for stock news, transcripts, and security-level quotes, report periods for report-end statements and transcripts, event types and exchanges for corporate actions and trading calendars, and the flight return date.
- Follow the documented DOI, ORCID, ISBN, ISSN, and OMID identifier standards, including check digits.
- Send parameters exactly as entered. The node adds no defaults and no longer supplies an empty flight status `departure`, an empty unused fundamental ticker, or the 90-day earnings calendar period.
- Drop limits that the catalog does not state: the CFR title range, publication year order, and effective date order.
- Compare the bundled catalog with the live directory on every push.

### Search and Batch Search

- Apply the same catalog validation in Search and Batch Search, and keep a single node version, `typeVersion: 1`.
- Require a Batch Search list of 1 to 5 query objects and validate each REST request before sending it. Reject unsupported `zone` and `format` values, and omit empty tag parameters.
- Repair the duplicated Reddit origin in comment URLs, and correct the finance quote parameter example in the node editor.

### Errors

- Route errors with their request ID, HTTP status, and batch index to the dedicated error output.
- Preserve the HTTP status, request ID, business code, and error code in n8n error output, also when a successful envelope contains malformed data. HTTP 402 keeps only the status and request ID.
- Show retry guidance for a temporary HTTP 403 access restriction, and name a missing catalog field that AnySearch reports with HTTP 400.

### Extract and discovery

- Reject embedded credentials and non-public IPv4 and IPv6 literal addresses in Extract before sending a request. Keep globally reachable addresses available.
- Reject a comma-separated domain value inside a Get Sub-Domains array, and continue to support saved workflows that use a single comma-separated string.

### Verification

- Run lint, unit tests, and the live catalog comparison on every push.
- Check the node in a real n8n instance: transport faults without an account, the authenticated workflow with an AI Agent, and a capability matrix of 200 requests that covers every catalog field and tag. The matrix compares each outgoing HTTP body with the entered request and checks returned records against the requested filters. 68 further requests with missing, malformed, or removed values are rejected by the node before any HTTP request. Evidence records request IDs, outgoing bodies, returned URLs and fields, and short response summaries; HTTP 402 keeps only the status and request ID.
- Known upstream behavior observed on 2026-11-27 with n8n 2.49.8 and Node.js 26.13.1:
  - Availability varies by provider and between runs. In the last matrix run, 32 of 199 requests returned HTTP 503 and two responses were cut off. HTTP 502 occurs for unknown discovery domains and HTTP 422 for some public Extract targets.
  - `agriculture.stats` returns HTTP 400 for a `partner` with an `element` when the FAOSTAT detailed trade matrix has no row for the combination, for example `partner: China`. `China, mainland` returns a record.
  - `gaming.esports` returns HTTP 400 when `player` has no `game_name` or `match_detail` has no `match_id`, although the catalog does not require them. The example match ID `KR_7482819248` does not exist and is answered with a `no_data` record.
  - `finance.news` type `long_form` returns the provider text without a URL. A source without articles answers with a coverage status.
  - `environment.aqi` returned HTTP 400 for two `lat,lng` pairs that a semicolon separates, while the same pairs separated by `and` are accepted.
  - The `linkedin_people`, `linkedin_jobs`, `linkedin_company`, and `linkedin_posts` types of `social_media.social_media` returned general web pages instead of LinkedIn pages.
  - `legal.legislation` returned congress.gov bills for the `CFR`, `FR`, and `USCODE` collections and for Canadian rules, and `ip.global` returned patents of other assignees for an `applicant` filter.
  - An `academic.person` lookup can return `AMBIGUOUS_IDENTITY`, and `reddit_comment` can return a parent thread instead of a comment link.

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
