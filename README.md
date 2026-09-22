# n8n-nodes-anysearch

[n8n](https://n8n.io) community nodes for [AnySearch](https://www.anysearch.com) — real-time
search infrastructure built for AI agents. This package lets n8n workflows run unified web
searches, vertical (capability-tag) searches, and clean URL content extraction through a single
API.

## Nodes

### AnySearch

One node with three resources:

| Resource | Operation | API endpoint | Description |
| --- | --- | --- | --- |
| Search | Search | `POST /v1/search` | Unified or vertical search. Returns one item per result (title, url, snippet, content) or the full response envelope. |
| Extract | Extract Content | `POST /v1/extract` | Extracts cleaned content (plain text/Markdown) from a public HTTP(S) URL. |
| Capability | List All Domains | `GET /v1/domains` | Lists every capability domain (code, finance, academic, ...) with its sub-domain count. |
| Capability | Get Sub-Domains | `GET /v1/sub-domains` | Lists capability tags (e.g. `code.snippet`, `finance.quote`) and their parameters for the selected domains. |

Search options: `maxResults` (1–10), `tag` (vertical capability tag like `code.snippet`),
`zone` (`cn` / `intl`), `language` (e.g. `zh-CN`), `format` (`json` / `markdown`),
`params` (extra JSON parameters for the tag, e.g. `{"lang": "go"}`), and `simplify`.

The node also works as an AI tool (`usableAsTool`), so you can plug it straight into AI Agent
workflows.

## Compatibility

- Requires n8n version 1.x or later.
- No runtime dependencies.

## Credentials

The `AnySearch API` credential holds a single API key. It is **optional** — without it, requests
use anonymous access (rate-limited per IP against a daily free quota). With a key, requests draw
from that key's quota and get higher concurrency limits.

To register a key with a test email:

```bash
curl -s -X POST "https://api.anysearch.com/v1/auth/email/register" \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com"}'
```

The response contains an `api_key` value starting with `as_sk_`. Paste it into the credential's
**API Key** field. The credential's connection test calls `GET /v1/domains`, which does not
consume search quota.

## Installation

### In n8n (self-hosted or cloud)

Install via the **Settings > Community Nodes** panel: search for `n8n-nodes-anysearch` and click
install. On self-hosted instances without the panel, set:

```
N8N_COMMUNITY_PACKAGES_ENABLED=true
```

### Manual (self-hosted)

```bash
cd ~/.n8n/custom
npm install n8n-nodes-anysearch
```

Restart n8n and the **AnySearch** node appears in the node panel.

## Usage examples

- **Web search**: Resource `Search`, query `n8n workflow automation`, Max Results `5` → one item
  per result, ready for an AI Agent or a Slack message.
- **Vertical search**: add Capability Tag `code.snippet` and Tag Parameters `{"lang": "python"}` to
  search real code implementations only.
- **Read a page**: Resource `Extract`, URL of an article → cleaned `content` plus `title`.
- **Discover tags**: Resource `Capability` → List All Domains, then Get Sub-Domains for the
  domains you care about.

## Development

```bash
npm install          # install dev dependencies
npm run build        # compile to dist/
npm run lint         # lint with the n8n node config
npm run dev          # run a local n8n instance with the node loaded
ANYSEARCH_API_KEY=as_sk_xxx node scripts/smoke.mjs   # live smoke test against the real API
```

## Release

This package follows the official n8n community node release flow:

1. `npm run release` — bumps the version, updates the changelog, tags, and pushes.
2. The [publish workflow](.github/workflows/publish.yml) publishes to npm with a provenance
   attestation (required by n8n for verification since May 2026).
3. Submit the published version for verification in the
   [n8n Creator Portal](https://creators.n8n.io/nodes).

## License

[MIT](LICENSE.md)
