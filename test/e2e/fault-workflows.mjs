import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

export async function runFaultWorkflows({
	invoke,
	executionFrom,
	root,
	work,
	output,
	redact,
	apiKey,
}) {
	const privateValues = ['PRIVATE_UPSTREAM_KEY', 'PRIVATE_UPSTREAM_PASSWORD', apiKey];
	const requests = [];
	const server = createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		const body = JSON.parse(Buffer.concat(chunks).toString());
		const scenario = body.query || new URL(body.url).pathname.slice(1);
		requests.push({ scenario, authorizationPresent: Boolean(request.headers.authorization) });
		if (scenario === 'timeout') return;
		const status = scenario.startsWith('http-') ? Number(scenario.slice(5)) : 200;
		response.writeHead(status, {
			'content-type': 'application/json',
			'x-request-id': 'fault-' + scenario,
			...(status === 302 ? { location: 'https://example.com/never-follow' } : {}),
		});
		if (scenario === 'invalid-json') return response.end('invalid JSON');
		const envelope = {
			code: 0,
			request_id: 'fault-' + scenario,
			data: { results: [{ title: 'Fixture', url: 'https://example.com' }] },
		};
		if (status !== 200 || scenario === 'business')
			Object.assign(envelope, {
				code: -1,
				message: 'api_key=PRIVATE_UPSTREAM_KEY password=PRIVATE_UPSTREAM_PASSWORD',
			});
		if (scenario === 'business')
			envelope.message = 'Your new password is PRIVATE_UPSTREAM_PASSWORD';
		if (scenario === 'invalid-results') envelope.data.results = [{}];
		if (scenario === 'empty-results') envelope.data.results = [];
		if (scenario === 'invalid-content') envelope.data = { url: body.url, title: '', content: null };
		response.end(JSON.stringify(envelope));
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	const extraEnv = {
		NODE_OPTIONS: '--require=' + path.join(root, 'test/e2e/fault-proxy.cjs'),
		ANYSEARCH_E2E_FAULT_PORT: String(server.address().port),
	};
	const tests = [];
	const nodes = [
		{
			id: 'start',
			name: 'Start',
			type: 'n8n-nodes-base.manualTrigger',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		},
	];
	const connections = { Start: { main: [[]] } };
	const cases = [
		...[400, 402, 403, 429, 500, 502, 302].map((status) => 'http-' + status),
		'business',
		'invalid-results',
		'invalid-content',
		'invalid-json',
		'timeout',
		'unreadable',
		'empty-results',
	];
	for (const [index, scenario] of cases.entries()) {
		const errorOutput = scenario === 'http-429';
		nodes.push({
			id: scenario,
			name: scenario,
			type: 'n8n-nodes-anysearch.anySearch',
			typeVersion: 1,
			position: [400, index * 100],
			parameters:
				scenario === 'invalid-content'
					? {
							resource: 'extract',
							operation: 'extract',
							url: 'https://example.com/invalid-content',
						}
					: {
							resource: 'search',
							operation: 'search',
							query: scenario,
							options: { maxResults: 1, simplify: scenario !== 'empty-results' },
						},
			credentials: {
				anySearchApi: {
					id: scenario === 'unreadable' ? 'unreadable' : 'invalid',
					name: scenario === 'unreadable' ? 'unreadable' : 'invalid',
				},
			},
			onError: errorOutput ? 'continueErrorOutput' : 'continueRegularOutput',
		});
		connections.Start.main[0].push({ node: scenario, type: 'main', index: 0 });
	}
	nodes.push({
		id: 'batch-errors',
		name: 'Batch Error Output',
		type: 'n8n-nodes-anysearch.anySearch',
		typeVersion: 1,
		position: [800, 0],
		parameters: {
			resource: 'search',
			operation: 'batchSearch',
			queries: JSON.stringify([{ query: 'empty-results' }, { query: 'http-429' }]),
		},
		credentials: { anySearchApi: { id: 'invalid', name: 'invalid' } },
		onError: 'continueErrorOutput',
	});
	connections.Start.main[0].push({ node: 'Batch Error Output', type: 'main', index: 0 });
	const workflow = {
		id: 'AnySearchFaults01',
		name: 'AnySearch transport faults',
		active: false,
		nodes,
		connections,
		settings: { executionOrder: 'v1' },
	};
	async function executeWorkflow(workflow) {
		const filename = path.join(work, workflow.id + '.json');
		await fs.writeFile(filename, JSON.stringify(workflow));
		await fs.writeFile(path.join(output, workflow.id + '.json'), JSON.stringify(workflow, null, 2));
		const imported = await invoke(['import:workflow', '--input=' + filename]);
		assert.equal(imported.code, 0, 'Fault workflow import failed');
		const execution = await invoke(['execute', '--id=' + workflow.id, '--rawOutput'], extraEnv);
		const data = executionFrom(execution.stdout);
		assert(
			privateValues.every((value) => !JSON.stringify(data).includes(value)),
			'Secret appeared in n8n execution data',
		);
		return data;
	}
	try {
		const data = await executeWorkflow(workflow);
		assert.equal(data.status, 'success');
		for (const scenario of cases) {
			const record = { name: scenario };
			try {
				const run = data.data.resultData.runData[scenario]?.at(-1);
				const channel = scenario === 'http-429' ? 1 : 0;
				const item = run?.data?.main[channel]?.[0];
				if (scenario === 'empty-results') {
					assert.deepEqual(item?.json.results, []);
					assert.equal(item.json.request_id, 'fault-empty-results');
				} else assert(item?.json.error, 'Missing error output');
				if (scenario.startsWith('http-')) {
					assert.equal(item.json.details.http_status, Number(scenario.slice(5)));
					assert.equal(item.json.details.request_id, 'fault-' + scenario);
				}
				if (scenario === 'http-429') assert.equal(run.data.main[0].length, 0);
				if (scenario === 'timeout') assert.match(item.json.error, /timeout|timed out|aborted/i);
				if (scenario === 'unreadable')
					assert(!requests.some((request) => request.scenario === scenario));
				record.passed = true;
				record.error = item.json.error;
			} catch (error) {
				record.passed = false;
				record.failure = redact(error.message);
			}
			tests.push(record);
		}
		const batch = data.data.resultData.runData['Batch Error Output'].at(-1).data.main;
		assert.equal(batch[0].length, 1);
		assert.deepEqual(batch[0][0].json.results, []);
		assert.equal(batch[0][0].json.query_index, 0);
		assert.equal(batch[1].length, 1);
		assert.equal(batch[1][0].json.details.http_status, 429);
		assert.equal(batch[1][0].json.details.query_index, 1);
		tests.push({ name: 'batch-error-output', passed: true });
		const failing = {
			...workflow,
			id: 'AnySearchStops001',
			name: 'AnySearch stop on failure',
			nodes: [
				nodes[0],
				{ ...nodes.find((node) => node.name === 'http-402'), onError: 'stopWorkflow' },
			],
			connections: { Start: { main: [[{ node: 'http-402', type: 'main', index: 0 }]] } },
		};
		const stopped = await executeWorkflow(failing);
		assert.equal(stopped.status, 'error');
		assert.equal(stopped.data.resultData.error.context.http_status, 402);
		assert.equal(stopped.data.resultData.error.context.request_id, 'fault-http-402');
		tests.push({ name: 'stop-on-failure', passed: true });
		assert.equal(requests.filter((request) => request.scenario === 'http-402').length, 2);
		assert.equal(requests.filter((request) => request.scenario === 'http-429').length, 2);
		return { passed: tests.every((test) => test.passed), tests, requests, privacyPassed: true };
	} finally {
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
}
