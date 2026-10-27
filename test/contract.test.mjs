// Offline contract tests for the compiled AnySearch node.
//
// They run against dist/, with the execution context and the HTTP helpers
// substituted, so no API key or n8n instance is needed. Run with: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
	data: { results: [{ title: 'Fixture title', url: 'https://example.com/fixture', content: 'Fixture content' }] },
};

function scenario({ response = success, parameters = {}, credentialData, credentialError, continueOnFail = false } = {}) {
	const requests = [];
	const hasCredential = credentialData !== undefined || credentialError !== undefined;
	const configured = hasCredential
		? { ...node, credentials: { anySearchApi: { id: 'offline-credential', name: 'Offline fixture' } } }
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
		if (response instanceof Error) throw response;
		return response;
	};
	const context = {
		getNode: () => configured,
		getInputData: () => [{ json: {} }],
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
		return { outcome: 'error', message: error.message, requests: s.requests };
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
		[{ json: success.data.results[0], pairedItem: { item: 0 } }],
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
	const response = { code: 0, request_id: 'fixture-request-id', data: { results: [], metadata: { pages: 1 } } };
	const r = await runCase({ response, parameters: { options: { maxResults: 2, simplify: false } } });
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

test('a non-zero business code is an error and keeps the upstream message', async () => {
	const r = await runCase({ response: { code: 40001, message: 'Offline invalid input fixture' } });
	assert.equal(r.outcome, 'error');
	assert.match(r.message, /Offline invalid input fixture/);
});

test('Codex metadata identifies the registered node and excludes the rejected AI category', () => {
	const metadata = localRequire('./dist/nodes/AnySearch/AnySearch.node.json');
	const packageInfo = localRequire('./package.json');
	assert.equal(metadata.node, `${packageInfo.name}.${new AnySearch().description.name}`);
	assert(!metadata.categories.includes('AI'));
});

test('extract returns url, title and content', async () => {
	const response = { code: 0, data: { url: 'https://example.com/page', title: 'Title', content: 'Body' } };
	const r = await runCase({
		response,
		parameters: { resource: 'extract', operation: 'extract', url: 'https://example.com/page' },
	});
	assert.equal(r.outcome, 'returned');
	assert.deepEqual(r.requests[0].body, { url: 'https://example.com/page' });
	assert.deepEqual(r.output[0][0].json, { url: 'https://example.com/page', title: 'Title', content: 'Body' });
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
	const r = await runCase({ response, parameters: { resource: 'capability', operation: 'getDomains' } });
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
	const response = { code: 0, data: { domains: [{ domain: 'code.code' }] } };
	const r = await runCase({
		response,
		parameters: { resource: 'capability', operation: 'getSubDomains', domains: ['code', 'finance'] },
	});
	assert.equal(r.outcome, 'returned');
	assert.equal(r.requests[0].url, 'https://api.anysearch.com/v1/sub-domains?domain=code&domain=finance');
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

test('a selected credential with a blank key uses anonymous access', async () => {
	const r = await runCase({ credentialData: { apiKey: '   ' } });
	assert.equal(r.outcome, 'returned');
	assert.equal(r.requests[0].route, 'anonymous');
	assert.equal(r.requests[0].headers?.Authorization, undefined);
});

test('the API key field may be left blank', () => {
	const apiKey = new AnySearchApi().properties.find((property) => property.name === 'apiKey');
	assert.notEqual(apiKey.required, true);
	assert.equal(apiKey.default, '');
});

for (const status of [401, 402, 429]) {
	test(`HTTP ${status} stays an error and does not fall back to anonymous`, async () => {
		const error = Object.assign(new Error(`Offline HTTP ${status} fixture`), { statusCode: status });
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

function runSmoke(fixtureMode, apiKey = '') {
	return spawnSync(
		process.execPath,
		['--require', path.join(root, 'test/smoke-fetch-fixture.cjs'), 'scripts/smoke.mjs'],
		{
			cwd: root,
			env: { ...process.env, ANYSEARCH_API_KEY: apiKey, SMOKE_FIXTURE_MODE: fixtureMode },
			encoding: 'utf8',
			timeout: 60000,
			windowsHide: true,
		},
	);
}

test('the smoke script passes on well-formed responses', () => {
	const result = runSmoke('valid');
	const output = `${result.stdout}${result.stderr}`;
	assert.equal(result.status, 0, output);
	assert.match(output, /All smoke tests passed\./);
});

test('the smoke script uses the authenticated helper when a key is configured', () => {
	const result = runSmoke('valid', 'synthetic_fixture');
	assert.equal(result.error, undefined);
	assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
	assert.match(result.stdout, /authenticated/);
});

test('the smoke script fails when every response is malformed', () => {
	const result = runSmoke('malformed');
	const output = `${result.stdout}${result.stderr}`;
	assert.notEqual(result.status, 0, output);
	assert.doesNotMatch(output, /All smoke tests passed\./);
	assert.match(output, /smoke check\(s\) failed/);
});

for (const code of [undefined, null, '0', '40001', NaN, Infinity]) {
 test('search rejects invalid business code: ' + String(code), async () => {
  const r = await runCase({ response: { code, data: { results: [] } } });
  assert.equal(r.outcome, 'error');
  assert.match(r.message, /invalid code/);
 });
}

for (const results of [null, {}, '', [null], ['invalid'], [[]]]) {
 test('search rejects malformed results: ' + JSON.stringify(results), async () => {
  for (const simplify of [true, false]) {
   const r = await runCase({ response: { code: 0, data: { results } }, parameters: { options: { simplify } } });
   assert.equal(r.outcome, 'error');
   assert.match(r.message, /data\.results/);
  }
 });
}

for (const apiKey of ['', '   ', 'synthetic_fixture', ' synthetic_fixture ']) {
 test('credential authentication handles key: ' + JSON.stringify(apiKey), async () => {
  const input = { method: 'GET', url: 'https://api.anysearch.com/v1/domains', headers: { accept: 'application/json' } };
  const output = await new AnySearchApi().authenticate({ apiKey }, input);
  assert.equal(output.headers.Authorization, apiKey.trim() ? 'Bearer synthetic_fixture' : undefined);
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

test('selected empty key uses anonymous helper without Authorization', async () => {
 const r = await runCase({ credentialData: { apiKey: '' } });
 assert.equal(r.outcome, 'returned');
 assert.equal(r.requests[0].route, 'anonymous');
 assert.equal(r.requests[0].headers?.Authorization, undefined);
});
