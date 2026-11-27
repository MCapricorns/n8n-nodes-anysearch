# Agent guide

This repository publishes `n8n-nodes-anysearch`. AnySearch changes its capability catalog often, sometimes several times a day. After every change, align all parameters, requests, error codes, filters and local rejections with the catalog again. This guide is the procedure.

## Source of truth

The catalog is the specification. Nothing else.

| What | Where |
| --- | --- |
| Domains and directory version | `GET https://api.anysearch.com/v1/domains` (`topology_version`) |
| Every tag and its parameters | `GET https://api.anysearch.com/v1/sub-domains?domain=academic&domain=finance…` |
| Search, discovery and extract reference | `https://www.anysearch.com/docs/api-endpoints/v1-search.md`, `v1-sub-domains.md`, `v1-extract.md` |
| Bundled copy that the node validates against | `nodes/AnySearch/catalog.json` |

Each parameter carries a `required` flag and a `description`. Read both. The docs state it directly: "Required and conditional parameters: Read both required flags and descriptions. required=false can still have a conditional requirement."

## Rules that never change

1. **Mirror the catalog exactly.** Enforce the `required` flags and what a description states. Do not invent a rule, do not relax a stated one, and do not pass through a usage that the catalog does not define.
2. **Enforce a condition only when the text states it**: "Required for …", "Required when …", "only with …", "Leaderboard only", "Used with …". A rule that depends on a selector (`type`, `op`, `market`) applies only to the values that the description lists.
3. **Send parameters exactly as entered.** No defaults, no injected placeholders, no normalization. The only documented exception is an empty flight `return_date`, which means one-way.
4. **When the live service differs from the catalog, keep following the catalog.** Record the observation under "Known upstream behavior" in `CHANGELOG.md` and report it. Do not add a local rule that copies what the service happens to do today.
5. **Keep secrets and private bodies out of the repository.** HTTP 402 bodies can contain generated credentials: record only the status and request ID. Pass the API key through the environment and write test evidence outside the repository.

## When the catalog changes

Run these steps in order. CI runs the comparison on every push and fails while the node is behind the live directory.

1. **Sync.** `npm run catalog:sync` rewrites `nodes/AnySearch/catalog.json` from the live directory. Then `npm run test:catalog` reports:
   - `changed`: descriptions or required flags that differ from the bundled copy. Review every item.
   - `missing`: live fields that no fixture sends.
   - `unexpected`: fixtures that use a field or tag that no longer exists.
2. **Align the validation.** Required flags need no code: `nodes/AnySearch/capabilityParameters.ts` reads them from the bundled catalog. Descriptions do:
   - `parameterRules.ts` holds the shared field rules (`choice`, `format`, `integer`, `dateRange`, identifier standards).
   - `domainParameterRules.ts`, `marketParameterRules.ts`, `researchParameterRules.ts` and `technicalParameterRules.ts` hold the rules of each tag. Quote the part of the description that a rule implements in a comment.
   - A new field gets a rule for exactly what its description states, or no rule when it is free text. A removed field loses its rule; the node then rejects it as an unsupported parameter.
   - A stated condition becomes a `check` or a selector-scoped rule. Delete a rule when the catalog no longer states its limit.
3. **Align the requests.** In `test/e2e/search-cases.json`, every catalog field must appear in at least one fixture, with a value that the live service accepts. Give a new field its own fixture, remove fixtures of removed fields, and keep each `query` unique. The focused cases in `capability-checks.mjs` find their request by query, so a fixture must not repeat a focused query.
4. **Align the local rejections.** In `test/e2e/capability-checks.mjs`, add one case for each new constraint:
   - `invalid(query, tag, params, ...fields)` expects a local rejection whose message names each field.
   - `rejected(query, tag, params, /message/)` expects a local rejection that matches the pattern.
5. **Align the unit tests.** `test/parameter-validation.test.mjs` covers each rule, `test/contract.test.mjs` runs accepted and rejected examples through both search operations, and `test/acceptance.test.mjs` covers the result checks.
6. **Align the result checks.** `test/e2e/result-checks.mjs` verifies returned records against the request. Write a check only from a response shape that was observed in a real run. A record without enough evidence raises `MissingEvidence` and counts as unverified; a record that contradicts the request is a mismatch.
7. **Align the documentation.** In `README.md`, update the catalog counts, the required-parameters table, the validation bullets and the "Changes from" list. Add the release to `CHANGELOG.md`.
8. **Verify and release.** See below.

## Error contract

The node rejects a request locally and sends nothing:

| Case | Message |
| --- | --- |
| A catalog field flagged as required is absent | `Provide required parameters for <tag>: <fields>.` |
| A parameter is not a field of the tag | `Unsupported parameters for <tag>. Use Get Sub-Domains to find supported fields.` |
| The tag is not in the catalog | `Unknown Capability Tag. Use Get Sub-Domains to find supported tags.` |
| A value breaks its description | `For <tag>, <field> must be <expected>.` |
| A stated condition is not met | `For <tag>, <condition>.` |

A request that passes validation is sent as entered. AnySearch answers:

| Response | n8n output |
| --- | --- |
| HTTP 400 | The missing field name when AnySearch reports it, `Invalid capability tag.` for `INVALID_TAG`, otherwise a general rejection. Request ID, business code and error code are kept. |
| HTTP 401, 415, 422, 429, 502 | A fixed message for each status. |
| HTTP 402 | A quota message. Only the status and request ID are kept. |
| HTTP 403 `access_temporarily_restricted` | Retry guidance. |
| HTTP 503 | The service message `Search is temporarily unavailable. Retry, or retry as a general search.` |
| A public service message | The message itself, when it is in the allowlist in `AnySearch.node.ts`. Other upstream text stays private. |
| Any other status | `AnySearch returned HTTP <status>.` |
| A successful envelope with malformed data | An error that keeps the HTTP status, business code and request ID. |

Errors carry the request ID, HTTP status and error code in `details`. Batch Search adds the query index and routes each failed query to the error output.

## Verify

```sh
npm run build
npm test            # unit and contract tests
npm run lint
npm run test:catalog # bundled catalog and matrix against the live directory
```

Then run the node in a real n8n instance. Install n8n in a separate directory and point `N8N_E2E_PACKAGE` at its `n8n` package.

```sh
export N8N_E2E_PACKAGE=/path/to/n8n/node_modules/n8n
export N8N_E2E_OUTPUT=/path/outside/the/repository
npm run test:e2e -- --faults                              # no account, no quota
ANYSEARCH_API_KEY=… npm run test:e2e                      # authenticated suite with an AI Agent
ANYSEARCH_API_KEY=… npm run test:e2e -- --capabilities --single-catalog   # the catalog matrix
env -u ANYSEARCH_API_KEY npm run test:e2e -- --capabilities --smoke-only  # needs anonymous quota
```

Read a matrix run by cause:

- **Node side.** An outgoing body that differs from the entered request, a local rejection that reached HTTP, or a wrong status handling. These must be zero.
- **Upstream availability.** HTTP 503 and cut-off responses vary by provider and between runs. Repeat the matrix before treating one as a regression.
- **Upstream content.** `resultMismatch` means AnySearch returned a record that contradicts the request. Keep the check and record the behavior.

`ANYSEARCH_E2E_CASES=<file>` replays a subset of requests through real n8n. The ports 5789 and 5790 allow one run at a time.

## Release

1. Set the version with `npm version <version> --no-git-tag-version`.
2. Describe the release in `CHANGELOG.md` and update `README.md`.
3. Sync the catalog one last time, then run build, test, lint and `test:catalog`.
4. Commit to `main`, push, and push the tag `<version>`. The tag has no `v` prefix. GitHub Actions then publishes to npm with provenance, which n8n requires for community nodes. Never push a tag without intending to publish.

## File map

| Path | Purpose |
| --- | --- |
| `nodes/AnySearch/catalog.json` | Bundled catalog. Generated by `npm run catalog:sync`; do not format it with Prettier. |
| `nodes/AnySearch/capabilityParameters.ts` | Tag, field and required-flag checks. |
| `nodes/AnySearch/*ParameterRules.ts` | Per-field rules and conditions from the descriptions. |
| `nodes/AnySearch/AnySearch.node.ts` | Operations, HTTP requests, response validation and error mapping. |
| `test/e2e/search-cases.json` | One request per catalog field for the real-n8n matrix. |
| `test/e2e/capability-checks.mjs` | Focused live cases and local rejection cases. |
| `test/e2e/result-checks.mjs` | Checks of returned records against the request. |
| `scripts/check-catalog.mjs`, `scripts/sync-catalog.mjs` | Compare with and copy from the live directory. |
| `scripts/e2e.mjs` | Real-n8n runner. |
