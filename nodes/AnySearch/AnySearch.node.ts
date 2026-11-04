import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INode,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IDataObject,
	IHttpRequestOptions,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

const API_BASE_URL = 'https://api.anysearch.com';
const CREDENTIAL_NAME = 'anySearchApi';
const REQUEST_TIMEOUT = 60_000;

interface AnySearchEnvelope {
	code: number;
	message?: string;
	request_id?: string;
	data?: IDataObject;
}

type AnySearchRequestContext = IExecuteFunctions | ILoadOptionsFunctions;

function objectValue(value: unknown): IDataObject | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as IDataObject)
		: undefined;
}

function safeRequestId(value: unknown): string | undefined {
	return typeof value === 'string' && /^(?!as_sk_)[a-zA-Z0-9_-]{1,64}$/i.test(value)
		? value
		: undefined;
}

function safeMessage(value: unknown): string {
	if (typeof value !== 'string' || value.trim() === '') return 'AnySearch request failed.';
	if (
		/(?:api[_\s-]?key|password|authorization)["']?\s*[:=]|bearer\s+\S+|as_sk_[a-z\d_-]+/i.test(
			value,
		)
	) {
		return 'AnySearch rejected the request. Sensitive response details were removed.';
	}
	return value.slice(0, 1000);
}

function apiError(
	node: INode,
	message: string,
	requestId?: string,
	httpStatus?: number,
): NodeOperationError | NodeApiError {
	const description = requestId ? `Request ID: ${requestId}` : undefined;
	const error = httpStatus
		? new NodeApiError(node, {}, { message, description, httpCode: String(httpStatus) })
		: new NodeOperationError(node, message, { description });
	if (requestId) error.context.request_id = requestId;
	if (httpStatus) error.context.http_status = httpStatus;
	return error;
}

function httpMessage(status: number): string {
	const messages: Record<number, string> = {
		400: 'AnySearch rejected the parameters. Check the query, URL, and capability definitions.',
		401: 'AnySearch authentication was rejected. Check the selected API key.',
		402: 'AnySearch quota exhausted. Check your account quota or configure an API key at https://www.anysearch.com.',
		403: 'AnySearch access was denied. Check the account status and API key permissions.',
		415: 'AnySearch requires a JSON request body.',
		422: 'AnySearch could not extract this page. Check that the URL contains publicly accessible supported text.',
		429: 'AnySearch rate limit exceeded. Wait before retrying or reduce concurrent requests.',
		502: 'AnySearch is temporarily unavailable. Retry later.',
	};
	return messages[status] ?? `AnySearch returned HTTP ${status}.`;
}

function toUpstreamError(node: INode, error: unknown): NodeOperationError | NodeApiError {
	const details = objectValue(error) ?? {};
	const cause = objectValue(details.cause) ?? {};
	const response = objectValue(details.response) ?? objectValue(cause.response) ?? {};
	const body = objectValue(response.data) ?? objectValue(response.body) ?? {};
	const headers = objectValue(response.headers) ?? {};
	const context = objectValue(details.context) ?? {};
	const requestId = safeRequestId(body.request_id ?? headers['x-request-id'] ?? context.request_id);
	const status = Number(
		details.httpCode ?? details.statusCode ?? response.status ?? response.statusCode,
	);
	if (Number.isInteger(status) && status >= 100 && status <= 599) {
		return apiError(node, httpMessage(status), requestId, status);
	}
	return apiError(node, safeMessage(error instanceof Error ? error.message : undefined), requestId);
}

function errorItem(
	node: INode,
	error: unknown,
	itemIndex: number,
	fields: IDataObject = {},
): INodeExecutionData {
	const failure = toUpstreamError(node, error);
	return {
		json: {
			error: failure.message,
			details: {
				...fields,
				...(failure.context.request_id ? { request_id: failure.context.request_id } : {}),
				...(failure.context.http_status ? { http_status: failure.context.http_status } : {}),
			},
		},
		pairedItem: { item: itemIndex },
	};
}

async function readApiKey(this: AnySearchRequestContext): Promise<string | undefined> {
	if (this.getNode().credentials?.[CREDENTIAL_NAME] === undefined) return undefined;
	const credentials = await this.getCredentials(CREDENTIAL_NAME);
	if (typeof credentials.apiKey !== 'string') {
		throw new NodeOperationError(
			this.getNode(),
			'The selected credential must contain an API Key string.',
		);
	}
	return credentials.apiKey.trim() || undefined;
}

async function anySearchHttpRequest(
	this: AnySearchRequestContext,
	options: IHttpRequestOptions,
): Promise<{ body: unknown; requestId?: string }> {
	const requestOptions: IHttpRequestOptions = {
		...options,
		json: true,
		timeout: REQUEST_TIMEOUT,
		disableFollowRedirect: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		headers: { ...options.headers, 'X-Anysearch-Client': 'n8n-nodes-anysearch' },
	};
	let response: { body: unknown; statusCode: number; headers?: IDataObject };
	try {
		const apiKey = await readApiKey.call(this);
		response =
			apiKey === undefined
				? await this.helpers.httpRequest(requestOptions)
				: await this.helpers.httpRequestWithAuthentication.call(
						this,
						CREDENTIAL_NAME,
						requestOptions,
					);
	} catch (error) {
		throw toUpstreamError(this.getNode(), error);
	}
	const requestId = safeRequestId(
		objectValue(response?.body)?.request_id ?? response?.headers?.['x-request-id'],
	);
	if (!Number.isInteger(response?.statusCode)) {
		throw apiError(this.getNode(), 'AnySearch returned an unexpected HTTP response.', requestId);
	}
	if (response.statusCode < 200 || response.statusCode >= 300) {
		throw apiError(
			this.getNode(),
			httpMessage(response.statusCode),
			requestId,
			response.statusCode,
		);
	}
	return { body: response.body, requestId };
}

async function anySearchRequest(
	this: AnySearchRequestContext,
	options: IHttpRequestOptions,
): Promise<AnySearchEnvelope> {
	const response = await anySearchHttpRequest.call(this, options);
	return validateEnvelope(this.getNode(), response.body, response.requestId);
}

function validateEnvelope(node: INode, response: unknown, requestId?: string): AnySearchEnvelope {
	const value = objectValue(response);
	if (!value)
		throw apiError(
			node,
			'AnySearch returned an unexpected response: expected a JSON object.',
			requestId,
		);
	if (typeof value.code !== 'number' || !Number.isInteger(value.code)) {
		throw apiError(
			node,
			'AnySearch returned an unexpected response: missing or invalid code.',
			requestId,
		);
	}
	if (value.code !== 0) {
		throw apiError(
			node,
			`AnySearch API error ${value.code}. Check the request parameters and account status.`,
			requestId,
		);
	}
	return { ...value, code: value.code, request_id: requestId } as AnySearchEnvelope;
}

function readDataObject(node: INode, envelope: AnySearchEnvelope, operation: string): IDataObject {
	const data = objectValue(envelope.data);
	if (!data)
		throw apiError(
			node,
			`AnySearch ${operation} response is missing the data object.`,
			envelope.request_id,
		);
	return data;
}

function readArrayField(
	node: INode,
	data: IDataObject,
	field: string,
	operation: string,
	requestId?: string,
): IDataObject[] {
	const value = data[field];
	if (!Array.isArray(value) || value.some((entry) => !objectValue(entry))) {
		throw apiError(
			node,
			`AnySearch ${operation} response contains missing or invalid data.${field}.`,
			requestId,
		);
	}
	return value as IDataObject[];
}

function parseJsonObjectParameter(node: INode, value: unknown, fieldName: string): IDataObject {
	let parsed: unknown = value;
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value);
		} catch {
			throw new NodeOperationError(node, `${fieldName} must be valid JSON`);
		}
	}
	const object = objectValue(parsed);
	if (!object) throw new NodeOperationError(node, `${fieldName} must be a JSON object`);
	return object;
}

function toStringArray(node: INode, value: unknown, fieldName: string): string[] {
	const raw = typeof value === 'string' ? value.split(',') : value;
	if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string')) {
		throw new NodeOperationError(node, `${fieldName} must contain strings`);
	}
	const values = [...new Set(raw.map((entry) => entry.trim()).filter(Boolean))];
	if (values.length === 0) throw new NodeOperationError(node, `${fieldName} must not be empty`);
	return values;
}

function searchBody(node: INode, value: unknown): IDataObject {
	const input = objectValue(value);
	if (!input || typeof input.query !== 'string' || input.query.trim() === '') {
		throw new NodeOperationError(node, 'Query must be a non-empty string');
	}
	const allowed = ['query', 'max_results', 'tag', 'zone', 'language', 'format', 'params'];
	if (Object.keys(input).some((key) => !allowed.includes(key))) {
		throw new NodeOperationError(
			node,
			'Search accepts query, max_results, tag, zone, language, format, and params only',
		);
	}
	const body: IDataObject = { query: input.query.trim() };
	if (input.max_results !== undefined) {
		if (
			typeof input.max_results !== 'number' ||
			!Number.isInteger(input.max_results) ||
			input.max_results < 1 ||
			input.max_results > 10
		) {
			throw new NodeOperationError(node, 'Max Results must be an integer from 1 to 10');
		}
		body.max_results = input.max_results;
	}
	for (const key of ['tag', 'zone', 'language', 'format']) {
		const value = input[key];
		if (value === undefined || value === '') continue;
		if (typeof value !== 'string') throw new NodeOperationError(node, `${key} must be a string`);
		if (value.trim()) body[key] = value.trim();
	}
	if (body.zone && !['cn', 'intl'].includes(body.zone as string)) {
		throw new NodeOperationError(node, 'Zone must be cn or intl');
	}
	if (body.format && !['json', 'markdown'].includes(body.format as string)) {
		throw new NodeOperationError(node, 'Response Format must be json or markdown');
	}
	if (body.format === 'json') delete body.format;
	if (input.params !== undefined && input.params !== '') {
		body.params = parseJsonObjectParameter(node, input.params, 'Tag Parameters');
	}
	return body;
}

async function search(this: IExecuteFunctions, body: IDataObject): Promise<IDataObject> {
	const envelope = await anySearchRequest.call(this, {
		method: 'POST',
		url: API_BASE_URL + '/v1/search',
		body,
	});
	const data = readDataObject(this.getNode(), envelope, 'search');
	const results = readArrayField(this.getNode(), data, 'results', 'search', envelope.request_id);
	if (
		results.some(
			(result) =>
				typeof result.title !== 'string' ||
				typeof result.url !== 'string' ||
				['content', 'snippet'].some(
					(field) => result[field] != null && typeof result[field] !== 'string',
				),
		)
	) {
		throw apiError(
			this.getNode(),
			'AnySearch search response contains invalid result fields.',
			envelope.request_id,
		);
	}
	if (data.metadata !== undefined && !objectValue(data.metadata)) {
		throw apiError(
			this.getNode(),
			'AnySearch search response contains invalid metadata.',
			envelope.request_id,
		);
	}
	return { request_id: envelope.request_id, results, metadata: data.metadata ?? {} };
}

async function searchOperation(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const { maxResults, simplify, ...fields } = options;
	const body = searchBody(this.getNode(), {
		query: this.getNodeParameter('query', itemIndex),
		...(maxResults === undefined ? {} : { max_results: maxResults }),
		...fields,
	});
	const data = await search.call(this, body);
	const results = data.results as IDataObject[];
	return (
		simplify === false
			? [data]
			: results.map((result) => ({ ...result, request_id: data.request_id }))
	).map((json) => ({ json, pairedItem: { item: itemIndex } }));
}

async function batchSearchOperation(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	let queries: unknown = this.getNodeParameter('queries', itemIndex);
	if (typeof queries === 'string') {
		try {
			queries = JSON.parse(queries);
		} catch {
			throw new NodeOperationError(this.getNode(), 'Queries must be valid JSON');
		}
	}
	if (!Array.isArray(queries) || queries.length < 1 || queries.length > 5) {
		throw new NodeOperationError(
			this.getNode(),
			'Queries must contain between 1 and 5 search objects',
		);
	}
	return await Promise.all(
		queries.map(async (query: unknown, queryIndex: number) => {
			const identity = { query: objectValue(query)?.query ?? '', query_index: queryIndex };
			try {
				const data = await search.call(this, searchBody(this.getNode(), query));
				return { json: { ...identity, ...data }, pairedItem: { item: itemIndex } };
			} catch (error) {
				return errorItem(this.getNode(), error, itemIndex, identity);
			}
		}),
	);
}

async function extractOperation(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const value = this.getNodeParameter('url', itemIndex);
	let url: URL;
	try {
		url = new URL(typeof value === 'string' ? value.trim() : '');
	} catch {
		throw new NodeOperationError(this.getNode(), 'URL must be an absolute public HTTP(S) URL');
	}
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
		throw new NodeOperationError(
			this.getNode(),
			'URL must use HTTP(S) and must not contain embedded credentials',
		);
	}
	const envelope = await anySearchRequest.call(this, {
		method: 'POST',
		url: API_BASE_URL + '/v1/extract',
		body: { url: (value as string).trim() },
	});
	const data = readDataObject(this.getNode(), envelope, 'extract');
	if (
		typeof data.url !== 'string' ||
		typeof data.title !== 'string' ||
		typeof data.content !== 'string'
	) {
		throw apiError(
			this.getNode(),
			'AnySearch extract response must contain string url, title, and content fields.',
			envelope.request_id,
		);
	}
	return [
		{
			json: {
				url: data.url,
				title: data.title,
				content: data.content,
				...(envelope.request_id ? { request_id: envelope.request_id } : {}),
			},
			pairedItem: { item: itemIndex },
		},
	];
}

async function capabilityOperation(
	this: IExecuteFunctions,
	itemIndex: number,
	operation: string,
): Promise<INodeExecutionData[]> {
	let endpoint = '/v1/domains';
	if (operation === 'getSubDomains') {
		const domains = toStringArray(
			this.getNode(),
			this.getNodeParameter('domains', itemIndex, []),
			'Domain Names or IDs',
		);
		const searchParams = new URLSearchParams();
		for (const domain of domains) searchParams.append('domain', domain);
		endpoint = '/v1/sub-domains?' + searchParams.toString();
	} else if (operation !== 'getDomains') {
		throw new NodeOperationError(this.getNode(), 'Unknown capability operation');
	}
	const envelope = await anySearchRequest.call(this, {
		method: 'GET',
		url: API_BASE_URL + endpoint,
	});
	const data = readDataObject(this.getNode(), envelope, 'capability');
	const domains = readArrayField(
		this.getNode(),
		data,
		'domains',
		'capability',
		envelope.request_id,
	);
	if (
		domains.some(
			(domain) =>
				typeof domain.domain !== 'string' ||
				!domain.domain ||
				(operation === 'getSubDomains' &&
					(!Array.isArray(domain.sub_domains) ||
						domain.sub_domains.some(
							(entry) => typeof objectValue(entry)?.sub_domain !== 'string',
						))),
		)
	) {
		throw apiError(
			this.getNode(),
			'AnySearch capability response contains invalid domain definitions.',
			envelope.request_id,
		);
	}
	return domains.map((domain) => ({
		json: { ...domain, ...(envelope.request_id ? { request_id: envelope.request_id } : {}) },
		pairedItem: { item: itemIndex },
	}));
}

export class AnySearch implements INodeType {
	methods = {
		loadOptions: {
			// Get all capability domains for pickers (does not consume quota).
			async getDomains(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const envelope = await anySearchRequest.call(this, {
					method: 'GET',
					url: `${API_BASE_URL}/v1/domains`,
				});
				const data = readDataObject(this.getNode(), envelope, 'capability');
				const domains = readArrayField(
					this.getNode(),
					data,
					'domains',
					'capability',
					envelope.request_id,
				);
				if (domains.some((domain) => typeof domain.domain !== 'string' || !domain.domain)) {
					throw apiError(
						this.getNode(),
						'AnySearch capability response contains invalid domain names.',
						envelope.request_id,
					);
				}
				return domains.map((domain) => ({
					value: String(domain.domain ?? ''),
					name: `${String(domain.domain ?? '')} — ${String(domain.description ?? '')}`,
				}));
			},
		},
	};

	description: INodeTypeDescription = {
		displayName: 'AnySearch',
		name: 'anySearch',
		icon: { light: 'file:anysearch.svg', dark: 'file:anysearch.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
		description:
			'Search the web with unified or vertical capability tags, and extract clean page content, via AnySearch',
		defaults: {
			name: 'AnySearch',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'anySearchApi',
				required: false,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				required: true,
				options: [
					{
						name: 'Search',
						value: 'search',
						description: 'Run a unified or vertical web search',
					},
					{
						name: 'Extract',
						value: 'extract',
						description: 'Extract clean content from a public URL',
					},
					{
						name: 'Capability',
						value: 'capability',
						description: 'Browse domains and capability tags',
					},
				],
				default: 'search',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['search'],
					},
				},
				options: [
					{
						name: 'Search',
						value: 'search',
						description: 'Run a search query',
						action: 'Search the web',
					},
					{
						name: 'Batch Search',
						value: 'batchSearch',
						description:
							'Run up to five searches in parallel and retain individual results or errors',
						action: 'Run batch searches',
					},
				],
				default: 'search',
			},
			{
				displayName: 'Queries',
				name: 'queries',
				type: 'json',
				required: true,
				default: '[{"query": "n8n workflow automation", "max_results": 3}]',
				displayOptions: { show: { resource: ['search'], operation: ['batchSearch'] } },
				description:
					'JSON array of 1–5 objects with query and optional tag, params, max_results, zone, language, and format. Each query returns a result or an error in input order.',
			},
			{
				displayName: 'Query',
				name: 'query',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						resource: ['search'],
						operation: ['search'],
					},
				},
				default: '',
				placeholder: 'e.g. Go 1.26 release notes',
				description: 'The search query',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: {
					show: {
						resource: ['search'],
						operation: ['search'],
					},
				},
				options: [
					{
						displayName: 'Capability Tag',
						name: 'tag',
						type: 'string',
						default: '',
						placeholder: 'e.g. code.snippet',
						description:
							'Vertical capability tag (domain.sub_domain) to narrow the search. Use the Capability resource to discover tags. Leave empty for unified search.',
					},
					{
						displayName: 'Language',
						name: 'language',
						type: 'string',
						default: '',
						placeholder: 'e.g. zh-CN, en',
						description: 'Preferred result language',
					},
					{
						displayName: 'Max Results',
						name: 'maxResults',
						type: 'number',
						typeOptions: {
							minValue: 1,
							maxValue: 10,
						},
						default: 10,
						description: 'Number of results to return (1-10)',
					},
					{
						displayName: 'Response Format',
						name: 'format',
						type: 'options',
						options: [
							{
								name: 'JSON',
								value: 'json',
							},
							{
								name: 'Markdown',
								value: 'markdown',
							},
						],
						default: 'json',
						description: 'With Markdown, the content field of each result holds rendered Markdown',
					},
					{
						displayName: 'Simplify',
						name: 'simplify',
						type: 'boolean',
						default: true,
						description:
							'Whether to return one item per search result instead of a single item with the full response',
					},
					{
						displayName: 'Tag Parameters',
						name: 'params',
						type: 'json',
						default: '{}',
						placeholder: '{"lang": "go"}',
						description:
							'JSON object with extra parameters for the capability tag (e.g. {"ticker": "AAPL"} for finance.quote)',
					},
					{
						displayName: 'Zone',
						name: 'zone',
						type: 'options',
						options: [
							{
								name: 'Auto',
								value: '',
								description: 'Let AnySearch decide the region',
							},
							{
								name: 'China',
								value: 'cn',
							},
							{
								name: 'International',
								value: 'intl',
							},
						],
						default: '',
						description: 'Region preference for results',
					},
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['extract'],
					},
				},
				options: [
					{
						name: 'Extract Content',
						value: 'extract',
						description: 'Extract clean content from a URL',
						action: 'Extract content from a URL',
					},
				],
				default: 'extract',
			},
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						resource: ['extract'],
						operation: ['extract'],
					},
				},
				default: '',
				placeholder: 'https://example.com/article',
				description: 'Public HTTP(S) URL to extract content from',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['capability'],
					},
				},
				options: [
					{
						name: 'List All Domains',
						value: 'getDomains',
						description: 'List every capability domain with its sub-domain count',
						action: 'List all capability domains',
					},
					{
						name: 'Get Sub-Domains',
						value: 'getSubDomains',
						description: 'List capability tags and parameters for selected domains',
						action: 'Get sub domains for selected domains',
					},
				],
				default: 'getDomains',
			},
			{
				displayName: 'Domain Names or IDs',
				name: 'domains',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getDomains',
				},
				required: true,
				displayOptions: {
					show: {
						resource: ['capability'],
						operation: ['getSubDomains'],
					},
				},
				default: [],
				description:
					'Domains to inspect, e.g. code, finance. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as string;
				const operation = this.getNodeParameter('operation', itemIndex) as string;

				if (resource === 'search' && operation === 'batchSearch') {
					returnData.push(...(await batchSearchOperation.call(this, itemIndex)));
				} else if (resource === 'search' && operation === 'search') {
					returnData.push(...(await searchOperation.call(this, itemIndex)));
				} else if (resource === 'extract' && operation === 'extract') {
					returnData.push(...(await extractOperation.call(this, itemIndex)));
				} else if (resource === 'capability') {
					returnData.push(...(await capabilityOperation.call(this, itemIndex, operation)));
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown resource: ${resource}`, {
						itemIndex,
					});
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push(errorItem(this.getNode(), error, itemIndex));
					continue;
				}
				const failure = toUpstreamError(this.getNode(), error);
				failure.context.itemIndex = itemIndex;
				throw failure;
			}
		}

		return [returnData];
	}
}
