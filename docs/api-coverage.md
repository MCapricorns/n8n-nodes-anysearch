# AnySearch API and SDK coverage

The node exposes the public search, discovery, extraction, batch, and feedback capabilities
identified in the REST documentation, the live MCP tool schema, and the Python SDK reference.
It uses n8n's HTTP helpers and credential manager without bundling another client library.

## References

Reviewed on 2026-11-04:

- [REST API documentation](https://www.anysearch.com/docs/api-endpoints)
- [Search](https://www.anysearch.com/docs/api-endpoints/v1-search)
- [Subdomain discovery](https://www.anysearch.com/docs/api-endpoints/v1-sub-domains)
- [Extraction](https://www.anysearch.com/docs/api-endpoints/v1-extract)
- [AnySearch skill API specification](https://github.com/anysearch-ai/anysearch-skill/blob/main/scripts/shared/doc_spec.md)
- [AnySearch MCP server](https://github.com/anysearch-ai/anysearch-mcp-server)
- [Python SDK reference](https://github.com/WH-2099/anysearch-py/tree/fe8916807e486826bc4f6a5fa66ba84141220de3)
- Live JSON-RPC tools/list from https://api.anysearch.com/mcp

The Python SDK reference is maintained under WH-2099. Its contracts are supplementary evidence;
the live service and official documentation define the integration. The live MCP schema includes
score, which is absent from some earlier API descriptions.

## Function mapping

| API or SDK capability | n8n implementation | Contract |
| --- | --- | --- |
| REST Client.search / AsyncClient.search | Search > Search | POST /v1/search; all documented request fields |
| MCP search | Search > Search | Equivalent search through REST; discovered sub_domain becomes tag, sub_domain_params becomes params |
| MCP batch_search / AsyncMCPClient.batch_search | Search > Batch Search | 1–5 concurrent REST searches; per-query success/error and stable order |
| REST/MCP extract | Extract > Extract Content | POST /v1/extract; URL, title, content, request_id |
| REST/MCP get_sub_domains | Capability > Get Sub-Domains | Repeated domain query parameters; structured domain, tag, and parameter definitions |
| GET /v1/domains | Capability > List All Domains and domain picker | Dynamic domains; no embedded stale enum |
| MCP score / AsyncMCPClient.score | Feedback > Submit Score | tools/call to score; 1–10 request IDs and integer scores 1–5 |
| SDK call_tool metadata access | Native operation outputs | REST request_id and metadata are available directly; batch IDs remain on individual query items |
| Sync and async SDK clients | Awaited n8n execution | Both client styles expose the same service operations; batch requests run concurrently |

SDK context managers, generic transport calls, retries, and serialization helpers are client
mechanisms rather than separate service operations. This node supplies the equivalent workflow
behavior through n8n. Account registration, billing, and API-key management use the service
console and n8n credentials; account creation is not an operation that emits secrets into a workflow.

## Request fields and dynamic capabilities

Search forwards query, max_results, tag, params, zone, language, and format. The single-search UI
uses Max Results and Tag Parameters; batch JSON uses the REST field names. JSON format uses the
service's default. Markdown changes the result content representation while retaining a JSON envelope.

The recorded catalog contains 17 domains, 39 tags, and 189 parameter definitions. The
[catalog fixture](../test/fixtures/capabilities.json) records every name and required flag, and
[the live case matrix](../test/e2e/search-cases.json) contains 86 search inputs covering every tag
plus source/provider selectors, regional/language options, and Markdown.

All tag parameters pass through as JSON. Required empty-string values are preserved. Offline
contracts check all 189 definitions, required fields supplied as empty strings, and omitted
optional fields. Live cases exercise actual combinations; they do not establish every possible
value, combination, filter effect, or provider's data completeness.

Source selectors belong inside params. The node does not silently replace an unsupported source
with a hard-coded alternative. Refresh Get Sub-Domains for current parameter and conditional
requirements. Upstream services can still apply their own routing or fallback policies.

## Output and execution behavior

Search returns one item per result by default. Disable Simplify for one item containing request_id,
results, and metadata, including valid empty results. Batch Search returns one item per query,
retains its original index, and preserves siblings when a query fails. Outputs retain n8n input
pairing. Both regular and dedicated error outputs include safe diagnostics.

Missing result arrays, malformed result fields, missing/non-string extraction content, and invalid
response envelopes fail explicitly. HTTP errors discard their raw bodies; business errors retain
the code without echoing the message. This prevents generated credentials in quota responses from
entering outputs or serialized error objects. Error items use n8n's error/details schema. Safe
request_id and http_status values, and batch query/index fields, live inside details so error
routing and n8n output normalization preserve them.

Nonempty keys use n8n's authenticated helper. Unselected or blank keys use the anonymous helper
without Authorization. Unreadable selected credentials fail before making an HTTP request.
Requests use a 60-second timeout and do not follow API redirects. Batch requests are limited to
five per input item; incoming n8n items are processed in sequence.

## Extraction and feedback limits

The node supports the service's public HTTP(S) text extraction formats: HTML/XHTML, text, JSON,
and Markdown. PDF and other binary formats are unsupported. Embedded URL credentials are rejected.
The node preserves the service's text and does not invent a completeness flag or repair truncated
JSON. The documented text boundary is 50,000 Unicode characters. The MCP description and REST
behavior differ for some oversized formats; consult the recorded REST acceptance results.

Feedback submission is explicit. The node accepts JSON and SSE MCP replies. Queue acknowledgement
does not verify persistence, and feedback is never automatically inferred from an arbitrary search.

## Verification and release scope

[The verification report](verification-2026-11-04.md) records real n8n results, offline checks,
package checks, dependency findings, and remaining limitations. The real-workflow runner is
[scripts/e2e.mjs](../scripts/e2e.mjs).

The native AI Agent test uses a deterministic local chat model to request the real AnySearch tool
and consume its live results. It verifies tool registration, argument resolution, and output flow;
it does not certify the decisions of an external LLM. Controlled fault tests use real n8n HTTP
helpers and local HTTP responses; they are identified separately from live service requests.

Strict community-node lint, icons, Codex metadata, optional credentials, item pairing, and package
contents are checked against the [n8n verification guidance](https://docs.n8n.io/integrations/creating-nodes/build/reference/verification-guidelines/)
and [UX guidance](https://docs.n8n.io/integrations/creating-nodes/build/reference/ux-guidelines/).
Cloud verification remains an n8n approval decision. The repository's publish workflow uses
GitHub Actions and npm provenance; pushing source changes does not publish a package.
