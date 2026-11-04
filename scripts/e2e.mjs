// Runs the built package through an isolated, real n8n CLI installation.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModelServer } from '../test/e2e/model-server.mjs';
import { runFaultWorkflows } from '../test/e2e/fault-workflows.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const n8nRoot = path.resolve(process.env.N8N_E2E_PACKAGE || path.join(root, 'node_modules/n8n'));
const engineRequire = createRequire(path.join(n8nRoot, 'package.json'));
const version = engineRequire('./package.json').version;
const cli = path.join(n8nRoot, 'bin/n8n');
const nodeExecutable = process.env.N8N_E2E_NODE || process.execPath;
const apiKey = (process.env.ANYSEARCH_API_KEY || '').trim();
assert(apiKey, 'Set ANYSEARCH_API_KEY for authenticated live n8n tests');
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'anysearch-n8n-e2e-'));
const output = path.resolve(process.env.N8N_E2E_OUTPUT || path.join(work, 'evidence'));
await fs.mkdir(output, { recursive: true });
const encryptionKey = randomBytes(32).toString('hex');
const env = {
	...process.env,
	PATH: path.dirname(nodeExecutable) + path.delimiter + process.env.PATH,
	N8N_USER_FOLDER: path.join(work, 'instance'),
	N8N_ENCRYPTION_KEY: encryptionKey,
	N8N_DIAGNOSTICS_ENABLED: 'false',
	N8N_VERSION_NOTIFICATIONS_ENABLED: 'false',
	N8N_TEMPLATES_ENABLED: 'false',
	E2E_TESTS: 'true',
	N8N_LOG_LEVEL: 'info',
	N8N_PORT: '5789',
	N8N_RUNNERS_BROKER_PORT: '5790',
};
delete env.ANYSEARCH_API_KEY;
delete env.ANYSEARCH_REVIEW_KEY;
const redact = (value) =>
	String(value)
		.split(apiKey)
		.join('[REDACTED]')
		.split(encryptionKey)
		.join('[REDACTED]')
		.replace(/as_sk_[A-Za-z0-9_-]+/g, '[REDACTED]')
		.replace(/(?:password|api_key)\s*[:=]\s*[^\s,"}]+/gi, '[REDACTED]');
function invoke(args, extraEnv = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(nodeExecutable, [cli, ...args], {
			cwd: work,
			env: { ...env, ...extraEnv },
			windowsHide: true,
		});
		let stdout = '',
			stderr = '';
		child.stdout.on('data', (data) => {
			stdout += data;
		});
		child.stderr.on('data', (data) => {
			stderr += data;
		});
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error('n8n CLI timed out'));
		}, 300000);
		child.on('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve({ code, stdout, stderr });
		});
	});
}
function executionFrom(stdout) {
	for (const match of stdout.matchAll(/^\{/gm)) {
		let depth = 0,
			quoted = false,
			escaped = false;
		for (let index = match.index; index < stdout.length; index++) {
			const character = stdout[index];
			if (quoted) {
				if (escaped) escaped = false;
				else if (character === '\\') escaped = true;
				else if (character === '"') quoted = false;
			} else if (character === '"') quoted = true;
			else if (character === '{') depth++;
			else if (character === '}' && --depth === 0) {
				try {
					const value = JSON.parse(stdout.slice(match.index, index + 1));
					if (value.data?.resultData) return value;
				} catch {}
				break;
			}
		}
	}
	throw new Error('n8n did not return execution JSON');
}
const modelServer = await createModelServer();
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
function add(name, parameters, credential = 'valid', check = () => {}) {
	const node = {
		id: name,
		name,
		type: 'n8n-nodes-anysearch.anySearch',
		typeVersion: 1,
		position: [400, tests.length * 120],
		parameters,
		onError: 'continueRegularOutput',
		...(credential ? { credentials: { anySearchApi: { id: credential, name: credential } } } : {}),
	};
	nodes.push(node);
	connections.Start.main[0].push({ node: name, type: 'main', index: 0 });
	tests.push({ name, parameters, credential, check });
}
function searchCheck(items, max = 2) {
	assert.equal(items.length, 1);
	assert.equal(typeof items[0].json.request_id, 'string');
	assert(Array.isArray(items[0].json.results));
	assert(items[0].json.results.length > 0 && items[0].json.results.length <= max);
}
add(
	'Authenticated Search',
	{
		resource: 'search',
		operation: 'search',
		query: 'What is the capital of France?',
		options: { maxResults: 2, simplify: false },
	},
	'valid',
	searchCheck,
);
add(
	'Anonymous Search',
	{
		resource: 'search',
		operation: 'search',
		query: 'n8n community nodes',
		options: { maxResults: 2, simplify: false },
	},
	null,
	searchCheck,
);
add(
	'Blank Key Search',
	{
		resource: 'search',
		operation: 'search',
		query: 'n8n optional credentials documentation',
		options: { maxResults: 2, simplify: false },
	},
	'blank',
	searchCheck,
);
add(
	'Invalid Key',
	{ resource: 'search', operation: 'search', query: 'n8n', options: { maxResults: 1 } },
	'invalid',
	(items) => {
		assert(items[0].json.error);
		assert.equal(items[0].json.details.http_status, 401);
	},
);
add(
	'Invalid Domain Credentials',
	{ resource: 'capability', operation: 'getDomains' },
	'invalid',
	(items) => {
		assert.equal(items[0].json.details.http_status, 401);
	},
);
add('Domains', { resource: 'capability', operation: 'getDomains' }, 'valid', (items) => {
	assert(items.length > 0);
	assert(items.every((item) => typeof item.json.domain === 'string'));
});
add(
	'Subdomains',
	{
		resource: 'capability',
		operation: 'getSubDomains',
		domains: [
			'academic',
			'agriculture',
			'business',
			'code',
			'energy',
			'environment',
			'film',
			'finance',
			'gaming',
			'general',
			'health',
			'ip',
			'legal',
			'resource',
			'security',
			'social_media',
			'travel',
		],
	},
	'valid',
	(items) => {
		assert.equal(items.length, 17);
		assert(items.every((item) => Array.isArray(item.json.sub_domains)));
	},
);
add(
	'Extract HTML',
	{ resource: 'extract', operation: 'extract', url: 'https://example.com' },
	'valid',
	(items) => {
		assert.match(items[0].json.content ?? '', /example|documentation/i);
		assert(items[0].json.request_id);
	},
);
add(
	'Invalid URL',
	{ resource: 'extract', operation: 'extract', url: 'https://user:password@example.com' },
	'valid',
	(items) => {
		assert.match(items[0].json.error, /embedded credentials/);
	},
);
add(
	'Batch Search',
	{
		resource: 'search',
		operation: 'batchSearch',
		queries: JSON.stringify([
			{
				query: 'React useEffect cleanup',
				tag: 'code.doc',
				params: { library: 'react' },
				max_results: 1,
			},
			{ query: '' },
			{
				query: 'Apple stock price',
				tag: 'finance.quote',
				params: { type: 'stock', symbol: 'AAPL' },
				max_results: 1,
			},
		]),
	},
	'valid',
	(items) => {
		assert.equal(items.length, 3);
		assert(items[0].json.results?.length);
		assert(items[1].json.error);
		assert(items[2].json.results?.length);
		assert.deepEqual(
			items.map((item) => item.json.query_index ?? item.json.details.query_index),
			[0, 1, 2],
		);
	},
);
for (const [name, url, pattern] of [
	['Extract Text', 'https://www.rfc-editor.org/rfc/rfc8259.txt', /JavaScript Object Notation/i],
	['Extract JSON', 'https://raw.githubusercontent.com/n8n-io/n8n/master/package.json', /n8n/],
	[
		'Extract Markdown',
		'https://raw.githubusercontent.com/anysearch-ai/anysearch-skill/main/README.md',
		/AnySearch/,
	],
])
	add(name, { resource: 'extract', operation: 'extract', url }, 'valid', (items) => {
		assert.match(items[0].json.content ?? '', pattern);
		assert(items[0].json.request_id);
	});
for (const [format, url] of [
	['HTML', 'https://www.rfc-editor.org/rfc/rfc9110.html'],
	['Text', 'https://www.rfc-editor.org/rfc/rfc9110.txt'],
	[
		'JSON',
		'https://raw.githubusercontent.com/microsoft/TypeScript/v5.9.3/src/compiler/diagnosticMessages.json',
	],
	[
		'Markdown',
		'https://raw.githubusercontent.com/EbookFoundation/free-programming-books/main/books/free-programming-books-langs.md',
	],
])
	add('Long ' + format, { resource: 'extract', operation: 'extract', url }, 'valid', (items) => {
		assert.equal(Array.from(items[0].json.content ?? '').length, 50000);
		assert(items[0].json.request_id);
	});
add(
	'Unsupported Extract',
	{
		resource: 'extract',
		operation: 'extract',
		url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
	},
	'valid',
	(items) => {
		assert(items[0].json.error);
		assert([400, 422].includes(items[0].json.details.http_status));
	},
);
add(
	'Search Feedback',
	{
		resource: 'feedback',
		operation: 'score',
		feedbacks: `={{ [{ request_id: $json.request_id, score: $json.results.some(r => /Paris/i.test((r.title || '') + ' ' + (r.snippet || '') + ' ' + (r.content || ''))) ? 5 : 1 }] }}`,
	},
	'valid',
	(items) => {
		assert(items[0].json.acknowledgement);
		assert(!items[0].json.error);
	},
);
connections.Start.main[0].pop();
connections['Authenticated Search'] = {
	main: [[{ node: 'Search Feedback', type: 'main', index: 0 }]],
};
if (process.env.ANYSEARCH_E2E_CASES) {
	const cases = JSON.parse(await fs.readFile(process.env.ANYSEARCH_E2E_CASES, 'utf8'));
	for (const entry of cases)
		if (entry.tag === 'travel.flight')
			entry.params.date = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
	for (let index = 0; index < cases.length; index += 5) {
		const group = cases.slice(index, index + 5);
		add(
			'Catalog ' + (index / 5 + 1),
			{ resource: 'search', operation: 'batchSearch', queries: JSON.stringify(group) },
			'valid',
			(items) => {
				assert.equal(items.length, group.length);
				for (let item = 0; item < items.length; item++) {
					assert(!items[item].json.error, group[item].tag + ': ' + items[item].json.error);
					assert(Array.isArray(items[item].json.results));
				}
			},
		);
	}
}
nodes.push(
	{
		id: 'agent',
		name: 'AI Agent',
		type: '@n8n/n8n-nodes-langchain.agent',
		typeVersion: 3.1,
		position: [1000, 0],
		parameters: {
			promptType: 'define',
			text: 'Find the capital of France using the search tool.',
			options: { maxIterations: 3 },
		},
		onError: 'continueRegularOutput',
	},
	{
		id: 'model',
		name: 'Local Test Model',
		type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
		typeVersion: 1.2,
		position: [1000, 200],
		parameters: {
			model: { __rl: true, mode: 'id', value: 'e2e-model' },
			options: { baseURL: modelServer.url, maxRetries: 0, timeout: 30000 },
		},
		credentials: { openAiApi: { id: 'local-model', name: 'local-model' } },
	},
	{
		id: 'tool',
		name: 'Search Tool',
		type: 'n8n-nodes-anysearch.anySearchTool',
		typeVersion: 1,
		position: [1200, 200],
		parameters: {
			resource: 'search',
			operation: 'search',
			query: "={{ $fromAI('query', 'Search query', 'string') }}",
			options: { maxResults: 1, simplify: false },
		},
		credentials: { anySearchApi: { id: 'valid', name: 'valid' } },
	},
	{
		id: 'input-queries',
		name: 'Input Queries',
		type: 'n8n-nodes-base.set',
		typeVersion: 3.4,
		position: [1500, 0],
		parameters: {
			mode: 'raw',
			jsonOutput: JSON.stringify({
				queries: [{ query: 'n8n workflow documentation' }, { query: 'TypeScript documentation' }],
			}),
			options: {},
		},
	},
	{
		id: 'split-inputs',
		name: 'Split Inputs',
		type: 'n8n-nodes-base.splitOut',
		typeVersion: 1,
		position: [1700, 0],
		parameters: { fieldToSplitOut: 'queries', options: { destinationFieldName: 'entry' } },
	},
	{
		id: 'item-search',
		name: 'Item Search',
		type: 'n8n-nodes-anysearch.anySearch',
		typeVersion: 1,
		position: [1900, 0],
		parameters: {
			resource: 'search',
			operation: 'search',
			query: '={{ $json.entry.query }}',
			options: { maxResults: 1 },
		},
		credentials: { anySearchApi: { id: 'valid', name: 'valid' } },
	},
	{
		id: 'linked-results',
		name: 'Linked Results',
		type: 'n8n-nodes-base.set',
		typeVersion: 3.4,
		position: [2100, 0],
		parameters: {
			assignments: {
				assignments: [
					{
						id: 'source-query',
						name: 'sourceQuery',
						value: '={{ $("Split Inputs").item.json.entry.query }}',
						type: 'string',
					},
				],
			},
			includeOtherFields: true,
			options: {},
		},
	},
);
connections.Start.main[0].push(
	{ node: 'AI Agent', type: 'main', index: 0 },
	{ node: 'Input Queries', type: 'main', index: 0 },
);
connections['Local Test Model'] = {
	ai_languageModel: [[{ node: 'AI Agent', type: 'ai_languageModel', index: 0 }]],
};
connections['Search Tool'] = { ai_tool: [[{ node: 'AI Agent', type: 'ai_tool', index: 0 }]] };
connections['Input Queries'] = { main: [[{ node: 'Split Inputs', type: 'main', index: 0 }]] };
connections['Split Inputs'] = { main: [[{ node: 'Item Search', type: 'main', index: 0 }]] };
connections['Item Search'] = { main: [[{ node: 'Linked Results', type: 'main', index: 0 }]] };
tests.push({
	name: 'AI Agent',
	check: (items) => {
		assert.match(items[0].json.output ?? '', /Paris/i);
		assert(modelServer.state.toolResultSeen);
	},
});
tests.push({
	name: 'Linked Results',
	check: (items) => {
		assert.deepEqual(
			items.map((item) => item.json.sourceQuery),
			['n8n workflow documentation', 'TypeScript documentation'],
		);
		assert(items.every((item) => item.json.request_id));
	},
});

const summary = {
	startedAt: new Date().toISOString(),
	n8n: version,
	nodeRuntime: execFileSync(nodeExecutable, ['--version'], { encoding: 'utf8' }).trim(),
	nodeBuildSha256: createHash('sha256')
		.update(await fs.readFile(path.join(root, 'dist/nodes/AnySearch/AnySearch.node.js')))
		.digest('hex'),
	tests: [],
	requests: [],
};
try {
	const modules = path.join(env.N8N_USER_FOLDER, '.n8n/nodes/node_modules');
	const installed = path.join(modules, 'n8n-nodes-anysearch');
	await fs.mkdir(installed, { recursive: true });
	await fs.cp(path.join(root, 'dist'), path.join(installed, 'dist'), { recursive: true });
	await fs.copyFile(path.join(root, 'package.json'), path.join(installed, 'package.json'));
	await fs.symlink(
		path.dirname(engineRequire.resolve('n8n-workflow/package.json')),
		path.join(modules, 'n8n-workflow'),
		'junction',
	);
	const coreRoot = path.dirname(engineRequire.resolve('n8n-core/package.json'));
	const { CipherAes256CBC } = engineRequire(path.join(coreRoot, 'dist/encryption/aes-256-cbc.js'));
	const cipher = new CipherAes256CBC();
	const credentialFile = path.join(work, 'credential-import.json');
	await fs.writeFile(
		credentialFile,
		JSON.stringify(
			[
				['valid', apiKey],
				['blank', ''],
				['invalid', 'synthetic_invalid_key'],
			]
				.map(([id, key]) => ({
					id,
					name: id,
					type: 'anySearchApi',
					data: cipher.encrypt(JSON.stringify({ apiKey: key }), encryptionKey),
				}))
				.concat([
					{
						id: 'unreadable',
						name: 'unreadable',
						type: 'anySearchApi',
						data: cipher.encrypt(
							JSON.stringify({ apiKey: 'fixture' }),
							randomBytes(32).toString('hex'),
						),
					},
					{
						id: 'local-model',
						name: 'local-model',
						type: 'openAiApi',
						data: cipher.encrypt(
							JSON.stringify({ apiKey: 'synthetic-local-model', url: modelServer.url }),
							encryptionKey,
						),
					},
				]),
		),
		{ mode: 0o600 },
	);
	const credentialImport = await invoke(['import:credentials', '--input=' + credentialFile]);
	await fs.rm(credentialFile);
	await fs.writeFile(
		path.join(output, 'credential-import.log'),
		redact(credentialImport.stdout + credentialImport.stderr),
	);
	assert.equal(credentialImport.code, 0, credentialImport.stderr + credentialImport.stdout);
	const workflow = {
		id: 'AnySearchE2E0001',
		name: 'AnySearch end-to-end',
		active: false,
		nodes,
		connections,
		settings: { executionOrder: 'v1' },
	};
	const workflowFile = path.join(work, 'workflow.json');
	await fs.writeFile(workflowFile, JSON.stringify(workflow));
	await fs.writeFile(path.join(output, 'workflow.json'), JSON.stringify(workflow, null, 2));
	const imported = await invoke(['import:workflow', '--input=' + workflowFile]);
	await fs.writeFile(
		path.join(output, 'workflow-import.log'),
		redact(imported.stdout + imported.stderr),
	);
	assert.equal(imported.code, 0, imported.stderr + imported.stdout);
	const traceFile = path.join(output, 'requests.jsonl');
	await fs.writeFile(traceFile, '');
	const execution = await invoke(['execute', '--id=' + workflow.id, '--rawOutput'], {
		NODE_OPTIONS: '--require=' + path.join(root, 'test/e2e/http-trace.cjs'),
		ANYSEARCH_E2E_TRACE: traceFile,
	});
	let data;
	try {
		data = executionFrom(execution.stdout);
	} catch (error) {
		throw new Error(
			error.message + ' (exit ' + execution.code + '): ' + redact(execution.stderr).slice(-2000),
		);
	}
	if (data.data.resultData.error) {
		const error = data.data.resultData.error;
		summary.engineError = {
			name: error.name,
			message: redact(error.message),
			node: error.node?.name,
		};
	}
	assert.equal(data.status, 'success', 'n8n workflow did not succeed');
	assert.equal(data.finished, true);
	assert(!JSON.stringify(data).includes(apiKey), 'API key leaked into n8n execution data');
	const runData = data.data.resultData.runData;
	for (const test of tests) {
		const record = { name: test.name };
		try {
			const runs = runData[test.name];
			assert(Array.isArray(runs), 'Node was not executed');
			const items = runs.at(-1).data.main[0];
			record.itemCount = items.length;
			record.results = items.map((item) => ({
				request_id: item.json.request_id ?? item.json.details?.request_id,
				query_index: item.json.query_index ?? item.json.details?.query_index,
				resultCount: item.json.results?.length,
				contentLength: item.json.content?.length,
				error: item.json.error,
				http_status: item.json.details?.http_status,
				resultHosts: [
					...new Set(
						(item.json.results ?? []).map((result) => {
							try {
								return new URL(result.url).hostname;
							} catch {
								return 'non-http';
							}
						}),
					),
				],
			}));
			test.check(items);
			record.passed = true;
		} catch (error) {
			record.passed = false;
			record.failure = redact(error.message);
		}
		summary.tests.push(record);
		console.log(JSON.stringify(record));
	}
	summary.requests = (await fs.readFile(traceFile, 'utf8'))
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line));
	assert(summary.requests.length > 0, 'No real AnySearch HTTP requests observed');
	assert(
		summary.requests.every((request) => !request.emptyBearer),
		'Empty Bearer header observed',
	);
	for (const query of ['n8n community nodes', 'n8n optional credentials documentation']) {
		const requests = summary.requests.filter((request) => request.body?.query === query);
		assert.equal(requests.length, 1);
		assert.equal(requests[0].authorizationPresent, false, 'Anonymous request sent Authorization');
	}
	const invalid = summary.requests.filter((request) => request.body?.query === 'n8n');
	assert.equal(invalid.length, 1);
	assert.equal(invalid[0].fixtureBearer, true);
	const events = summary.requests
		.flatMap((request) => [
			[request.startedAt, 1],
			[request.finishedAt, -1],
		])
		.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	let active = 0;
	summary.maximumConcurrentRequests = 0;
	for (const [, delta] of events) {
		active += delta;
		summary.maximumConcurrentRequests = Math.max(summary.maximumConcurrentRequests, active);
	}
	assert(summary.maximumConcurrentRequests >= 2 && summary.maximumConcurrentRequests <= 5);
	summary.faults = await runFaultWorkflows({
		invoke,
		executionFrom,
		root,
		work,
		output,
		redact,
		apiKey,
	});
	summary.passed = summary.tests.every((test) => test.passed) && summary.faults.passed;
} catch (error) {
	summary.passed = false;
	summary.failure = redact(error.message);
	console.error(summary.failure);
} finally {
	await modelServer.close();
	summary.localModel = modelServer.state;
	summary.finishedAt = new Date().toISOString();
	await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
	await fs.rm(path.join(work, 'instance'), { recursive: true, force: true });
	console.log('Evidence: ' + output);
	process.exitCode = summary.passed ? 0 : 1;
}
