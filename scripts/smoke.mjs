// Live smoke test: runs the compiled AnySearch node against the real API.
//
// Usage:
//   npm run build
//   ANYSEARCH_API_KEY=as_sk_xxx node scripts/smoke.mjs
//
// The API also works anonymously (rate-limited); set no key to test that path.

import { AnySearch } from '../dist/nodes/AnySearch/AnySearch.node.js';

const API_BASE_URL = 'https://api.anysearch.com';
const apiKey = process.env.ANYSEARCH_API_KEY || '';

async function rawRequest(options) {
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
			httpRequest: (options) => rawRequest(options),
			httpRequestWithAuthentication: function (_type, options) {
				return rawRequest(options);
			},
		},
	};
}

async function run(label, parameters) {
	const context = makeContext({ id: 'smoke', name: 'AnySearch' }, parameters);
	const output = await AnySearch.prototype.execute.call(context);
	const items = output[0];
	console.log(
		`  ${label}: ${items.length} item(s)` +
			(items[0] ? ` | first: ${JSON.stringify(items[0].json).slice(0, 120)}...` : ''),
	);
	return items;
}

console.log(`AnySearch node smoke test (${apiKey ? 'authenticated' : 'anonymous'})`);

await run('search (simplified)', {
	resource: 'search',
	operation: 'search',
	query: 'n8n community node tutorial',
	options: { maxResults: 3 },
});

await run('search (full envelope)', {
	resource: 'search',
	operation: 'search',
	query: 'typescript generics guide',
	options: { maxResults: 2, simplify: false },
});

await run('search (vertical tag)', {
	resource: 'search',
	operation: 'search',
	query: 'http client retry',
	options: { maxResults: 3, tag: 'code.snippet' },
});

await run('extract', {
	resource: 'extract',
	operation: 'extract',
	url: 'https://example.com',
});

await run('capability: list domains', {
	resource: 'capability',
	operation: 'getDomains',
});

await run('capability: sub-domains', {
	resource: 'capability',
	operation: 'getSubDomains',
	domains: ['code', 'finance'],
});

console.log('All smoke tests passed.');
