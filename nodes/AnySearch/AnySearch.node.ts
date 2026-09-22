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
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

const API_BASE_URL = 'https://api.anysearch.com';

interface AnySearchEnvelope {
	code?: number;
	message?: string;
	request_id?: string;
	data?: {
		results?: IDataObject[];
		metadata?: IDataObject;
		domains?: IDataObject[];
		url?: string;
		title?: string;
		content?: string;
	};
}

type AnySearchRequestContext = IExecuteFunctions | ILoadOptionsFunctions;

/**
 * Detect whether the optional AnySearch credential is configured on the node.
 * Lives in its own function so anySearchRequest can pick the matching helper.
 */
async function hasAnySearchCredential(this: AnySearchRequestContext): Promise<boolean> {
	try {
		await this.getCredentials('anySearchApi');
		return true;
	} catch {
		return false;
	}
}

/**
 * Send one request to the AnySearch API using the node credential when it is
 * configured, and anonymous access otherwise.
 */
async function anySearchRequest(
	this: AnySearchRequestContext,
	options: IHttpRequestOptions,
): Promise<AnySearchEnvelope> {
	const requestOptions: IHttpRequestOptions = {
		json: true,
		...options,
	};

	let response: AnySearchEnvelope;
	try {
		response = (await hasAnySearchCredential.call(this))
			? await this.helpers.httpRequestWithAuthentication.call(this, 'anySearchApi', requestOptions)
			: await this.helpers.httpRequest(requestOptions);
	} catch (error) {
		throw toUpstreamError(this.getNode(), error);
	}

	if (typeof response.code === 'number' && response.code !== 0) {
		const detail =
			response.message && response.message.trim().length > 0
				? response.message
				: `AnySearch API error ${response.code}`;
		throw new NodeOperationError(this.getNode(), detail);
	}
	return response;
}

/**
 * Normalize upstream failures. Anonymous quota responses (HTTP 402) can embed
 * auto-generated credentials in the message body; per AnySearch guidance those
 * must not be propagated into workflow execution logs.
 */
function toUpstreamError(node: INode, error: unknown): NodeOperationError {
	const message = error instanceof Error ? error.message : String(error);
	const description = (error as { description?: unknown }).description;
	const combined = `${message} ${typeof description === 'string' ? description : ''}`;
	const httpCode = Number(
		(error as { httpCode?: unknown }).httpCode ?? (error as { statusCode?: unknown }).statusCode,
	);
	if (httpCode === 402 || /api_key|password/i.test(combined)) {
		return new NodeOperationError(
			node,
			'AnySearch quota exhausted. Register an API key at https://www.anysearch.com (or POST /v1/auth/email/register), set it in the AnySearch API credential, then retry.',
		);
	}
	return new NodeOperationError(node, message);
}

function parseJsonObjectParameter(
	node: INode,
	value: unknown,
	fieldName: string,
): IDataObject {
	let parsed: unknown = value;
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed === '') {
			throw new NodeOperationError(node, `${fieldName} must be a JSON object`);
		}
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			throw new NodeOperationError(node, `${fieldName} must be valid JSON`);
		}
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new NodeOperationError(node, `${fieldName} must be a JSON object`);
	}
	return parsed as IDataObject;
}

function toStringArray(node: INode, value: unknown, fieldName: string): string[] {
	const raw = typeof value === 'string' ? value.split(',') : Array.isArray(value) ? value : [value];
	const values = raw.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
	if (values.length === 0) {
		throw new NodeOperationError(node, `${fieldName} must not be empty`);
	}
	return values;
}

async function searchOperation(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const query = (this.getNodeParameter('query', itemIndex) as string).trim();
	if (query === '') {
		throw new NodeOperationError(this.getNode(), 'Query must not be empty');
	}

	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const body: IDataObject = { query };
	if (options.maxResults !== undefined && options.maxResults !== null) {
		body.max_results = options.maxResults;
	}
	const tag = options.tag as string | undefined;
	if (tag && tag.trim() !== '') {
		body.tag = tag.trim();
	}
	const zone = options.zone as string | undefined;
	if (zone) {
		body.zone = zone;
	}
	const language = options.language as string | undefined;
	if (language && language.trim() !== '') {
		body.language = language.trim();
	}
	const format = options.format as string | undefined;
	if (format && format !== 'json') {
		body.format = format;
	}
	if (options.params !== undefined && options.params !== '') {
		body.params = parseJsonObjectParameter(
			this.getNode(),
			options.params,
			'Options > Tag Parameters',
		);
	}

	const envelope = await anySearchRequest.call(this, {
		method: 'POST',
		url: `${API_BASE_URL}/v1/search`,
		body,
	});

	const data = envelope.data ?? {};
	const results = data.results ?? [];
	const simplify = options.simplify === undefined ? true : Boolean(options.simplify);

	if (simplify) {
		return results.map((result) => ({
			json: result,
			pairedItem: {
				item: itemIndex,
			},
		}));
	}
	return [
		{
			json: {
				request_id: envelope.request_id,
				results,
				metadata: data.metadata ?? {},
			},
			pairedItem: {
				item: itemIndex,
			},
		},
	];
}

async function extractOperation(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const url = (this.getNodeParameter('url', itemIndex) as string).trim();
	if (!/^https?:\/\//i.test(url)) {
		throw new NodeOperationError(this.getNode(), 'URL must start with http:// or https://');
	}

	const envelope = await anySearchRequest.call(this, {
		method: 'POST',
		url: `${API_BASE_URL}/v1/extract`,
		body: { url },
	});

	const data = envelope.data ?? {};
	return [
		{
			json: {
				url: data.url ?? url,
				title: data.title ?? '',
				content: data.content ?? '',
			},
			pairedItem: {
				item: itemIndex,
			},
		},
	];
}

async function capabilityOperation(
	this: IExecuteFunctions,
	itemIndex: number,
	operation: string,
): Promise<INodeExecutionData[]> {
	if (operation === 'getDomains') {
		const envelope = await anySearchRequest.call(this, {
			method: 'GET',
			url: `${API_BASE_URL}/v1/domains`,
		});
		const domains = envelope.data?.domains ?? [];
		return domains.map((domain) => ({
			json: domain,
			pairedItem: {
				item: itemIndex,
			},
		}));
	}

	if (operation === 'getSubDomains') {
		const domains = toStringArray(
			this.getNode(),
			this.getNodeParameter('domains', itemIndex, []) as unknown,
			'Domain Names or IDs',
		);
		const searchParams = new URLSearchParams();
		for (const domain of domains) {
			searchParams.append('domain', domain);
		}
		const envelope = await anySearchRequest.call(this, {
			method: 'GET',
			url: `${API_BASE_URL}/v1/sub-domains?${searchParams.toString()}`,
		});
		const resultDomains = envelope.data?.domains ?? [];
		return resultDomains.map((domain) => ({
			json: domain,
			pairedItem: {
				item: itemIndex,
			},
		}));
	}

	throw new NodeOperationError(this.getNode(), `Unknown capability operation: ${operation}`);
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
				const domains = envelope.data?.domains ?? [];
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
				],
				default: 'search',
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
						description:
							'With Markdown, the content field of each result holds rendered Markdown',
					},
					{
						displayName: 'Simplify Output',
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
						default: '',
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
				description: 'Domains to inspect, e.g. code, finance. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
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

				if (resource === 'search') {
					returnData.push(...(await searchOperation.call(this, itemIndex)));
				} else if (resource === 'extract') {
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
					returnData.push({
						json: {
							error:
								error instanceof Error
									? error.message
									: 'AnySearch operation failed unexpectedly',
						},
						pairedItem: {
							item: itemIndex,
						},
					});
					continue;
				}
				const detail = error instanceof Error ? error : new Error(String(error));
				throw new NodeOperationError(this.getNode(), detail, { itemIndex });
			}
		}

		return [returnData];
	}
}
