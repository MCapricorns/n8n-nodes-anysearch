# n8n-nodes-anysearch

[n8n](https://n8n.io) community nodes for [AnySearch](https://www.anysearch.com): general and
vertical search, parallel batch search, capability discovery, and public URL extraction.
The node can also connect to an AI Agent as a tool.

## Operations

| Resource | Operation | API | Output |
| --- | --- | --- | --- |
| Search | Search | POST /v1/search | One item per result, or one item with request_id, results, and metadata |
| Search | Batch Search | 1–5 parallel POST /v1/search requests | One item per query, in input order, including individual errors |
| Extract | Extract Content | POST /v1/extract | URL, title, content, and request_id |
| Capability | List All Domains | GET /v1/domains | One item per domain |
| Capability | Get Sub-Domains | GET /v1/sub-domains | Tags and parameter definitions for the selected domains |

The public REST reference lists Search, Get Sub-Domains and Extract. Search supports all seven
request fields. Get Sub-Domains repeats `domain` for each selection, and Extract takes `url`.
The node also uses the live `GET /v1/domains` endpoint to populate the domain picker and test
credentials. [AnySearch REST reference](https://www.anysearch.com/docs/api-endpoints)

The package has no bundled runtime dependencies. n8n supplies the n8n-workflow peer dependency.
The integration is tested with n8n 2.44.7 on Node.js 24.22.1; compatibility with every older n8n
release has not been certified.

## Installation

### Self-hosted n8n

Open **Settings > Community Nodes**, select **Install**, and enter n8n-nodes-anysearch.
Community packages must be enabled on the instance.

For manual installation, install in the community packages directory:

~~~bash
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install n8n-nodes-anysearch
~~~

Restart n8n after installation or an update. Queue-mode deployments must install the package
on every worker that executes the node. Follow the
[n8n manual installation guide](https://docs.n8n.io/integrations/community-nodes/installation/manual-install/).

### n8n Cloud

Cloud installation requires n8n to verify and enable the package. If AnySearch is available
as a verified community node, install it from the nodes panel. Publishing to npm alone does
not make a package available on Cloud.

## Credentials

Create an API key in the [AnySearch console](https://www.anysearch.com/console/api-keys), then
save it in an **AnySearch API** credential. The key is stored by n8n's credential manager and
sent only as a Bearer header to the fixed AnySearch endpoint.

Credentials are optional. No selected credential, or a saved blank key, uses anonymous access
without an Authorization header. A selected credential that cannot be read or decrypted fails;
it never silently switches to anonymous access. Invalid or expired keys also fail explicitly.

Anonymous access has lower limits and shares an IP-based quota. The credential connection test
uses GET /v1/domains and does not consume search quota. Account registration, key rotation, and
billing remain in the AnySearch console; this node does not create or save credentials returned
by the service.

## Search

Set Resource to **Search**, Operation to **Search**, and enter a query. Options include:

| Option | Behavior |
| --- | --- |
| Max Results | Integer from 1 to 10; the API default is 10 |
| Capability Tag | Current domain.sub_domain tag; omit for general search |
| Tag Parameters | JSON object containing the selected tag's parameters |
| Zone | Auto, China (cn), or International (intl) |
| Language | Preferred result language, such as en or zh-CN |
| Response Format | JSON or Markdown content; the outer response remains JSON |
| Simplify | Enabled: one item per result. Disabled: one item with results and metadata |

Result fields are preserved, including optional or null snippet/content fields. Search repairs
the duplicated `https://www.reddit.com` prefix on malformed Reddit links. A source can return
an empty URL for structured data. A valid empty
result set returns no items with Simplify enabled. Disable Simplify to retain the request ID
and an empty results array. Successful items include the service's request_id when available.

### Vertical search and source selection

1. Use **Capability > List All Domains** to discover domains.
2. Use **Capability > Get Sub-Domains** to read the current tags and parameter definitions.
3. Copy the selected tag and supply its parameters in **Search**.

For example, `code.doc` uses `{"library":"react"}`. Search and Batch Search apply the same
catalog rules to parameters entered as JSON or supplied by n8n expressions.

| Capability | Parameters |
| --- | --- |
| `travel.flight_status` | Supply `flight_number`. The node sends `departure: ""` when the airport is omitted. |
| `finance.fundamental` | For `overview`, supply a ticker such as `{"type":"overview","symbol":"AAPL"}`. The node fills omitted `cn_code` with `""`. An omitted `symbol` is also sent as `""` so the API can read the ticker from the query. For `income`, `balance`, `cashflow`, `indicator`, and `holder`, supply `cn_code`. The node fills omitted `symbol` with `""`. |
| `finance.calendar` and `finance.quote` | Earnings queries default to `period: "90d"`. Crypto quotes require `symbol`. |
| `gaming.esports` | Player, ranked, mastery, and live-game queries require `region` and `game_name`, including names with a Riot tag. A leaderboard requires `region` and a match-detail lookup requires `match_id`. Division filters apply to leaderboard tiers from Diamond through Iron. |
| `academic.citation` | For `op=citation`, supply an Open Citation Identifier in `id`, such as `06101801781-06180334099`. |

Explicit values take precedence over defaults. Read conditional requirements in the current
directory descriptions as well as the required flags. New tags and extra parameters pass
through to AnySearch.

Source selectors use the same JSON field: for example, finance.news accepts type=flash with
news_src=sina, and social_media.social_media accepts type=reddit_post. The available tags,
source selectors, and filtering behavior can change; refresh discovery instead of relying on
an old example. Some documented fields apply only to particular upstream providers.

## Batch search

Choose **Search > Batch Search** and supply a JSON array of 1–5 REST search objects:

~~~json
[
  {"query":"n8n workflow automation","max_results":2},
  {"query":"React useEffect cleanup","tag":"code.doc","params":{"library":"react"},"max_results":2}
]
~~~

Each object accepts query, max_results, tag, params, zone, language, and format. Searches run
concurrently, with at most five requests in flight per input item. Results remain in input
order. Successful queries include query, query_index, results, and metadata. Failed queries
include error and a details object containing query, query_index, and available request_id
and http_status. One failed query does not discard siblings.

Batch Search uses independent REST requests. Quota is charged per search. A batch containing
individual failures completes with error items. Select **On Error > Continue (using error output)**
to send failed queries to the error branch, or filter the error field on the regular output. Multiple incoming n8n items are processed
in sequence, and output items retain their input pairing.

## Extract content

Choose **Extract > Extract Content** and provide a public absolute HTTP(S) URL. URLs containing
an embedded username or password are rejected.

The service supports HTML/XHTML, plain text, JSON, and Markdown. It does not support PDF,
Office documents, images, audio, video, or arbitrary browser actions. Extraction cannot provide
your login session or guarantee access to paid content. A successful extraction can still be a
login or verification page; review the content before relying on it.

The documented output limit is 50,000 Unicode characters. HTML/plain text may include a
truncation marker; JSON and Markdown can be cut without a marker or structural repair. The
node preserves the returned text, so extracted JSON is not guaranteed to parse. There is no
separate service-provided completeness flag. See the
[current Extract contract](https://www.anysearch.com/docs/api-endpoints/v1-extract).

## Migrating from 1.1.0

Version 1.1.1 removed **Feedback > Submit Score** and its MCP client. Remove any saved
Feedback steps before running older workflows. Search, Batch Search, Extract and Capability
use the AnySearch REST API.

## Errors and privacy

- HTTP failures, timeouts, non-zero business codes, invalid JSON, and malformed responses
  produce explicit failures. Missing result/content fields are not converted into empty success.
- HTTP errors include the status and available request ID. For a recognized HTTP 400 missing-parameter
  response, the node also names the missing fields from the public catalog. Other HTTP failures use
  fixed descriptions. Raw error bodies are discarded because anonymous HTTP 402 responses can contain generated account credentials.
  Business errors retain their code and request ID without echoing upstream messages.
- **Continue On Fail** emits an error string and a details object with available request_id
  and http_status. This follows n8n's error-output format and preserves the diagnostics in
  both regular and dedicated error branches. Batch Search always
  keeps per-query errors separate and supports n8n's dedicated error output. **Retry On Fail** can replay a whole node execution and
  consume quota again, so avoid automatic retries of partially completed batches.
- Requests have a 60-second timeout and do not follow redirects from the API endpoint. Page
  redirects during extraction are handled by AnySearch under its own fetch restrictions.
- Queries, capability parameters, and extraction URLs are sent to AnySearch. Avoid confidential
  queries, signed/private URLs, and credentials in parameters. The node does not read environment
  variables or the file system at runtime and does not log requests or response bodies.
- Search and extracted content are untrusted external data. Do not treat page text as Agent
  instructions or execute commands found in it. n8n execution retention and downstream nodes
  determine how long returned data is stored and where it is forwarded.

## Development and validation

~~~bash
npm ci
npm test
npm run lint
npm run dev
~~~

Use Node.js 24.22 or a newer supported LTS release for development.

npm test builds the package and runs offline contracts, privacy/error checks, concurrent batch
checks, and capability parameter-forwarding checks. These do not replace live service or n8n tests.

To run real n8n tests, install n8n separately, build the node, and point the runner at that
installation. N8N_E2E_PACKAGE is the directory containing n8n's package.json; N8N_E2E_NODE
optionally selects a compatible Node.js executable.

~~~bash
export ANYSEARCH_API_KEY='your-key'
export N8N_E2E_PACKAGE='/path/to/n8n/node_modules/n8n'
export N8N_E2E_OUTPUT='/path/to/private/evidence'
npm run build
npm run test:e2e
~~~

To run the capability acceptance cases alone, use `npm run test:e2e -- --capabilities`.
This mode supports anonymous access. It checks live flight, financial, esports and Reddit
results, field-specific failures, and the HTTP requests sent by n8n. Set `ANYSEARCH_E2E_PACKAGE`
to an unpacked npm package directory to test that artifact.

For the broader catalog/source matrix, also set ANYSEARCH_E2E_CASES to the absolute path of
test/e2e/search-cases.json. The runner compares each input with the actual HTTP request by
request ID and checks coverage of every tag and parameter in the live catalog. Result arrays
can be empty for narrow filters. Coverage measures parameter forwarding and API acceptance.
Provider-specific filtering requires checking the returned sources. Live tests consume quota.

The runner imports encrypted test credentials into a new isolated n8n instance, executes real
workflows, checks outgoing header presence and response diagnostics, and removes the instance
afterward. It verifies that all service requests use REST and that saved Feedback steps fail
without sending requests in every n8n error mode. Its AI Agent test uses a deterministic local
chat model with the real AnySearch tool; no external LLM credential is needed. Evidence contains
test parameters, request IDs, counts, hashes, and result hosts, not the API key or full search bodies.

## Release

npm pack rebuilds the package before creating the archive. npm run release performs the official
n8n node release flow. The
[publish workflow](.github/workflows/publish.yml) runs regression tests before publishing with
npm provenance. Submit a published version through the [n8n Creator Portal](https://creators.n8n.io/nodes)
for verification. GitHub pushes alone do not publish a new npm version or update installed nodes.

## License

[MIT](LICENSE.md)
