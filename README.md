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

| Resource and operation            | REST request                                           | n8n output                                                                                                                              |
| --------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Search → Search**               | `POST /v1/search`                                      | One item per result. Turn off **Simplify** for a single item with `request_id`, `results`, and `metadata`, including for empty results. |
| **Search → Batch Search**         | 1–5 parallel `POST /v1/search` requests per input item | One result or error per query in input order, with `query_index` and input pairing.                                                     |
| **Capability → List All Domains** | `GET /v1/domains`                                      | One item per domain.                                                                                                                    |
| **Capability → Get Sub-Domains**  | `GET /v1/sub-domains?domain=code&domain=finance`       | One item per selected domain, with capability tags and their parameter definitions.                                                     |
| **Extract → Extract Content**     | `POST /v1/extract`                                     | The submitted URL, page title, extracted content, and request ID when returned by AnySearch.                                            |

Feedback was removed in 1.1.1. Remove saved Feedback steps when migrating older workflows.

### Search parameters

| n8n field       | REST field    | Contract                                                                                           |
| --------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| Query           | `query`       | Required, non-empty text.                                                                          |
| Max Results     | `max_results` | Optional integer from 1 to 10. The API defaults to 10.                                             |
| Capability Tag  | `tag`         | Optional full tag such as `code.doc`. Omit it for general search.                                  |
| Tag Parameters  | `params`      | Optional JSON object. Use only the fields that the selected tag defines in the capability catalog. |
| Zone            | `zone`        | Optional `cn` or `intl`. Leave unset for automatic routing.                                        |
| Language        | `language`    | Optional language preference. `en` and `zh-CN` are documented examples.                            |
| Response Format | `format`      | Optional `json` or `markdown`. Markdown affects result content. The outer response is JSON.        |

### Capability catalog

A vertical search needs a capability tag and the parameters defined for it. The node bundles a copy of the AnySearch capability catalog, read from `GET /v1/sub-domains` and reviewed on 2026-11-27: 17 domains, 40 capability tags, and 206 tag-specific fields, 25 of them required.

| Domain         | Capability tags                                               |
| -------------- | ------------------------------------------------------------- |
| `academic`     | `citation`, `dataset`, `paper`, `person`                      |
| `agriculture`  | `stats`                                                       |
| `business`     | `company`, `jobs`, `people`, `trade`                          |
| `code`         | `doc`, `snippet`                                              |
| `energy`       | `electricity`, `production`                                   |
| `environment`  | `aqi`                                                         |
| `film`         | `torrent`                                                     |
| `finance`      | `calendar`, `fundamental`, `macro`, `news`, `quote`, `screen` |
| `gaming`       | `esports`, `store`                                            |
| `general`      | `general`                                                     |
| `health`       | `drug`, `stats`, `trial`                                      |
| `ip`           | `global`                                                      |
| `legal`        | `enforcement`, `judicial`, `legislation`                      |
| `resource`     | `image`, `video`                                              |
| `security`     | `asset`, `malware`, `threat_intel`, `vuln`                    |
| `social_media` | `social_media`                                                |
| `travel`       | `flight`, `flight_status`                                     |

A tag is written as `domain.tag`, for example `finance.quote` or `security.threat_intel`. Tags that are not listed below have no required parameters.

| Capability tag          | Required parameters            |
| ----------------------- | ------------------------------ |
| `agriculture.stats`     | `item`                         |
| `code.doc`              | `library`                      |
| `finance.calendar`      | `type`                         |
| `finance.fundamental`   | `market`, `symbol`, `type`     |
| `finance.macro`         | `market`, `type`               |
| `finance.news`          | `type`                         |
| `finance.quote`         | `market`, `type`               |
| `finance.screen`        | `market`, `type`               |
| `gaming.esports`        | `type`                         |
| `health.drug`           | `type`                         |
| `security.asset`        | `target`                       |
| `security.malware`      | `ioc`                          |
| `security.threat_intel` | `target`                       |
| `security.vuln`         | `type`, `value`                |
| `travel.flight`         | `arrival`, `date`, `departure` |
| `travel.flight_status`  | `departure`, `flight_number`   |

Use **List All Domains** to find domains and **Get Sub-Domains** to read the parameter definitions of a tag: names, required flags, and descriptions. AnySearch updates the catalog frequently and recommends reading the current definitions with `GET /v1/sub-domains`, the same public endpoint that **Get Sub-Domains** calls. Treat the returned definitions as the source of truth.

**Search** and **Batch Search** check every request against the bundled catalog before sending it:

- The tag must exist in the catalog, and each entry of **Tag Parameters** must be a field of that tag. Other fields are rejected.
- Fields flagged as required in the catalog must be present.
- Values follow the field descriptions: listed values, stated formats such as dates, ranges, and identifier standards, and conditions such as “Required when …”. For example, `finance.quote` needs `symbol` for security-level operations, `finance.news` type `transcript` needs `symbol` and `report_period`, `academic.citation` needs `id` unless it is a metadata keyword search, and a `travel.flight` `return_date` cannot be earlier than `date`.

A rejected request stops in n8n with the name of the field or the stated condition and sends nothing to AnySearch. Accepted parameters are sent exactly as entered: the node adds no defaults and fills in no empty values.

**Changes from 1.1.2.** The catalog moved on 2026-11-27, and saved workflows may need an edit:

- `market` is now required by `finance.quote`, `finance.fundamental`, `finance.macro`, and `finance.screen`. A request without it stops with the missing field name.
- Removed fields: `cn_code` in `finance.calendar`, `finance.fundamental`, `finance.quote`, and `finance.news`; `country` in `finance.screen`; `id_type`, `doi`, `open_access`, `min_citations`, `venue`, `category`, `year_from`, and `year_to` in `academic.citation`; `origin`, `destination`, and `type` in `travel.flight`; `type` in `travel.flight_status` and `environment.aqi`. `academic.dataset` and `academic.citation` use `year` for a year or a range.
- Removed tags: `agriculture.fao` is replaced by `agriculture.stats`. `security.intel`, `security.noise`, and `security.scan` are replaced by `security.asset`, `security.malware`, and `security.threat_intel`.
- `finance.news` accepts the types `general`, `stock`, `transcript`, and `long_form`. `flash` and `announcement` are no longer catalog types.
- The node no longer supplies values that a workflow did not contain: an empty `departure` for flight status, an empty unused ticker for fundamentals, and `period: "90d"` for earnings calendars. Add them to **Tag Parameters** when a request needs them.
- `gaming.esports` requires only `type`. It gains `count` for mastery, and `gaming.store` gains `language` and `region`.
- `academic.paper` accepts a DOI lookup as a bare DOI, a `doi:` prefix, or an `http(s)://doi.org/` URL.
- The node keeps `typeVersion: 1`. To edit workflows saved with the temporary version 2, set the AnySearch node's `typeVersion` to `1`.
- Batch Search needs a list of 1–5 query objects, and each request is validated before it is sent. Unsupported `zone` and `format` values are rejected.
- Extract rejects URLs with embedded credentials or non-public IP addresses. Get Sub-Domains rejects a comma-separated value inside its array.

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

Run the build-backed unit tests, lint, and the comparison of the bundled catalog with the live directory.

```sh
npm ci
npm test
npm run lint
npm run test:catalog
```

AnySearch changes its catalog often. When the comparison reports a difference, `npm run catalog:sync` copies the live directory and [AGENTS.md](AGENTS.md) lists the steps that align the validation, requests, rejection cases, result checks and documentation with it.

For workflow tests, install n8n in a separate directory and use the path to its `n8n` package. For a registry artifact, download it with `npm pack n8n-nodes-anysearch@VERSION`, unpack it, and point `ANYSEARCH_E2E_PACKAGE` at the unpacked `package` directory. For changes under development, run `npm run build` and omit `ANYSEARCH_E2E_PACKAGE`.

The 1.2.0 workflow review used n8n 2.49.8 and Node.js 26.13.1.

```sh
export N8N_E2E_PACKAGE=/path/to/n8n/node_modules/n8n
export ANYSEARCH_E2E_PACKAGE=/path/to/unpacked/package
export N8N_E2E_OUTPUT=/path/to/private/evidence
npm run build
npm run test:e2e -- --faults
env -u ANYSEARCH_API_KEY npm run test:e2e -- --capabilities --smoke-only
npm run test:e2e -- --capabilities --single-catalog
```

`--faults` runs transport and error-handling scenarios against a local stand-in and needs no account. `--capabilities` sends every catalog fixture through a real n8n Search node and checks the outgoing request, HTTP status, returned results, and catalog coverage. With `--single-catalog` each fixture has its own node. The matrix has 200 fixtures that cover every catalog field and tag, and the capability checks add 68 requests that the node rejects before any HTTP request. They make about 210 requests, so export `ANYSEARCH_API_KEY` rather than relying on the anonymous quota. `--smoke-only` needs anonymous quota for the running machine. The runner imports an encrypted credential into temporary n8n storage and removes that instance afterward.

Omit `--capabilities` for the standard authenticated suite with the AI Agent. To replay particular requests, set `ANYSEARCH_E2E_CASES` to a JSON file with their REST bodies and run `npm run test:e2e -- --capabilities --single-catalog --replay-only`. Compare outgoing bodies and node results by request ID. The evidence records quota responses, provider errors, empty results, and missing filter evidence separately.

Upstream availability varies between runs. A fixture that returns HTTP 503 in one run can succeed in the next, so repeat the matrix before treating a failure as a regression. A result that does not match the requested filters is reported as a mismatch, and a result without enough evidence as unverified.

The 1.2.0 review ran the fault suite, the authenticated suite, and four matrix rounds. All outgoing requests equaled the entered parameters, and every invalid request was rejected locally. AnySearch returned content that did not match the request for some filters:

- `social_media.social_media` types `linkedin_people`, `linkedin_jobs`, `linkedin_company`, and `linkedin_posts` returned general web pages.
- `legal.legislation` returned congress.gov bills for the `CFR`, `FR`, and `USCODE` collections and for Canadian rules.
- `ip.global` returned patents of other assignees for an `applicant` filter.
- `agriculture.stats` returned HTTP 400 for some `partner` values with an `element`, for example `China`. `China, mainland` returned a record.
- `gaming.esports` returned HTTP 400 when `player` had no `game_name` or `match_detail` had no `match_id`, although the catalog does not require them.
- `finance.news` type `long_form` returned the provider text without a URL.

## Release

`npm pack` builds the package. Push the release commit and its version tag to trigger GitHub Actions Publish with npm provenance. Verify the Actions conclusion, npm `latest`, registry `gitHead`, and the downloaded tarball's integrity. [Publish workflow](.github/workflows/publish.yml)

[MIT license](LICENSE.md)
