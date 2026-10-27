// Live smoke test: runs the compiled AnySearch node against the real API and
// asserts the responses it accepts.
//
// Usage:
//   npm run build
//   ANYSEARCH_API_KEY=as_sk_xxx node scripts/smoke.mjs
//
// The API also works anonymously (rate-limited); set no key to test that path.
// Every check is an assertion: a malformed response fails the run instead of
// being reported as "0 item(s)" and an overall pass.

import { AnySearch } from '../dist/nodes/AnySearch/AnySearch.node.js';

const API_BASE_URL = 'https://api.anysearch.com';
const apiKey = (process.env.ANYSEARCH_API_KEY || '').trim();
const failures = [];
let requests = [];

function assert(condition, message) {
	if (!condition) throw new Error(message);
}

function assertHttpUrl(value, label) {
	assert(
		typeof value === 'string' && /^https?:\/\//i.test(value),
		`${label} must be an http(s) URL, got ${JSON.stringify(value)}`,
	);
}

function assertNestedItems(items) {
	assert(Array.isArray(items), 'execute must return one item array');
	for (const item of items) {
		assert(
			typeof item === 'object' && item !== null && typeof item.json === 'object',
			'every returned item must wrap a JSON object',
		);
	}
}

async function rawRequest(options) {
	requests.push(options);
	const headers = { accept: 'application/json' };
	if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
	if (options.body !== undefined) headers['Content-Type'] = 'application/json';

	const response = await fetch(options.url, {
		method: options.method,
		headers,
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
	const text = await response.text();
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		json = { raw: text };
	}
	if (!response.ok) {
		const error = new Error(`HTTP ${response.status}: ${JSON.stringify(json).slice(0, 500)}`);
		error.httpCode = response.status;
		throw error;
	}
	return json;
}

function makeContext(node, parameters) {
	return {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name, _itemIndex, fallback) =>
			name in parameters ? parameters[name] : fallback,
		getNode: () => node,
		continueOnFail: () => false,
		getCredentials: async (type) => {
			if (type === 'anySearchApi' && apiKey) return { apiKey };
			throw new Error('credential not set');
		},
		helpers: {
			httpRequest: (options) => {
				assert(!apiKey, 'configured key must use the authenticated helper');
				return rawRequest(options);
			},
			httpRequestWithAuthentication: function (_type, options) {
				assert(Boolean(apiKey), 'blank key must use the anonymous helper');
				return rawRequest(options);
			},
		},
	};
}

async function run(label, parameters, verify) {
	requests = [];
	const context = makeContext({
		id: 'smoke',
		name: 'AnySearch',
		...(apiKey ? { credentials: { anySearchApi: { id: 'smoke', name: 'Smoke credential' } } } : {}),
	}, parameters);
	try {
		const output = await AnySearch.prototype.execute.call(context);
		assert(Array.isArray(output), 'execute must return [items]');
		const items = output[0];
		assertNestedItems(items);
		await verify({ items, requests });
		const preview = items[0] ? ` | first: ${JSON.stringify(items[0].json).slice(0, 120)}...` : '';
		console.log(`  ok   ${label}: ${items.length} item(s)${preview}`);
	} catch (error) {
		failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
		console.log(`  FAIL ${label}`);
	}
}

function verifySearchBody({ requests: sent }, expected) {
	assert(sent.length === 1, `expected exactly one request, got ${sent.length}`);
	assert(sent[0].method === 'POST', `expected POST, got ${sent[0].method}`);
	assert(
		String(sent[0].url).startsWith(`${API_BASE_URL}/v1/search`),
		`unexpected search URL ${sent[0].url}`,
	);
	assert(sent[0].body?.query === expected.query, `query not mapped: ${JSON.stringify(sent[0].body)}`);
	assert(
		sent[0].body?.max_results === expected.maxResults,
		`max_results not mapped: ${JSON.stringify(sent[0].body)}`,
	);
	if (expected.tag !== undefined) {
		assert(sent[0].body?.tag === expected.tag, `tag not mapped: ${JSON.stringify(sent[0].body)}`);
	}
}

console.log(`AnySearch node smoke test (${apiKey ? 'authenticated' : 'anonymous'})`);

await run(
	'search (simplified)',
	{ resource: 'search', operation: 'search', query: 'n8n community node tutorial', options: { maxResults: 3 } },
	({ items, requests: sent }) => {
		verifySearchBody({ requests: sent }, { query: 'n8n community node tutorial', maxResults: 3 });
		assert(items.length <= 3, `simplified output must honour maxResults=3, got ${items.length}`);
		for (const item of items) assertHttpUrl(item.json.url, 'result url');
	},
);

await run(
	'search (full envelope)',
	{ resource: 'search', operation: 'search', query: 'typescript generics guide', options: { maxResults: 2, simplify: false } },
	({ items, requests: sent }) => {
		verifySearchBody({ requests: sent }, { query: 'typescript generics guide', maxResults: 2 });
		assert(items.length === 1, `unsimplified output must be a single item, got ${items.length}`);
		assert(Array.isArray(items[0].json.results), 'full envelope must expose a results array');
		assert(
			typeof items[0].json.metadata === 'object' && items[0].json.metadata !== null,
			'full envelope must expose a metadata object',
		);
		assert(
			items[0].json.request_id === undefined || typeof items[0].json.request_id === 'string',
			'request_id must be a string when the API returns one',
		);
	},
);

await run(
	'search (vertical tag)',
	{ resource: 'search', operation: 'search', query: 'http client retry', options: { maxResults: 3, tag: 'code.snippet' } },
	({ items, requests: sent }) => {
		verifySearchBody({ requests: sent }, { query: 'http client retry', maxResults: 3, tag: 'code.snippet' });
		assert(items.length <= 3, `vertical output must honour maxResults=3, got ${items.length}`);
		for (const item of items) assertHttpUrl(item.json.url, 'result url');
	},
);

await run(
	'extract',
	{ resource: 'extract', operation: 'extract', url: 'https://example.com' },
	({ items, requests: sent }) => {
		assert(sent.length === 1 && sent[0].method === 'POST', 'extract must issue one POST request');
		assert(sent[0].body?.url === 'https://example.com', 'extract URL not mapped');
		assert(items.length === 1, `extract must return one item, got ${items.length}`);
		assertHttpUrl(items[0].json.url, 'extracted url');
		assert(typeof items[0].json.title === 'string', 'extracted title must be a string');
		assert(
			typeof items[0].json.content === 'string' && items[0].json.content.trim() !== '',
			'extracted content must not be empty',
		);
	},
);

await run(
	'capability: list domains',
	{ resource: 'capability', operation: 'getDomains' },
	({ items, requests: sent }) => {
		assert(sent.length === 1 && sent[0].method === 'GET', 'domain listing must issue one GET request');
		assert(items.length > 0, 'domain listing must return at least one domain');
		for (const item of items) {
			assert(
				typeof item.json.domain === 'string' && item.json.domain !== '',
				`domain entry needs a name, got ${JSON.stringify(item.json)}`,
			);
		}
	},
);

await run(
	'capability: sub-domains',
	{ resource: 'capability', operation: 'getSubDomains', domains: ['code', 'finance'] },
	({ items, requests: sent }) => {
		assert(sent.length === 1 && sent[0].method === 'GET', 'sub-domain listing must issue one GET request');
		assert(
			String(sent[0].url).includes('domain=code') && String(sent[0].url).includes('domain=finance'),
			`sub-domain request must repeat the domain parameter, got ${sent[0].url}`,
		);
		assert(items.length > 0, 'sub-domain listing must return at least one entry');
	},
);

if (failures.length > 0) {
	console.error(`\n${failures.length} smoke check(s) failed:`);
	for (const failure of failures) console.error(`  - ${failure}`);
	process.exitCode = 1;
} else {
	console.log('All smoke tests passed.');
}
