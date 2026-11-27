// Offline contract tests for the compiled AnySearch node.
//
// They run against dist/, with the execution context and the HTTP helpers
// substituted, so no API key or n8n instance is needed. Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addCapabilityChecks, checkCapabilityRequests } from './e2e/capability-checks.mjs';
import { catalogCoverage } from './e2e/catalog-checks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localRequire = createRequire(path.join(root, 'package.json'));
const { AnySearch } = localRequire('./dist/nodes/AnySearch/AnySearch.node.js');
const { AnySearchApi } = localRequire('./dist/credentials/AnySearchApi.credentials.js');
const { missingParameterMessage } = localRequire('./dist/nodes/AnySearch/capabilityParameters.js');
const { NodeHelpers } = localRequire('n8n-workflow');

const node = {
	id: 'contract-test',
	name: 'AnySearch',
	type: 'n8n-nodes-anysearch.anySearch',
	typeVersion: 2,
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
	onError,
	typeVersion = node.typeVersion,
	inputItems = [{ json: {} }],
} = {}) {
	const requests = [];
	const hasCredential = credentialData !== undefined || credentialError !== undefined;
	const configured = { ...node, typeVersion, onError };
	if (hasCredential)
		configured.credentials = {
			anySearchApi: { id: 'offline-credential', name: 'Offline fixture' },
		};
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
		getCredentials: async (_type, itemIndex) => {
			if (credentialError) throw credentialError;
			if (typeof credentialData === 'function') return credentialData(itemIndex);
			if (credentialData !== undefined) return credentialData;
			throw new Error('No credentials configured for this node');
		},
		continueOnFail: () => continueOnFail,
		helpers: {
			httpRequest: (options) => send('anonymous', options),
			async httpRequestWithAuthentication(_type, options, { credentialsDecrypted }) {
				const authenticated = await new AnySearchApi().authenticate(
					credentialsDecrypted.data,
					options,
				);
				return send('authenticated', authenticated);
			},
		},
	};
	return {
		requests,
		execute: () => AnySearch.prototype.execute.call(context),
		loadDomains: () => new AnySearch().methods.loadOptions.getDomains.call(context),
	};
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

test('specialized acceptance binds HTTP IDs to the originating single node and batch position', async () => {
	const plan = [];
	addCapabilityChecks((name, parameters) => plan.push({ name, parameters }), null);
	const requests = [];
	const nodes = [];
	for (const { name, parameters } of plan) {
		const run = await runCase({
			parameters,
			continueOnFail: true,
			response({ body }) {
				const request_id = 'specialized-' + requests.length;
				const missingRequired = [
					'Flight number missing',
					'Flight ticket parameters missing',
					'Flight departure missing',
					'Overview ticker keys missing',
				].includes(body.query);
				const status = missingRequired ? 400 : 200;
				requests.push({ body, request_id, status });
				if (missingRequired) {
					return Object.assign(new Error('Offline invalid request'), {
						response: { status, data: { code: -1, request_id } },
					});
				}
				return { ...success, request_id };
			},
		});
		nodes.push({
			name,
			results: run.output[0].map(({ json }) => ({
				request_id: json.request_id ?? json.details?.request_id,
				query_index: json.query_index ?? json.details?.query_index,
			})),
		});
	}
	checkCapabilityRequests(requests, nodes);
	const first = nodes[0].results[0];
	const second = nodes[1].results[0];
	[first.request_id, second.request_id] = [second.request_id, first.request_id];
	assert.throws(() => checkCapabilityRequests(requests, nodes), /AAPL: Request ID differs/);
	[first.request_id, second.request_id] = [second.request_id, first.request_id];
	const batch = nodes.find(({ name }) => name === 'Capability batch 1').results;
	[batch[0].request_id, batch[1].request_id] = [batch[1].request_id, batch[0].request_id];
	assert.throws(() => checkCapabilityRequests(requests, nodes), /Hide on Bush: Request ID differs/);
});

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

test('explicit JSON format is forwarded and AnySearch validates incomplete tags', async () => {
	const r = await runCase({ parameters: { options: { tag: 'future.new-tag', format: 'json' } } });
	assert.equal(r.requests[0].body.format, 'json');
	const invalid = await runCase({
		parameters: { options: { tag: 'finance' } },
		statusCode: 400,
		response: { code: -1, error_code: 'INVALID_TAG', request_id: 'tag-id' },
	});
	assert.equal(invalid.requests[0].body.tag, 'finance');
	assert.equal(invalid.context.http_status, 400);
	assert.equal(invalid.context.error_code, 'INVALID_TAG');
});

test('search sends a blank query unchanged and reports the AnySearch rejection', async () => {
	const r = await runCase({
		parameters: { query: '   ' },
		statusCode: 400,
		response: { code: -1, message: 'Query is required.', request_id: 'query-id' },
	});
	assert.equal(r.outcome, 'error');
	assert.equal(r.requests[0].body.query, '   ');
	assert.equal(r.message, 'Query is required.');
	assert.equal(r.context.request_id, 'query-id');
});

test('n8n preflight allows required REST fields to reach AnySearch when empty', () => {
	const { description } = new AnySearch();
	for (const parameters of [
		{ resource: 'search', operation: 'search', query: '' },
		{ resource: 'extract', operation: 'extract', url: '' },
		{ resource: 'capability', operation: 'getSubDomains', domains: [] },
	]) {
		assert.equal(
			NodeHelpers.getNodeParametersIssues(
				description.properties,
				{ ...node, parameters },
				description,
			),
			null,
		);
	}
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

test('a non-object response body is an error', async () => {
	const r = await runCase({ response: [] });
	assert.equal(r.outcome, 'error');
	assert.match(r.message, /expected a JSON object/);
});

test('a success envelope without data.results is an error, not an empty result', async () => {
	const r = await runCase({ response: { code: 0, request_id: 'missing-results', data: {} } });
	assert.equal(r.outcome, 'error');
	assert.match(r.message, /data\.results/);
});

test('continued failures retain diagnostics in regular and dedicated n8n error outputs', async () => {
	for (const mode of [
		{},
		{ onError: 'continueErrorOutput' },
		{
			onError: 'continueErrorOutput',
			parameters: { operation: 'batchSearch', queries: [{ query: 'test' }] },
		},
	]) {
		const r = await runCase({
			...mode,
			continueOnFail: true,
			statusCode: 429,
		});
		const item = r.output[0][0];
		assert.deepEqual(item.pairedItem, { item: 0 });
		assert.equal(item.error, undefined);
		assert.equal(item.json.message, mode.onError ? item.json.error : undefined);
		const stored = JSON.parse(JSON.stringify(item.json));
		assert.deepEqual(Object.keys(stored).sort(), ['details', 'error']);
		assert.equal(stored.details.http_status, 429);
		assert.equal(stored.details.request_id, success.request_id);
		if (mode.parameters) assert.equal(stored.details.query_index, 0);
	}
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

test('search rejects malformed documented metadata fields', async () => {
	for (const metadata of [{ total_results: '5' }, { total_results: 1.5 }, { search_time_ms: {} }]) {
		const r = await runCase({ response: { ...success, data: { ...success.data, metadata } } });
		assert.equal(r.outcome, 'error');
		assert.match(r.message, /invalid metadata/);
		assert.equal(r.context.request_id, success.request_id);
	}
});

test('extract sends invalid URLs unchanged for AnySearch to validate', async () => {
	for (const url of ['example.com', ' https://example.com ', 'ftp://example.com', '']) {
		const r = await runCase({
			parameters: { resource: 'extract', operation: 'extract', url },
			statusCode: 400,
			response: { code: -1, message: 'URL is invalid.', error_code: 'invalid_extract_url' },
		});
		assert.equal(r.outcome, 'error');
		assert.deepEqual(r.requests[0].body, { url });
		assert.equal(r.requests[0].headers['Content-Type'], 'application/json');
		assert.equal(r.message, 'URL is invalid.');
		assert.equal(r.context.error_code, 'invalid_extract_url');
	}
});

test('version 1 trims extraction URLs and rejects malformed URLs before HTTP', async () => {
	const url = 'https://example.com/page';
	const parameters = { resource: 'extract', operation: 'extract' };
	const trimmed = await runCase({
		typeVersion: 1,
		parameters: { ...parameters, url: ` ${url} ` },
		response: { code: 0, data: { url, title: 'Title', content: 'Body' } },
	});
	assert.equal(trimmed.outcome, 'returned');
	assert.deepEqual(trimmed.requests[0].body, { url });

	for (const [badUrl, message] of [
		['example.com', /absolute public HTTP\(S\) URL/],
		['ftp://example.com', /must use HTTP\(S\)/],
	]) {
		const rejected = await runCase({
			typeVersion: 1,
			parameters: { ...parameters, url: badUrl },
		});
		assert.equal(rejected.outcome, 'error');
		assert.match(rejected.message, message);
		assert.equal(rejected.requests.length, 0);
	}
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

test('the domain picker reads the same domain definitions as the capability operation', async () => {
	const s = scenario({
		response: { code: 0, data: { domains: [{ domain: 'finance', description: 'Finance' }] } },
	});
	assert.deepEqual(await s.loadDomains(), [{ value: 'finance', name: 'finance — Finance' }]);
	assert.equal(s.requests[0].url, 'https://api.anysearch.com/v1/domains');
	const invalid = scenario({
		response: { code: 0, data: { domains: [{ description: 'missing name' }] } },
	});
	await assert.rejects(invalid.loadDomains(), /invalid domain/);
});

test('sub-domain listing preserves repeated query values in version 2 and cleans them in version 1', async () => {
	const response = {
		code: 0,
		data: { domains: [{ domain: 'code', sub_domains: [{ sub_domain: 'code.doc' }] }] },
	};
	for (const [typeVersion, query] of [
		[1, 'domain=code&domain=finance'],
		[2, 'domain=code&domain=finance&domain=code&domain=&domain=+finance+'],
	]) {
		const r = await runCase({
			typeVersion,
			response,
			parameters: {
				resource: 'capability',
				operation: 'getSubDomains',
				domains: ['code', 'finance', 'code', '', ' finance '],
			},
		});
		assert.equal(r.outcome, 'returned');
		assert.equal(r.requests[0].url, `https://api.anysearch.com/v1/sub-domains?${query}`);
	}
});

test('sub-domain listing rejects malformed capability definitions', async () => {
	for (const entry of [
		{ sub_domain: '' },
		{ sub_domain: 'code.doc', params: [] },
		{ sub_domain: 'code.doc', params: { library: { required: 'true', description: 'Library' } } },
		{ sub_domain: 'code.doc', params: { library: { required: true, description: 1 } } },
		{
			sub_domain: 'code.doc',
			params: { library: { required: true, description: 'Library', sort_order: 'first' } },
		},
	]) {
		const r = await runCase({
			parameters: { resource: 'capability', operation: 'getSubDomains', domains: ['code'] },
			response: { ...success, data: { domains: [{ domain: 'code', sub_domains: [entry] }] } },
		});
		assert.equal(r.outcome, 'error');
		assert.match(r.message, /invalid domain definitions/);
		assert.equal(r.context.request_id, success.request_id);
	}
});

test('sub-domain listing lets AnySearch report an empty selection', async () => {
	const parameters = { resource: 'capability', operation: 'getSubDomains', domains: [] };
	const r = await runCase({
		parameters,
		statusCode: 400,
		response: { code: -1, message: 'At least one domain parameter is required.' },
	});
	assert.equal(r.requests[0].url, 'https://api.anysearch.com/v1/sub-domains');
	assert.equal(r.message, 'At least one domain parameter is required.');
	assert.equal(r.context.http_status, 400);

	const legacy = await runCase({ typeVersion: 1, parameters });
	assert.equal(legacy.requests.length, 0);
	assert.match(legacy.message, /Domain Names or IDs must not be empty/);
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

test('authentication resolves and reuses the credential for the current input item', async () => {
	const lookedUp = [];
	const keys = ['', 'synthetic_second', ' synthetic_third '];
	const r = await runCase({
		inputItems: keys.map(() => ({ json: {} })),
		credentialData(itemIndex) {
			lookedUp.push(itemIndex);
			return { apiKey: keys[itemIndex] };
		},
	});
	assert.equal(r.outcome, 'returned', r.message);
	assert.deepEqual(lookedUp, [0, 1, 2]);
	assert.deepEqual(
		r.requests.map(({ headers }) => headers.Authorization),
		[undefined, 'Bearer synthetic_second', 'Bearer synthetic_third'],
	);
});

test('non-string keys fail in both node execution and the credential tester', async () => {
	const data = { apiKey: 42 };
	await assert.rejects(
		new AnySearchApi().authenticate(data, { url: 'https://api.anysearch.com/v1/domains' }),
		/API Key string/,
	);
	const r = await runCase({ credentialData: data });
	assert.match(r.message, /API Key string/);
	assert.equal(r.requests.length, 0);
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

for (const data of [
	{},
	{ url: 'https://example.com', title: '' },
	{ url: 'https://example.com', title: '', content: null },
]) {
	test('extract rejects malformed data: ' + JSON.stringify(data), async () => {
		const r = await runCase({
			response: { code: 0, request_id: 'extract-id', data },
			parameters: { resource: 'extract', operation: 'extract', url: 'https://example.com' },
		});
		assert.equal(r.outcome, 'error');
		assert.match(r.message, /extract/i);
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

test('search preserves supplied values and leaves omitted fields to AnySearch defaults', async () => {
	const query = '  a search query  ';
	const minimal = await runCase({ parameters: { query, options: { zone: '' } } });
	assert.deepEqual(minimal.requests[0].body, { query });
	for (const maxResults of [0, 11, 1.5, '2', null]) {
		const r = await runCase({
			parameters: { query, options: { maxResults, zone: ' intl ', format: ' ', params: 'null' } },
		});
		assert.deepEqual(r.requests[0].body, {
			query,
			max_results: maxResults,
			zone: ' intl ',
			format: ' ',
			params: null,
		});
	}
});

test('requests use bounded timeouts and do not forward authentication across redirects', async () => {
	const r = await runCase();
	assert.equal(r.requests[0].timeout, 60000);
	assert.equal(r.requests[0].disableFollowRedirect, true);
	assert.equal(r.requests[0].returnFullResponse, true);
	assert.equal(r.requests[0].headers['Content-Type'], 'application/json');
	assert.equal(r.requests[0].headers['X-Anysearch-Client'], 'n8n-nodes-anysearch');
});

test('extract rejects embedded URL credentials before HTTP', async () => {
	for (const url of [
		'https://user:synthetic@example.com',
		'https://user:synthetic@example com',
		'//user:synthetic@example.com',
		'https:user:synthetic@example com',
		'ht\ttps://user:synthetic@exa mple.com',
		'\u0001https://user:synthetic@example com',
		'\u0000//user:synthetic@example.com',
		'ftp://user:synthetic@example com',
	]) {
		const r = await runCase({ parameters: { resource: 'extract', operation: 'extract', url } });
		assert.equal(r.outcome, 'error');
		assert.equal(r.requests.length, 0);
		assert(!r.serialized.includes('https://user'));
	}
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
	const failed = Object.assign(new Error('offline HTTP 400 fixture'), {
		response: {
			status: 400,
			data: { code: -1, message: 'Query is required.', request_id: 'bad-id' },
		},
	});
	const r = await runCase({
		parameters: {
			operation: 'batchSearch',
			queries: [
				{ query: 'good', extra: 'sent unchanged' },
				{ query: '', params: '{}' },
				{},
				[],
				42,
			],
		},
		response: ({ body }) => (body.query ? success : failed),
	});
	assert.deepEqual(
		r.requests.map(({ body }) => body),
		[{ query: 'good', extra: 'sent unchanged' }, { query: '', params: '{}' }, '{}', '[]', '42'],
	);
	assert(r.output[0][0].json.results);
	assert.equal(r.output[0][1].json.error, 'Query is required.');
	assert.equal(r.output[0][1].json.details.request_id, 'bad-id');
});

test('a sparse Batch Search expression yields an error item instead of an empty output slot', async () => {
	const queries = Array(2);
	queries[1] = { query: 'good' };
	const failure = Object.assign(new Error('offline HTTP 400 fixture'), { statusCode: 400 });
	const r = await runCase({
		parameters: { operation: 'batchSearch', queries },
		response: ({ body }) => (body === 'null' ? failure : success),
	});
	assert.deepEqual(
		r.requests.map(({ body }) => body),
		['null', { query: 'good' }],
	);
	assert.equal(r.output[0][0].json.details.query_index, 0);
	assert.equal(r.output[0][0].json.details.http_status, 400);
	assert.equal(r.output[0][1].json.query_index, 1);
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

test('Search and Batch Search submit capability parameters as supplied', async () => {
	const examples = [
		['travel.flight_status', { flight_number: 'CA981' }],
		['travel.flight_status', { flight_number: 'CA981', departure: '' }],
		['finance.fundamental', { type: 'overview' }],
		['finance.fundamental', { type: 'overview', symbol: 'AAPL', cn_code: '600519.SH' }],
		['finance.fundamental', { type: ' balance ', cn_code: 600519, symbol: false }],
		['finance.calendar', { type: 'earnings', symbol: 'AAPL', period: '7d' }],
		['finance.quote', { type: 'crypto' }],
		['finance.quote', { type: 'stock', symbol: 'AAPL', period: '0d' }],
		['finance.news', { type: 'flash', news_src: 'future_source' }],
		['gaming.esports', { type: 'player', game_name: 'Hide on Bush#KR1' }],
		['gaming.esports', { type: 'champion', region: 'unused' }],
		['gaming.esports', { type: 'leaderboard', region: 'kr', tier: 'MASTER', division: false }],
		['gaming.esports', { type: 'match_detail', match_id: 'EUW1_6723541890' }],
		['academic.citation', { op: 'citation', id: '10.1038/s41586-021-03819-2' }],
		['code.doc', { library: null }],
		['future.tag', { optional: false, nested: { filter: ['a', 2] } }],
		['finance.fundamental', {}],
	];
	for (const [tag, input] of examples) {
		const query = 'test';
		const params = Object.freeze(input);
		const body = { query, tag, params };
		for (const parameters of [
			{ query, options: { tag, params } },
			{ query, options: { tag, params: JSON.stringify(params) } },
			{ operation: 'batchSearch', queries: [body] },
			{ operation: 'batchSearch', queries: JSON.stringify([body]) },
		]) {
			const run = await runCase({ parameters });
			assert.equal(run.outcome, 'returned', run.message);
			assert.equal(run.requests.length, 1, tag);
			assert.deepEqual(run.requests[0].body, body, tag);
		}
	}
});

test('version 1 Search and Batch Search preserve released capability defaults and validation', async () => {
	const examples = [
		['travel.flight_status', { flight_number: 'CA981' }, { departure: '' }],
		['finance.fundamental', { type: 'overview' }, { symbol: '', cn_code: '' }],
		['finance.fundamental', { type: 'balance', cn_code: 600519, symbol: 'AAPL' }, { symbol: '' }],
		['finance.calendar', { type: 'earnings', symbol: 'AAPL', period: '7d' }, { period: '90d' }],
		['finance.quote', { type: 'stock', symbol: 'AAPL', period: '0d' }, /\bperiod\b/],
		['finance.quote', { type: 'crypto' }, /\bsymbol\b/],
		['gaming.esports', { type: 'player', game_name: 'Hide on Bush#KR1' }, /\bregion\b/],
		['gaming.esports', { type: 'match_detail', match_id: null }, /\bmatch_id\b/],
		['academic.citation', { op: 'citation', id: '10.1038/example' }, /\bOCI\b/],
	];
	for (const [tag, input, expected] of examples) {
		const params = Object.freeze(input);
		const query = 'saved workflow query';
		for (const parameters of [
			{ query, options: { tag, params: JSON.stringify(params) } },
			{ operation: 'batchSearch', queries: [{ query, tag, params }] },
		]) {
			const run = await runCase({ typeVersion: 1, parameters });
			if (expected instanceof RegExp) {
				assert.equal(run.requests.length, 0, tag);
				const error = run.output?.[0][0].json.error ?? run.message;
				assert.match(error, expected, tag);
			} else {
				assert.equal(run.outcome, 'returned', run.message);
				assert.equal(run.requests.length, 1, tag);
				assert.deepEqual(run.requests[0].body, { query, tag, params: { ...params, ...expected } });
			}
		}
	}
});

test('every reviewed catalog parameter reaches HTTP on both entry points', async () => {
	const { tags } = localRequire('./test/e2e/catalog.json');
	const cases = localRequire('./test/e2e/search-cases.json');
	for (const [tag, fields] of Object.entries(tags)) {
		for (const [field, { required }] of Object.entries(fields)) {
			const message = "Missing required params for tag '" + tag + "': " + field + '.';
			assert.equal(
				missingParameterMessage(message),
				required ? message : undefined,
				tag + '.' + field,
			);
		}
	}
	for (const batch of [false, true]) {
		const bodies = [];
		for (const { query, max_results, ...fields } of cases) {
			const input = { query, ...fields, max_results };
			const parameters = batch
				? { operation: 'batchSearch', queries: [input] }
				: { query, options: { ...fields, maxResults: max_results } };
			const r = await runCase({ parameters });
			assert.equal(r.requests.length, 1, fields.tag ?? query);
			const body = r.requests[0].body;
			assert.deepEqual(body, input);
			bodies.push(body);
		}
		const coverage = catalogCoverage(bodies, tags);
		assert.deepEqual(coverage.missing, []);
		assert.deepEqual(coverage.unexpected, []);
	}
});

test('existing workflows can forward provider-specific paper fields outside the current catalog', async () => {
	const params = {
		data_source: 'arxiv',
		source: 'MED',
		categories: 'cs.CL',
		category: 'cs.LG',
		domain: 'arxiv.org',
		citation_count: '100',
		citation_doi: '10.48550/arXiv.1706.03762',
		order: 'desc',
		sort: 'date',
		date_type: 'pdat',
		field: 'ti',
		journal: 'Nature',
		type: 'article',
		has_pdf: 'true',
		kind: 'abstract',
		year_from: '2017',
		year_to: '2018',
		document_type: 'research',
	};
	const r = await runCase({ parameters: { options: { tag: 'academic.paper', params } } });
	assert.deepEqual(r.requests[0].body.params, params);
});

test('unrecognized 400 messages and credential-like fields stay private, including after rerouting', async () => {
	for (const message of [
		'Your new password is PRIVATE_UPSTREAM_PASSWORD',
		"Missing required params for tag 'travel.flight_status': as_sk_private.",
		"Missing required params for tag 'travel.private': flight_number.",
		"Missing required params for tag 'travel.flight_status': flight_number.\nPRIVATE_UPSTREAM_PASSWORD",
	]) {
		const r = await runCase({
			statusCode: 400,
			continueOnFail: true,
			response: { code: -1, request_id: 'as_sk_private', message },
			headers: { 'x-request-id': 'safe-header-id' },
		});
		const item = r.output[0][0].json;
		assert.match(item.error, /rejected the parameters/);
		assert.equal(item.details.request_id, 'safe-header-id');
		assert(!/private/i.test(JSON.stringify(item)));
	}
});

test('search repairs duplicated Reddit origins and preserves paths, empty URLs and other origins', async () => {
	const origin = 'https://www.reddit.com';
	const path = '/r/Python/comments/abc/?sort=top#comment';
	const urls = [origin + origin + path, origin + path, '', origin + 'https://example.com' + path];
	const results = urls.map((url) => ({ title: '', url, snippet: null }));
	const r = await runCase({ response: { code: 0, data: { results } } });
	assert.deepEqual(
		r.output[0].map((item) => item.json.url),
		[origin + path, ...urls.slice(1)],
	);
	assert.deepEqual(
		results.map((item) => item.url),
		urls,
	);
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

test('documented API errors retain their status, message, and supplied codes in n8n', async () => {
	for (const [statusCode, message, errorCode] of [
		[400, 'Query is required.'],
		[400, 'At least one domain parameter is required.'],
		[400, 'URL is invalid.', 'invalid_extract_url'],
		[401, 'Invalid API key.', 'invalid_api_key'],
		[422, 'Extraction failed.', 'extract_failed'],
	]) {
		const r = await runCase({
			statusCode,
			headers: { 'X-Request-ID': 'official-error-id' },
			response: { code: -1, message, ...(errorCode && { error_code: errorCode }) },
		});
		assert.equal(r.message, message);
		assert.equal(r.context.http_status, statusCode);
		assert.equal(r.context.request_id, 'official-error-id');
		assert.equal(r.context.code, -1);
		assert.equal(r.context.error_code, errorCode);
	}
});

test('missing capability parameters keep their diagnostics for returned and thrown HTTP errors', async () => {
	const message = "Missing required params for tag 'travel.flight': departure, arrival, date.";
	const body = { code: -1, message, error_code: 'MISSING_REQUIRED_PARAMS' };
	const request_id = 'catalog-error-id';
	const returned = { statusCode: 400, response: { ...body, request_id } };
	const thrown = (data) => ({
		response: Object.assign(new Error('Offline transport error'), {
			response: { status: 400, data, headers: { 'X-Request-ID': request_id } },
		}),
	});
	for (const config of [
		thrown(body),
		{ ...thrown(JSON.stringify(body)), continueOnFail: true },
		{ ...returned, continueOnFail: true, onError: 'continueErrorOutput' },
		{ ...returned, parameters: { operation: 'batchSearch', queries: [{ query: 'fixture' }] } },
	]) {
		const r = await runCase(config);
		const item = r.output?.[0][0].json;
		const details = r.context ?? JSON.parse(JSON.stringify(item)).details;
		assert.equal(r.message ?? item.error, message);
		assert.equal(details.http_status, 400);
		assert.equal(details.request_id, request_id);
		assert.equal(details.code, body.code);
		assert.equal(details.error_code, body.error_code);
	}
});

test('validation errors identify the REST field without echoing input values', async () => {
	for (const [message, error_code, expected] of [
		['Invalid tag: SYNTHETIC_INPUT.', 'INVALID_TAG', 'Invalid capability tag.'],
		[
			'Invalid zone: SYNTHETIC_INPUT. Valid values: cn, intl.',
			undefined,
			'Invalid zone. Valid values: cn, intl.',
		],
		[
			'Invalid request body: json: cannot unmarshal number into Go struct field SearchRequest.query of type string.',
			undefined,
			'Invalid request body field: query.',
		],
	]) {
		const r = await runCase({ statusCode: 400, response: { code: -1, message, error_code } });
		assert.equal(r.message, expected);
		assert(!r.serialized.includes('SYNTHETIC_INPUT'));
	}
});

test('HTTP 402 keeps only the status and request ID from the API response', async () => {
	for (const [continueOnFail, request_id] of [
		[false, 'quota-request-id'],
		[true, 'quota-request-id'],
		[true, 'as_sk_synthetic_private_key'],
	]) {
		const r = await runCase({
			statusCode: 402,
			continueOnFail,
			response: {
				code: -1,
				message: 'username=example\npassword=example_password\napi_key=example_key',
				request_id,
				error_code: 'example_key',
			},
		});
		const item = r.output?.[0][0].json;
		const { itemIndex, ...diagnostics } = r.context ?? item.details;
		assert.equal(itemIndex, continueOnFail ? undefined : 0);
		assert.deepEqual(
			diagnostics,
			request_id.startsWith('as_sk_') ? { http_status: 402 } : { http_status: 402, request_id },
		);
		assert.doesNotMatch(JSON.stringify(item ?? r.serialized), /example|as_sk_/);
	}
});

test('HTTP 200 with a non-zero business code fails and hides the upstream message', async () => {
	for (const continueOnFail of [false, true]) {
		const r = await runCase({
			continueOnFail,
			response: {
				code: 40001,
				message: 'Your new password is SYNTHETIC_PASSWORD. api_key=SYNTHETIC_KEY',
				request_id: 'business-failure',
				error_code: 'INVALID_TAG',
			},
		});
		const item = r.output?.[0][0].json;
		const { itemIndex, ...diagnostics } = r.context ?? item.details;
		assert.equal(itemIndex, continueOnFail ? undefined : 0);
		assert.match(r.message ?? item.error, /40001/);
		assert.deepEqual(diagnostics, {
			code: 40001,
			error_code: 'INVALID_TAG',
			http_status: 200,
			request_id: 'business-failure',
		});
		assert(!JSON.stringify(item ?? r.serialized).includes('SYNTHETIC'));
	}
});

test('a zero business code with an unexpected HTTP status fails', async () => {
	const r = await runCase({ statusCode: 202 });
	assert.equal(r.outcome, 'error');
	assert.equal(r.context.http_status, 202);
});
