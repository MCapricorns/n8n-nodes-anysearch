# AnySearch for n8n

Use AnySearch for general web search, vertical searches, capability discovery, and text extraction from public URLs. The community node also works as a tool in an n8n AI Agent workflow.

## Install

On self-hosted n8n, open **Settings → Community Nodes → Install** and enter `n8n-nodes-anysearch`. For command-line installation, use the community packages directory of your n8n instance.

```sh
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install n8n-nodes-anysearch
```

Restart n8n after installing or updating. In queue mode, install the same version on every worker. On n8n Cloud, check the nodes panel for availability through the verified community nodes program. [n8n installation guide](https://docs.n8n.io/integrations/community-nodes/installation/)

## Credentials

Leave the credential unset or save an empty **AnySearch API** key to use the anonymous, IP-based quota. To use account quota, create a key in the AnySearch console and save it in an **AnySearch API** credential. n8n sends the key as a Bearer header. An unreadable credential fails locally. An invalid, expired, or disabled key is rejected by AnySearch. The credential test checks `GET /v1/domains`. [AnySearch console](https://www.anysearch.com/console/api-keys) · [Authentication](https://www.anysearch.com/docs/auth)

## Operations

| Resource and operation | REST request | n8n output |
| --- | --- | --- |
| **Search → Search** | `POST /v1/search` | One item per result. Turn off **Simplify** for a single item with `request_id`, `results`, and `metadata`, including for empty results. |
| **Search → Batch Search** | 1–5 parallel `POST /v1/search` requests per input item | One result or error per query in input order, with `query_index` and input pairing. |
| **Capability → List All Domains** | `GET /v1/domains` | One item per domain. |
| **Capability → Get Sub-Domains** | `GET /v1/sub-domains?domain=code&domain=finance` | One item per selected domain, with capability tags and their parameter definitions. |
| **Extract → Extract Content** | `POST /v1/extract` | The submitted URL, page title, extracted content, and request ID when returned by AnySearch. |

The node uses `typeVersion: 1`. To edit workflows saved with the temporary version 2, set the AnySearch node's `typeVersion` to `1`. Feedback was removed in 1.1.1. Remove saved Feedback steps when migrating older workflows.

### Search parameters

| n8n field | REST field | Contract |
| --- | --- | --- |
| Query | `query` | Required, non-empty text. |
| Max Results | `max_results` | Optional integer from 1 to 10. The API defaults to 10. |
| Capability Tag | `tag` | Optional full tag such as `code.doc`. Omit it for general search. |
| Tag Parameters | `params` | JSON object containing fields from the selected tag. |
| Zone | `zone` | Optional `cn` or `intl`. Leave unset for automatic routing. |
| Language | `language` | Optional language preference. `en` and `zh-CN` are documented examples. |
| Response Format | `format` | Optional `json` or `markdown`. Markdown affects result content. The outer response is JSON. |

Use **List All Domains** to find domains and **Get Sub-Domains** to inspect names, required flags, and descriptions for each tag. Both search operations use the same bundled catalog and validation rules. The November 27, 2026 directory returned 17 domains, 39 tags, and 174 tag-specific fields. Descriptions identify type-dependent requirements, defaults, ranges, and examples. For example, `finance.quote` requires a symbol for `crypto`, and the flight currency descriptions list USD and CNY as examples.

Some adapter fields use empty placeholders. **Flight Status** supplies `departure: ""` when no airport is given. **Fundamentals** fills the ticker field unused by the selected type with an empty string. **Earnings Calendar** supplies `period: "90d"` when omitted.

[Search reference](https://www.anysearch.com/docs/api-endpoints/v1-search) · [Discovery reference](https://www.anysearch.com/docs/api-endpoints/v1-sub-domains) · [Bundled catalog](nodes/AnySearch/catalog.json)

### Batch Search

Enter a JSON array of 1–5 objects with the REST field names.

```json
[
  { "query": "n8n workflow automation", "max_results": 2 },
  {
    "query": "React useEffect cleanup",
    "tag": "code.doc",
    "params": { "library": "react" },
    "max_results": 2
  }
]
```

Quota is charged per request. Individual errors preserve the batch order. Choose **On Error → Continue (using error output)** to route failed queries to a separate branch. Retrying a workflow may consume quota for queries that succeeded on the first run.

### Extract

Supply an absolute public HTTP(S) URL. The node checks URL syntax, embedded credentials, non-public literal addresses, and the serialized 16 KiB request body limit before sending. The service checks target reachability and redirects. Supported input includes HTML/XHTML, plain text, JSON, and Markdown.

AnySearch returns up to 50,000 Unicode characters. Truncation may leave JSON incomplete or Markdown cut mid-structure. The content can also be a login or verification page. [Extract reference](https://www.anysearch.com/docs/api-endpoints/v1-extract)

## Errors

The node preserves an available request ID, HTTP status, business code, and error code. HTTP 402 retains only status and request ID from the service. Use the request ID to correlate an error with AnySearch. A successful response can contain zero results, source URLs can be empty for structured records, and provider coverage can vary by filter. [Search errors](https://www.anysearch.com/docs/api-endpoints/v1-search#errors)

## Verify a change

Run the build-backed unit tests, lint, and live catalog comparison.

```sh
npm ci
npm test
npm run lint
npm run test:catalog
```

For workflow tests, install n8n in a separate directory and use the path to its `n8n` package. For a registry artifact, download it with `npm pack n8n-nodes-anysearch@VERSION`, unpack it, and point `ANYSEARCH_E2E_PACKAGE` at the unpacked `package` directory. For changes under development, run `npm run build` and omit `ANYSEARCH_E2E_PACKAGE`.

The 1.1.10 workflow review used n8n 2.49.7 and Node.js 24.22.3.

```sh
export N8N_E2E_PACKAGE=/path/to/n8n/node_modules/n8n
export ANYSEARCH_E2E_PACKAGE=/path/to/unpacked/package
export N8N_E2E_OUTPUT=/path/to/private/evidence
export ANYSEARCH_E2E_CASES="$PWD/test/e2e/search-cases.json"
env -u ANYSEARCH_API_KEY npm run test:e2e -- --capabilities
env -u ANYSEARCH_API_KEY npm run test:e2e -- --capabilities --smoke-only
npm run test:e2e -- --faults
```

For authenticated tests, inject `ANYSEARCH_API_KEY` into the runner's process environment and rerun the selected cases. The runner imports an encrypted credential into temporary n8n storage and removes that instance afterward. The smoke workflow exercises Extract and Search with all seven REST fields. Omit `--capabilities` for the standard authenticated suite with the AI Agent.

To replay particular requests, set `ANYSEARCH_E2E_CASES` to a JSON file with their REST bodies and run `npm run test:e2e -- --capabilities --single-catalog --replay-only`. Compare outgoing bodies and node results by request ID. The evidence records quota responses, provider errors, empty results, and missing filter evidence separately.

## Release

`npm pack` builds the package. Push the release commit and its version tag to trigger GitHub Actions Publish with npm provenance. Verify the Actions conclusion, npm `latest`, registry `gitHead`, and the downloaded tarball's integrity. [Publish workflow](.github/workflows/publish.yml)

[MIT license](LICENSE.md)
