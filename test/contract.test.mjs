// Offline contract tests for the compiled AnySearch node.
//
// They run against dist/, with the execution context and the HTTP helpers
// substituted, so no API key or n8n instance is needed. Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localRequire = createRequire(path.join(root, 'package.json'));
const { AnySearch } = localRequire('./dist/nodes/AnySearch/AnySearch.node.js');
const { AnySearchApi } = localRequire('./dist/credentials/AnySearchApi.credentials.js');

const node = {
	id: 'contract-test',
	name: 'AnySearch',
	type: 'n8n-nodes-anysearch.anySearch',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};
const success = {
	code: 0,
	request_id: 'fixture-request-id',
	data: {
		results: [
			{ title: 'Fixture title', url: 'https://example.com/fixture', content: 'Fixture content' },
		],
	},
};

function scenario({
	response = success,
	statusCode = 200,
	headers = {},
	parameters = {},
	credentialData,
	credentialError,
	continueOnFail = false,
	inputItems = [{ json: {} }],
} = {}) {
	const requests = [];
	const hasCredential = credentialData !== undefined || credentialError !== undefined;
	const configured = hasCredential
		? {
				...node,
				credentials: { anySearchApi: { id: 'offline-credential', name: 'Offline fixture' } },
			}
		: { ...node };
	const resolved = {
		resource: 'search',
		operation: 'search',
		query: 'offline fixture query',
		options: { maxResults: 2 },
		...parameters,
	};
	const send = async (route, options) => {
		requests.push({ route, ...options });
		const body =
			typeof response === 'function' ? await response(options, requests.length - 1) : response;
		if (body instanceof Error) throw body;
		return { statusCode, headers, body };
	};
	const context = {
		getNode: () => configured,
		getInputData: () => inputItems,
		getNodeParameter: (name, _itemIndex, fallback) =>
			Object.hasOwn(resolved, name) ? resolved[name] : fallback,
		getCredentials: async () => {
			if (credentialError) throw credentialError;
			if (credentialData !== undefined) return credentialData;
			throw new Error('No credentials configured for this node');
		},
		continueOnFail: () => continueOnFail,
		helpers: {
			httpRequest: (options) => send('anonymous', options),
			httpRequestWithAuthentication: (_type, options) => send('authenticated', options),
		},
	};
	return { requests, execute: () => AnySearch.prototype.execute.call(context) };
}

async function runCase(configured) {
	const s = scenario(configured);
	try {
		const output = await s.execute();
		return { outcome: 'returned', output, requests: s.requests };
	} catch (error) {
		return {
			outcome: 'error',
			message: error.message,
			context: error.context,
			serialized: JSON.stringify(error),
			requests: s.requests,
		};
	}
}

test('search maps query and max_results and returns one item per result', async () => {
	const r = await runCase({});
	assert.equal(r.outcome, 'returned');
	assert.equal(r.requests.length, 1);
	assert.equal(r.requests[0].route, 'anonymous');
	assert.equal(r.requests[0].method, 'POST');
	assert.equal(r.requests[0].url, 'https://api.anysearch.com/v1/search');
	assert.deepEqual(r.requests[0].body, { query: 'offline fixture query', max_results: 2 });
	assert.deepEqual(r.output, [
		[
			{
				json: { ...success.data.results[0], request_id: success.request_id },
				pairedItem: { item: 0 },
			},
		],
	]);
});

test('search maps every optional parameter onto the request body', async () => {
	const r = await runCase({
		parameters: {
			options: {
				maxResults: 5,
				tag: 'code.doc',
				zone: 'cn',
				language: 'en',
				format: 'markdown',
				params: '{"library":"react"}',
			},
		},
	});
	assert.equal(r.outcome, 'returned');
	assert.deepEqual(r.requests[0].body, {
		query: 'offline fixture query',
		max_results: 5,
		tag: 'code.doc',
		zone: 'cn',
		language: 'en',
		format: 'markdown',
		params: { library: 'react' },
	});
});

test('search rejects malformed tag parameters before any request', async () => {
	const r = await runCase({ parameters: { options: { params: 'not json' } } });
	assert.equal(r.outcome, 'error');
	assert.equal(r.requests.length, 0);
});

test('search rejects an empty query before any request', async () => {
	const r = await runCase({ parameters: { query: '   ' } });
	assert.equal(r.outcome, 'error');
	assert.equal(r.requests.length, 0);
});

test('unsimplified search keeps request_id, results and metadata', async () => {
	const response = {
		code: 0,
		request_id: 'fixture-request-id',
		data: { results: [], metadata: { pages: 1 } },
	};
	const r = await runCase({
		response,
		parameters: { options: { maxResults: 2, simplify: false } },
	});
	assert.equal(r.outcome, 'returned');
	assert.deepEqual(r.output, [
		[
			{
				json: { request_id: 'fixture-request-id', results: [], metadata: { pages: 1 } },
				pairedItem: { item: 0 },
			},
		],
	]);
});

test('valid empty results are accepted as an empty output', async () => {
	const r = await runCase({ response: { code: 0, data: { results: [] } } });
	assert.equal(r.outcome, 'returned');
	assert.deepEqual(r.output, [[]]);
});

test('a response without the documented envelope is an error', async () => {
	const r = await runCase({ response: {} });
	assert.equal(r.outcome, 'error');
	assert.match(r.message, /unexpected response/i);
});

test('a non-object response body is an error', async () => {
	const r = await runCase({ response: [] });
	assert.equal(r.outcome, 'error');
});

test('a success envelope without data.results is an error, not an empty result', async () => {
	const r = await runCase({ response: { code: 0, request_id: 'missing-results', data: {} } });
	assert.equal(r.outcome, 'error');
	assert.match(r.message, /data\.results/);
});

test('a non-zero business code is an error without echoing the upstream message', async () => {
	const r = await runCase({ response: { code: 40001, message: 'Offline invalid input fixture' } });
	assert.equal(r.outcome, 'error');
	assert.match(r.message, /40001/);
	assert(!r.message.includes('Offline invalid input fixture'));
});

test('continued failures use the n8n error-output schema without losing diagnostics', async () => {
	const r = await runCase({ statusCode: 429, continueOnFail: true });
	const item = r.output[0][0];
	assert.deepEqual(Object.keys(item.json).sort(), ['details', 'error']);
	assert.equal(item.error, undefined);
	assert.equal(item.json.details.request_id, success.request_id);
	assert.equal(item.json.details.http_status, 429);
	assert.deepEqual(item.pairedItem, { item: 0 });
});

test('natural-language business errors cannot disclose generated credentials', async () => {
	const r = await runCase({
		continueOnFail: true,
		response: {
			code: -1,
			message: 'Your new password is PRIVATE_UPSTREAM_PASSWORD',
			request_id: 'business-id',
		},
	});
	assert(!JSON.stringify(r.output).includes('PRIVATE_UPSTREAM_PASSWORD'));
	assert.equal(r.output[0][0].json.details.request_id, 'business-id');
});

test('Codex metadata identifies the registered node and excludes the rejected AI category', () => {
	const metadata = localRequire('./dist/nodes/AnySearch/AnySearch.node.json');
	const packageInfo = localRequire('./package.json');
	assert.equal(metadata.node, `${packageInfo.name}.${new AnySearch().description.name}`);
	assert(!metadata.categories.includes('AI'));
});

test('extract returns url, title and content', async () => {
	const response = {
		code: 0,
		data: { url: 'https://example.com/page', title: 'Title', content: 'Body' },
	};
	const r = await runCase({
		response,
		parameters: { resource: 'extract', operation: 'extract', url: 'https://example.com/page' },
	});
	assert.equal(r.outcome, 'returned');
	assert.deepEqual(r.requests[0].body, { url: 'https://example.com/page' });
	assert.deepEqual(r.output[0][0].json, {
		url: 'https://example.com/page',
		title: 'Title',
		content: 'Body',
	});
});

test('extract rejects a response without extracted content', async () => {
	const r = await runCase({
		response: { code: 0, data: {} },
		parameters: { resource: 'extract', operation: 'extract', url: 'https://example.com/page' },
	});
	assert.equal(r.outcome, 'error');
	assert.match(r.message, /extract/i);
});

test('extract rejects a malformed URL before any request', async () => {
	const r = await runCase({
		parameters: { resource: 'extract', operation: 'extract', url: 'example.com' },
	});
	assert.equal(r.outcome, 'error');
	assert.equal(r.requests.length, 0);
});

test('domain listing returns one item per domain', async () => {
	const response = { code: 0, data: { domains: [{ domain: 'code', description: 'Code' }] } };
	const r = await runCase({
		response,
		parameters: { resource: 'capability', operation: 'getDomains' },
	});
	assert.equal(r.outcome, 'returned');
	assert.equal(r.requests[0].method, 'GET');
	assert.deepEqual(r.output[0][0].json, { domain: 'code', description: 'Code' });
});

test('domain listing without data.domains is an error', async () => {
	const r = await runCase({
		response: { code: 0, data: {} },
		parameters: { resource: 'capability', operation: 'getDomains' },
	});
	assert.equal(r.outcome, 'error');
	assert.match(r.message, /data\.domains/);
});

test('sub-domain listing repeats the domain query parameter', async () => {
	const response = {
		code: 0,
		data: { domains: [{ domain: 'code', sub_domains: [{ sub_domain: 'code.doc' }] }] },
	};
	const r = await runCase({
		response,
		parameters: {
			resource: 'capability',
			operation: 'getSubDomains',
			domains: ['code', 'finance'],
		},
	});
	assert.equal(r.outcome, 'returned');
	assert.equal(
		r.requests[0].url,
		'https://api.anysearch.com/v1/sub-domains?domain=code&domain=finance',
	);
});

test('an unselected credential uses the anonymous helper without Authorization', async () => {
	const r = await runCase({});
	assert.equal(r.requests[0].route, 'anonymous');
	assert.equal(r.requests[0].headers?.Authorization, undefined);
	assert.equal(new AnySearch().description.credentials[0].required, false);
});

test('a configured non-empty key uses the authenticated helper', async () => {
	const r = await runCase({ credentialData: { apiKey: 'synthetic_fixture' } });
	assert.equal(r.requests[0].route, 'authenticated');
});

test('a selected credential that cannot be read fails instead of falling back to anonymous', async () => {
	const r = await runCase({ credentialError: new Error('Stored credential cannot be decrypted') });
	assert.equal(r.outcome, 'error');
	assert.match(r.message, /cannot be decrypted/);
	assert.equal(r.requests.length, 0);
});

for (const apiKey of ['', '   ']) {
	test('a selected blank key uses anonymous access: ' + JSON.stringify(apiKey), async () => {
		const r = await runCase({ credentialData: { apiKey } });
		assert.equal(r.outcome, 'returned');
		assert.equal(r.requests[0].route, 'anonymous');
		assert.equal(r.requests[0].headers?.Authorization, undefined);
	});
}

test('the API key field may be left blank', () => {
	const apiKey = new AnySearchApi().properties.find((property) => property.name === 'apiKey');
	assert.notEqual(apiKey.required, true);
	assert.equal(apiKey.default, '');
});

for (const status of [401, 402, 429]) {
	test(`HTTP ${status} stays an error and does not fall back to anonymous`, async () => {
		const error = Object.assign(new Error(`Offline HTTP ${status} fixture`), {
			statusCode: status,
		});
		const r = await runCase({ response: error, credentialData: { apiKey: 'synthetic_fixture' } });
		assert.equal(r.outcome, 'error');
		assert.equal(r.requests.length, 1);
		assert.equal(r.requests[0].route, 'authenticated');
	});
}

test('a timeout rejection stays an error', async () => {
	const error = Object.assign(new Error('Offline request timed out'), { code: 'ETIMEDOUT' });
	const r = await runCase({ response: error });
	assert.equal(r.outcome, 'error');
	assert.match(r.message, /timed out/);
});

for (const code of [undefined, '0', 0.5]) {
	test('search rejects invalid business code: ' + String(code), async () => {
		const r = await runCase({ response: { code, data: { results: [] } } });
		assert.equal(r.outcome, 'error');
		assert.match(r.message, /invalid code/);
	});
}

for (const results of [null, [null]]) {
	test('search rejects malformed results: ' + JSON.stringify(results), async () => {
		const r = await runCase({ response: { code: 0, data: { results } } });
		assert.equal(r.outcome, 'error');
		assert.match(r.message, /data\.results/);
	});
}

for (const apiKey of ['', '   ', 'synthetic_fixture', ' synthetic_fixture ']) {
	test('credential authentication handles key: ' + JSON.stringify(apiKey), async () => {
		const input = {
			method: 'GET',
			url: 'https://api.anysearch.com/v1/domains',
			headers: { accept: 'application/json' },
		};
		const output = await new AnySearchApi().authenticate({ apiKey }, input);
		assert.equal(
			output.headers.Authorization,
			apiKey.trim() ? 'Bearer synthetic_fixture' : undefined,
		);
		assert.equal(Object.hasOwn(output.headers, 'Authorization'), Boolean(apiKey.trim()));
		assert.equal(output.headers.accept, 'application/json');
	});
}

test('continueOnFail emits an error item for malformed responses', async () => {
	const r = await runCase({ response: {}, continueOnFail: true });
	assert.equal(r.outcome, 'returned');
	assert.match(r.output[0][0].json.error, /unexpected response/);
	assert.deepEqual(r.output[0][0].pairedItem, { item: 0 });
});

for (const content of [undefined, null]) {
	test('extract rejects missing or invalid content: ' + String(content), async () => {
		const r = await runCase({
			response: {
				code: 0,
				request_id: 'extract-id',
				data: { url: 'https://example.com', title: '', content },
			},
			parameters: { resource: 'extract', operation: 'extract', url: 'https://example.com' },
		});
		assert.equal(r.outcome, 'error');
		assert.equal(r.context.request_id, 'extract-id');
	});
}

for (const results of [
	[{}],
	[{ title: 'Title', url: 12 }],
	[{ title: 'Title', url: 'https://example.com', content: {} }],
]) {
	test('search rejects malformed result fields: ' + JSON.stringify(results), async () => {
		const r = await runCase({ response: { code: 0, request_id: 'result-id', data: { results } } });
		assert.equal(r.outcome, 'error');
		assert.equal(r.context.request_id, 'result-id');
	});
}

for (const statusCode of [200, 402]) {
	for (const continueOnFail of [false, true]) {
		test(
			'sensitive upstream details stay private for HTTP ' +
				statusCode +
				', continue=' +
				continueOnFail,
			async () => {
				const r = await runCase({
					statusCode,
					continueOnFail,
					response: {
						code: -1,
						message: 'password=SYNTHETIC_PASSWORD api_key=SYNTHETIC_KEY',
						request_id: 'private-response-id',
					},
				});
				const observable = JSON.stringify({ output: r.output, serialized: r.serialized });
				assert(!observable.includes('SYNTHETIC_PASSWORD'));
				assert(!observable.includes('SYNTHETIC_KEY'));
				assert(observable.includes('private-response-id'));
				if (continueOnFail && statusCode !== 200)
					assert.equal(r.output[0][0].json.details.http_status, statusCode);
			},
		);
	}
}

for (const maxResults of [0, 11, 1.5, '2']) {
	test('invalid Max Results fails before HTTP: ' + String(maxResults), async () => {
		const r = await runCase({ parameters: { options: { maxResults } } });
		assert.equal(r.outcome, 'error');
		assert.equal(r.requests.length, 0);
	});
}

test('requests use bounded timeouts and do not forward authentication across redirects', async () => {
	const r = await runCase();
	assert.equal(r.requests[0].timeout, 60000);
	assert.equal(r.requests[0].disableFollowRedirect, true);
	assert.equal(r.requests[0].returnFullResponse, true);
	assert.equal(r.requests[0].headers['X-Anysearch-Client'], 'n8n-nodes-anysearch');
});

test('extract rejects embedded URL credentials before HTTP', async () => {
	const r = await runCase({
		parameters: {
			resource: 'extract',
			operation: 'extract',
			url: 'https://user:synthetic@example.com',
		},
	});
	assert.equal(r.outcome, 'error');
	assert.equal(r.requests.length, 0);
	assert(!r.serialized.includes('https://user'));
});

test('batch searches run concurrently, preserve order and isolate failures', async () => {
	let active = 0,
		peak = 0;
	const r = await runCase({
		parameters: {
			operation: 'batchSearch',
			queries: [
				{ query: 'first', max_results: 1 },
				{ query: 'second' },
				{ query: 'third', params: { empty: '', optional: false } },
			],
		},
		response: async (options) => {
			active++;
			peak = Math.max(peak, active);
			await new Promise((resolve) => setTimeout(resolve, options.body.query === 'first' ? 20 : 2));
			active--;
			return options.body.query === 'second'
				? { code: -1, message: 'Service unavailable', request_id: 'failed-id' }
				: success;
		},
	});
	assert.equal(peak, 3);
	assert.deepEqual(
		r.output[0].map((item) => item.json.query ?? item.json.details.query),
		['first', 'second', 'third'],
	);
	assert.deepEqual(
		r.output[0].map((item) => item.json.query_index ?? item.json.details.query_index),
		[0, 1, 2],
	);
	assert(r.output[0][0].json.results.length);
	assert.equal(r.output[0][1].json.details.request_id, 'failed-id');
	assert(r.output[0][1].json.error);
	assert(r.output[0][2].json.results.length);
	assert.deepEqual(r.requests[2].body.params, { empty: '', optional: false });
});

for (const queries of [[], Array(6).fill({ query: 'test' }), null, '{}', 'broken']) {
	test('batch rejects invalid collection: ' + JSON.stringify(queries), async () => {
		const r = await runCase({ parameters: { operation: 'batchSearch', queries } });
		assert.equal(r.outcome, 'error');
		assert.equal(r.requests.length, 0);
	});
}

test('batch invalid query does not prevent valid siblings from executing', async () => {
	const r = await runCase({
		parameters: { operation: 'batchSearch', queries: [{ query: 'good' }, { query: '' }] },
	});
	assert.equal(r.requests.length, 1);
	assert(r.output[0][0].json.results);
	assert(r.output[0][1].json.error);
});

test('multiple n8n inputs retain pairing, including failures', async () => {
	const r = await runCase({
		inputItems: [{ json: {} }, { json: {} }, { json: {} }],
		continueOnFail: true,
		response: (_options, index) =>
			index === 1 ? new Error('Synthetic transport failure') : success,
	});
	assert.deepEqual(
		r.output[0].map((item) => item.pairedItem.item),
		[0, 1, 2],
	);
	assert(r.output[0][1].json.error);
});

test('Feedback is not available in the resource picker or operation properties', () => {
	const { properties } = new AnySearch().description;
	const resource = properties.find((property) => property.name === 'resource');
	assert(!resource.options.some((option) => option.value === 'feedback'));
	assert(
		!properties.some((property) => property.displayOptions?.show?.resource?.includes('feedback')),
	);
});

for (const continueOnFail of [false, true]) {
	test(
		'saved Feedback steps fail without sending a request (continueOnFail=' + continueOnFail + ')',
		async () => {
			const r = await runCase({
				parameters: {
					resource: 'feedback',
					operation: 'score',
					feedbacks: [{ request_id: 'reviewed-id', score: 4 }],
				},
				continueOnFail,
			});
			assert.equal(r.requests.length, 0);
			if (continueOnFail) {
				assert.equal(r.outcome, 'returned');
				assert.match(r.output[0][0].json.error, /Unknown resource: feedback/);
				assert.deepEqual(r.output[0][0].pairedItem, { item: 0 });
			} else {
				assert.equal(r.outcome, 'error');
				assert.match(r.message, /Unknown resource: feedback/);
				assert.equal(r.context.itemIndex, 0);
			}
		},
	);
}

test('search forwards capability parameters without dropping empty required values', async () => {
	for (const params of [{ type: 'overview', symbol: 'AAPL', cn_code: '' }, {}]) {
		const r = await runCase({
			parameters: { options: { tag: 'finance.fundamental', params } },
		});
		assert.equal(r.outcome, 'returned', r.message);
		assert.equal(r.requests[0].body.tag, 'finance.fundamental');
		assert.deepEqual(r.requests[0].body.params, params);
	}
});

test('extract preserves Unicode and server truncation boundaries', async () => {
	const content = '😀'.repeat(49999) + '文';
	const r = await runCase({
		parameters: { resource: 'extract', operation: 'extract', url: 'https://example.com' },
		response: {
			code: 0,
			request_id: 'unicode-id',
			data: { url: 'https://example.com', title: '', content },
		},
	});
	assert.equal(r.outcome, 'returned');
	assert.equal(r.output[0][0].json.content, content);
	assert.equal(Array.from(r.output[0][0].json.content).length, 50000);
});

test('upstream credentials cannot be smuggled into request_id', async () => {
	const r = await runCase({
		statusCode: 402,
		continueOnFail: true,
		response: { code: -1, request_id: 'as_sk_synthetic_private_key' },
	});
	assert(!JSON.stringify(r.output).includes('as_sk_'));
});
