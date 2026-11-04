# AnySearch integration verification — 2026-11-04

The implementation covers Search, Batch Search, Extract Content, List All Domains,
Get Sub-Domains, and Submit Score. The acceptance run passed 39 live-service workflow checks
and 16 controlled-fault checks in real n8n. Offline contracts passed 144 checks.

The API/SDK mapping and references are in [API coverage](api-coverage.md). Machine-readable
results are in [summary.json](evidence/2026-11-04/summary.json), with sanitized outbound evidence
in [requests.jsonl](evidence/2026-11-04/requests.jsonl).

## Environment and evidence

- n8n 2.44.7, with host n8n-workflow 2.44.2, on Node.js 24.22.1 / Windows.
- Build and offline contracts use n8n-workflow 2.46.5.
- The built node was installed into a new isolated n8n instance. Credentials were imported in
  encrypted form. Workflows ran through n8n's CLI and execution engine, including native HTTP
  helpers, expression resolution, error routing, and AI Agent tool registration.
- The AI Agent used a deterministic local OpenAI-compatible model. It requested the real
  AnySearch tool, received live search results, and consumed them on its next model call.
- Fault workflows used local HTTP responses through the real n8n transport and execution engine.
  They are separate from public-service requests and did not exhaust a real account's quota.
- The configured API key and synthetic upstream credential markers were checked against execution
  data. Published evidence omits authorization values, credential exports, full result bodies,
  and instance databases. The isolated instance was removed after execution.
- Tested compiled-node SHA-256:
  a025e617ac96e6a7f1cf62b1e91488efe81932163f62e4b66c5d0db74b772f28.

## Confirmed fixes and behavior

| Area | Result |
| --- | --- |
| Missing or malformed search results | Explicit failure; missing fields and empty objects no longer masquerade as valid empty results |
| Missing, null, or numeric extraction content | Explicit failure; the node preserves valid text rather than manufacturing an empty string |
| HTTP and business error privacy | Raw HTTP bodies and upstream business messages are discarded; safe status/code and request IDs remain available |
| Error-output routing | Native error/details schema retains diagnostics and routes failures correctly despite added metadata |
| Batch search | Up to five concurrent searches, stable order, per-query failures, retained siblings, and dedicated error-branch support |
| Credentials | Authenticated, anonymous, blank, invalid, and unreadable selected credentials are handled explicitly |
| Request boundaries | 60-second timeout, no API redirect following, search bounds, JSON validation, and embedded URL-credential rejection |
| Input/output pairing | Multiple input searches retain linkage to their originating n8n items |
| Feedback | Explicit 1–10-entry score submission through MCP with JSON/SSE parsing and safe error handling |
| Native UI metadata | Light/dark node and credential icons, optional credential help, Simplify label, supported Codex category, and fully qualified node ID |

Error items expose an error string and a details object. The latter contains available request_id
and http_status; batch failures also retain query and query_index there. This schema works with
both regular continuation and n8n's dedicated error output. Stop-on-failure retains diagnostics
in the serialized node error context.

## Live-service acceptance

All 39 workflow checks passed. They generated 108 public AnySearch requests:

| HTTP status | Requests | Interpretation |
| --- | ---: | --- |
| 200 | 105 | Successful service responses, including feedback acknowledgement |
| 401 | 2 | Expected rejection of invalid credentials for search and domain discovery |
| 422 | 1 | Expected rejection of PDF extraction |

The two anonymous/blank-key searches sent no Authorization header. No empty Bearer header was
observed. The invalid-key request was not retried as anonymous. Maximum observed concurrency
was five requests.

The live directory contained 17 domains, 39 tags, and 189 parameter definitions. The search matrix
made 86 queries covering every tag and additional provider/source, zone, language, and response-format
choices. All 86 returned valid nonempty result arrays; none were counted as a successful empty result
or hidden upstream error. Discovery sent all 17 domains as repeated domain query parameters.

HTML, plain text, JSON, and Markdown extraction passed. Long public documents in each of those four
formats returned exactly 50,000 Unicode characters. These REST observations include truncated JSON
and Markdown; callers must not assume that extracted JSON is complete or parseable. Unsupported PDF
extraction returned a safe error with its service request ID.

The run also verified explicit score submission, an AI Agent tool round trip, partial batch failure,
and downstream expressions linked to two separate search inputs.

## Controlled faults in real n8n

All 16 checks passed: HTTP 400, 402, 403, 429, 500, 502, and 302; an HTTP-200 business failure;
malformed search fields; null extraction content; invalid JSON; the configured request timeout;
unreadable encrypted credentials; a valid empty result set; batch error-branch routing; and
stop-on-failure behavior.

Synthetic credentials embedded in HTTP bodies and natural-language business errors did not appear
in serialized workflow data. The unreadable credential made no outbound request. The rate-limit
response was not automatically replayed. The redirect response failed without following its Location.
Error-branch tests retained status, request ID, and batch identity, and a failed query did not remove
its successful sibling.

## Build, packaging, and n8n guidance

The TypeScript build and 144 offline contracts passed. Strict community-node lint uses the unchanged
official configuration; it is checked in a clean source copy so ignored local review installations
are not treated as package source. The npm dry-run contains 15 files, no bundled dependencies, and
no review/test credentials, instance databases, or test harnesses.

The runtime imports only n8n-workflow and uses n8n's credential and HTTP APIs. It does not read
local files or environment variables, invoke external commands, or add another runtime SDK.
README documentation covers anonymous limits, source discovery, required and conditional parameters,
error routing, extraction boundaries, feedback semantics, execution-data privacy, and Cloud installation.

The publish workflow uses GitHub Actions with npm provenance. Registry metadata confirms an SLSA
provenance attestation for the already-published 1.0.0 package. A new source commit does not update
that npm package. Cloud verification requires a separate n8n Creator Portal approval.

## Dependency findings

The installed dependency graph still has security findings:

| Audit scope | Low | Moderate | High | Critical |
| --- | ---: | ---: | ---: | ---: |
| Full development/peer graph | 1 | 23 | 23 | 0 |
| Production and peer graph | 0 | 0 | 3 | 0 |

These are affected-package entries, including transitive propagation, rather than counts of distinct
root vulnerabilities. The production/peer entries trace to Zod 3.25.76 through n8n-workflow and
@n8n/expression-runtime:
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), oversized constrained
collections can exhaust memory. The node adds no bundled runtime dependency, but the host's
vulnerable dependency graph remains relevant to deployment.

Development tooling is updated to @n8n/node-cli 0.55.5 and release-it 21.1.2. Remaining development
findings involve their dependency chains, including glob/minimatch, qs, stream-json, UUID,
prototype poisoning in deepmerge, and the FTP listing parser. Advisory references and affected
ranges are recorded in the evidence summary. Resolution requires compatible upstream releases;
a forced Zod major-version replacement can break consumers expecting Zod 3.

## Limits of the acceptance result

The tests establish the implemented request/response and n8n execution contracts for this catalog
snapshot. They do not prove every parameter-value combination, provider filter effect, factual
result accuracy, or source availability. All 189 parameter definitions have offline forwarding
coverage; the live matrix covers selected combinations. Refresh discovery as the service changes.

Feedback acknowledges queuing, not database persistence. The AI Agent test verifies integration
with a local deterministic model; external LLM behavior was not tested. Real execution was tested
on the stated n8n version and Windows runtime, without certifying every older version, queue-mode
deployment, browser layout, or n8n Cloud environment. The dependency audit remains nonzero.
