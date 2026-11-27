// Runs the built package through an isolated, real n8n CLI installation.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModelServer } from '../test/e2e/model-server.mjs';
import { runFaultWorkflows } from '../test/e2e/fault-workflows.mjs';
import {
	addCapabilityChecks,
	catalogRequestReport,
	checkCapabilityRequests,
	checkCatalogRequests,
} from '../test/e2e/capability-checks.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageRoot = path.resolve(process.env.ANYSEARCH_E2E_PACKAGE || root);
const n8nRoot = path.resolve(process.env.N8N_E2E_PACKAGE || path.join(root, 'node_modules/n8n'));
const engineRequire = createRequire(path.join(n8nRoot, 'package.json'));
const version = engineRequire('./package.json').version;
const cli = path.join(n8nRoot, 'bin/n8n');
const nodeExecutable = process.env.N8N_E2E_NODE || process.execPath;
const capabilityOnly = process.argv.includes('--capabilities');
const singleCatalog = process.argv.includes('--single-catalog');
const faultsOnly = process.argv.includes('--faults');
assert(!(faultsOnly && (capabilityOnly || singleCatalog)), '--faults runs independently');
const apiKey = faultsOnly ? '' : (process.env.ANYSEARCH_API_KEY || '').trim();
assert(
	apiKey || capabilityOnly || faultsOnly,
	'Set ANYSEARCH_API_KEY for authenticated live n8n tests',
);
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
	(apiKey ? String(value).split(apiKey).join('[REDACTED]') : String(value))
		.split(encryptionKey)
		.join('[REDACTED]')
		.replace(/as_sk_[A-Za-z0-9_-]+/g, '[REDACTED]')
		.replace(/(?:password|api_key)\s*[:=]\s*[^\s,"}]+/gi, '[REDACTED]');
function invoke(args, extraEnv = {}, timeoutMs = 300000) {
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
		}, timeoutMs);
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
const modelServer = capabilityOnly || faultsOnly ? undefined : await createModelServer();
const catalogRecords = [];
const catalogFile =
	process.env.ANYSEARCH_E2E_CASES ||
	(singleCatalog ? path.join(root, 'test/e2e/search-cases.json') : undefined);
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
function add(name, parameters, credential, check) {
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
	tests.push({
		name,
		check(items) {
			check(items);
			for (const { json } of items) {
				if (parameters.resource === 'extract' && !json.error)
					assert.equal(json.url, parameters.url);
				if (Array.isArray(json.results) && json.metadata?.total_results !== undefined)
					assert.equal(
						json.metadata.total_results,
						json.results.length,
						'metadata.total_results differs from the returned count',
					);
			}
		},
	});
}
function addStandardTests() {
	function searchCheck(items) {
		assert.equal(items.length, 1);
		assert.equal(typeof items[0].json.request_id, 'string');
		assert(Array.isArray(items[0].json.results));
		assert(items[0].json.results.length > 0 && items[0].json.results.length <= 2);
	}
	function anonymousCheck(items) {
		if (items[0]?.json.details?.http_status !== 402) return searchCheck(items);
		assert.equal(items.length, 1);
		assert(items[0].json.details.request_id);
		assert.match(items[0].json.error, /quota/i);
		assert.doesNotMatch(JSON.stringify(items), /as_sk_|api_key=|password=/i);
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
		anonymousCheck,
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
		anonymousCheck,
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
		{ resource: 'extract', operation: 'extract', url: 'example.com' },
		'valid',
		(items) => {
			assert.match(items[0].json.error, /absolute public HTTP\(S\) URL/i);
			assert.deepEqual(items[0].json.details, {});
		},
	);
	add(
		'URL with embedded credentials',
		{ resource: 'extract', operation: 'extract', url: 'https://user:password@example.com' },
		'valid',
		(items) => {
			assert.match(items[0].json.error, /embedded credentials/);
			assert.deepEqual(items[0].json.details, {});
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
			assert.match(items[1].json.error, /query.+(?:required|non-empty)/i);
			assert.deepEqual(items[1].json.details, { query: '', query_index: 1 });
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
			const content = items[0].json.content ?? '';
			const size = Array.from(content).length;
			if (format === 'HTML') {
				assert(size > 0 && size <= 50000);
				assert.match(content, /\.\.\.\(content truncated\)\s*$/);
			} else {
				assert.equal(size, 50000);
			}
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
}

async function addCatalogTests(credential) {
	const { tags } = JSON.parse(
		await fs.readFile(path.join(root, 'nodes/AnySearch/catalog.json'), 'utf8'),
	);
	const reviewedDomains = [...new Set(Object.keys(tags).map((tag) => tag.split('.')[0]))];
	add('Domains', { resource: 'capability', operation: 'getDomains' }, credential, (items) => {
		assert(items.length > 0);
		assert(items.every((item) => typeof item.json.domain === 'string'));
	});
	add(
		'Subdomains',
		{
			resource: 'capability',
			operation: 'getSubDomains',
			domains: reviewedDomains,
		},
		credential,
		(items) => {
			assert.equal(items.length, reviewedDomains.length);
			assert(items.every((item) => Array.isArray(item.json.sub_domains)));
		},
	);
	if (catalogFile) {
		const cases = JSON.parse(await fs.readFile(catalogFile, 'utf8'));
		const dateAfter = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
		for (const entry of cases) {
			if (entry.tag === 'travel.flight') {
				entry.params.date = dateAfter(30);
				if (entry.params.return_date) entry.params.return_date = dateAfter(37);
			}
		}
		const groupSize = singleCatalog ? 1 : 5;
		for (let index = 0; index < cases.length; index += groupSize) {
			const group = cases.slice(index, index + groupSize);
			const records = group.map(({ expectedParams, ...input }) => ({ input, expectedParams }));
			catalogRecords.push(...records);
			const { query, max_results, ...options } = records[0].input;
			add(
				'Catalog ' + (index / groupSize + 1),
				singleCatalog
					? {
							resource: 'search',
							operation: 'search',
							query,
							options: {
								...options,
								params: JSON.stringify(options.params),
								maxResults: max_results,
								simplify: false,
							},
						}
					: {
							resource: 'search',
							operation: 'batchSearch',
							queries: JSON.stringify(records.map((record) => record.input)),
						},
				credential,
				(items) => {
					assert.equal(items.length, group.length);
					for (const [i, row] of records.entries()) {
						row.output = items[i].json;
						if (!singleCatalog)
							assert.equal(row.output.query_index ?? row.output.details?.query_index, i);
					}
				},
			);
		}
	}
}

if (!faultsOnly) {
	if (!capabilityOnly) addStandardTests();
	if (!capabilityOnly || catalogFile) await addCatalogTests(apiKey ? 'valid' : null);
	addCapabilityChecks(add, apiKey ? 'valid' : null);
}
async function importCredentials() {
	const coreRoot = path.dirname(engineRequire.resolve('n8n-core/package.json'));
	const cipherPath = path.join(coreRoot, 'dist/encryption/aes-256-cbc.js');
	const cipher = existsSync(cipherPath)
		? new (engineRequire(cipherPath).CipherAes256CBC)()
		: new (engineRequire(path.join(coreRoot, 'dist/encryption/cipher.js')).Cipher)({
				encryptionKey,
			});
	function credential(id, type, data, key = encryptionKey) {
		return { id, name: id, type, data: cipher.encrypt(JSON.stringify(data), key) };
	}
	const credentials = apiKey ? [credential('valid', 'anySearchApi', { apiKey })] : [];
	if (!capabilityOnly) {
		credentials.push(
			credential('invalid', 'anySearchApi', { apiKey: 'synthetic_invalid_key' }),
			credential(
				'unreadable',
				'anySearchApi',
				{ apiKey: 'fixture' },
				randomBytes(32).toString('hex'),
			),
		);
	}
	if (modelServer) {
		credentials.push(
			credential('blank', 'anySearchApi', { apiKey: '' }),
			credential('local-model', 'openAiApi', {
				apiKey: 'synthetic-local-model',
				url: modelServer.url,
			}),
		);
	}
	const filename = path.join(work, 'credential-import.json');
	await fs.writeFile(filename, JSON.stringify(credentials), { mode: 0o600 });
	try {
		const result = await invoke(['import:credentials', '--input=' + filename]);
		const log = redact(result.stdout + result.stderr);
		await fs.writeFile(path.join(output, 'credential-import.log'), log);
		assert.equal(result.code, 0, log);
	} finally {
		await fs.rm(filename);
	}
}

const summary = {
	startedAt: new Date().toISOString(),
	n8n: version,
	packageVersion: JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'))
		.version,
	nodeRuntime: execFileSync(nodeExecutable, ['--version'], { encoding: 'utf8' }).trim(),
	nodeBuildSha256: createHash('sha256')
		.update(await fs.readFile(path.join(packageRoot, 'dist/nodes/AnySearch/AnySearch.node.js')))
		.digest('hex'),
	capabilityBuildSha256: createHash('sha256')
		.update(
			await fs.readFile(path.join(packageRoot, 'dist/nodes/AnySearch/capabilityParameters.js')),
		)
		.digest('hex'),
	tests: [],
	requests: [],
};
async function runLiveWorkflows() {
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
	const execution = await invoke(
		['execute', '--id=' + workflow.id, '--rawOutput'],
		{
			NODE_OPTIONS: '--require=' + path.join(root, 'test/e2e/http-trace.cjs'),
			ANYSEARCH_E2E_TRACE: traceFile,
		},
		300000 + (singleCatalog ? catalogRecords.length * 60000 : 0),
	);
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
	assert(
		!apiKey || !JSON.stringify(data).includes(apiKey),
		'API key leaked into n8n execution data',
	);
	summary.workflowId = workflow.id;
	summary.executionStatus = data.status;
	const runData = data.data.resultData.runData;
	function verify(name, check) {
		const record = { name, passed: true };
		try {
			check(record);
		} catch (error) {
			record.passed = false;
			record.failure = redact(error.message);
		}
		summary.tests.push(record);
		console.log(JSON.stringify(record));
	}
	for (const test of tests) {
		verify(test.name, (record) => {
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
				code: item.json.details?.code,
				error_code: item.json.details?.error_code,
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
		});
	}
	summary.requests = (await fs.readFile(traceFile, 'utf8'))
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line));
	assert(summary.requests.length > 0, 'No real AnySearch HTTP requests observed');
	assert(
		summary.requests.every(
			(request) =>
				/^\/v1\/(search|extract|domains|sub-domains)(?:\?|$)/.test(request.path) &&
				request.body?.jsonrpc === undefined,
		),
		'AnySearch operations must use the REST API',
	);
	assert(
		summary.requests.every((request) => !request.emptyBearer),
		'Empty Bearer header observed',
	);
	verify('REST error diagnostics', () => {
		const requests = new Map(summary.requests.map((request) => [request.request_id, request]));
		for (const { results = [] } of summary.tests) {
			for (const { request_id, http_status, code, error_code } of results) {
				if (!request_id || http_status === undefined) continue;
				const wire = requests.get(request_id);
				assert.equal(http_status, wire?.status, 'Wire and node HTTP statuses differ');
				assert.equal(
					code,
					http_status === 402 ? undefined : wire.code,
					'Wire and node codes differ',
				);
				assert.equal(
					error_code,
					http_status === 402 ? undefined : wire.error_code,
					'Wire and node error codes differ',
				);
			}
		}
	});

	verify('Capability HTTP requests', () =>
		checkCapabilityRequests(summary.requests, summary.tests),
	);
	if (catalogFile)
		verify('Catalog requests and returned results', () => {
			const domains = runData.Subdomains.at(-1).data.main[0].map((item) => item.json);
			summary.catalogCoverage = catalogRequestReport(catalogRecords, summary.requests, domains);
			checkCatalogRequests(summary.catalogCoverage);
			if (path.resolve(catalogFile) === path.join(root, 'test/e2e/search-cases.json')) {
				const listed = runData.Domains.at(-1).data.main[0].map((item) => item.json.domain);
				assert.deepEqual(domains.map((item) => item.domain).sort(), listed.sort());
				assert.deepEqual(
					summary.catalogCoverage.unexpected,
					[],
					'Non-catalog parameters in the matrix',
				);
				assert.deepEqual(
					summary.catalogCoverage.missing,
					[],
					'Live catalog fields missing from the matrix',
				);
			}
		});
	if (!capabilityOnly) {
		assert(
			!summary.requests.some(
				({ body }) =>
					body?.query === '' ||
					body?.url === 'example.com' ||
					body?.url === 'https://user:password@example.com',
			),
			'Locally invalid query or URL reached AnySearch',
		);
		const authenticatedId = summary.tests.find((test) => test.name === 'Authenticated Search')
			?.results?.[0]?.request_id;
		const authenticated = summary.requests.find(
			(request) => request.request_id === authenticatedId,
		);
		assert.equal(
			authenticated?.authorizationPresent,
			true,
			'Missing Bearer header on authenticated search',
		);
		assert.equal(authenticated.status, 200);
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
	}
}
try {
	const modules = path.join(env.N8N_USER_FOLDER, '.n8n/nodes/node_modules');
	const installed = path.join(modules, 'n8n-nodes-anysearch');
	await fs.mkdir(installed, { recursive: true });
	await fs.cp(path.join(packageRoot, 'dist'), path.join(installed, 'dist'), { recursive: true });
	await fs.copyFile(path.join(packageRoot, 'package.json'), path.join(installed, 'package.json'));
	await fs.symlink(
		path.dirname(engineRequire.resolve('n8n-workflow/package.json')),
		path.join(modules, 'n8n-workflow'),
		'junction',
	);
	if (apiKey || faultsOnly) await importCredentials();
	if (!faultsOnly) await runLiveWorkflows();
	if (!capabilityOnly) {
		summary.faults = await runFaultWorkflows({
			invoke,
			executionFrom,
			root,
			work,
			output,
			redact,
			apiKey,
		});
	}
	summary.passed =
		summary.tests.every((test) => test.passed) && (capabilityOnly || summary.faults.passed);
} catch (error) {
	summary.passed = false;
	summary.failure = redact(error.message);
	console.error(summary.failure);
} finally {
	await modelServer?.close();
	summary.localModel = modelServer?.state;
	summary.finishedAt = new Date().toISOString();
	await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
	await fs.rm(path.join(work, 'instance'), { recursive: true, force: true });
	console.log('Evidence: ' + output);
	process.exitCode = summary.passed ? 0 : 1;
}
