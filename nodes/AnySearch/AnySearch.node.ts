import type {
	ICredentialsDecrypted,
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
import { readAnySearchApiKey } from '../../credentials/AnySearchApi.credentials';
import { capabilityParameters, missingParameterMessage } from './capabilityParameters';

const API_BASE_URL = 'https://api.anysearch.com';
const CREDENTIAL_NAME = 'anySearchApi';
const REQUEST_TIMEOUT = 60_000;
const EXTRACT_BODY_LIMIT = 16 * 1024;
const REDDIT_ORIGIN = 'https://www.reddit.com';
const CAPABILITY_TAG_PATTERN = /^[^.\s]+\.[^.\s]+$/;

const sanitizedErrors = new WeakSet<Error>();
const publicErrorMessages = new Set([
	'At least one domain parameter is required.',
	'Capabilities temporarily unavailable.',
	'Extraction failed.',
	'Format must be one of: json, markdown.',
	'Invalid API key.',
	'Query is required.',
	'Search is temporarily unavailable. Retry, or retry as a general search.',
	'URL is invalid.',
]);

interface AnySearchEnvelope {
	request_id?: string;
	data: unknown;
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

function responseRequestId(body: IDataObject | undefined, headers: unknown): string | undefined {
	const header = Object.entries(objectValue(headers) ?? {}).find(
		([name]) => name.toLowerCase() === 'x-request-id',
	);
	return safeRequestId(body?.request_id) ?? safeRequestId(header?.[1]);
}

function readErrorBody(value: unknown): IDataObject | undefined {
	if (typeof value !== 'string') return objectValue(value);
	try {
		return objectValue(JSON.parse(value));
	} catch {
		return undefined;
	}
}

function safeMessage(value: unknown): string {
	if (typeof value !== 'string' || value.trim() === '') return 'AnySearch request failed.';
	if (
		/(?:api[_\s-]?key|password|authorization)["']?\s*(?:[:=]|\bis\s+)|bearer\s+\S+|as_sk_[a-z\d_-]+/i.test(
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
	body?: IDataObject,
): NodeOperationError | NodeApiError {
	const description = requestId ? `Request ID: ${requestId}` : undefined;
	const error = httpStatus
		? new NodeApiError(node, {}, { message, description, httpCode: String(httpStatus) })
		: new NodeOperationError(node, message, { description });
	if (requestId) error.context.request_id = requestId;
	if (httpStatus) error.context.http_status = httpStatus;
	if (body && httpStatus !== 402) {
		if (typeof body.code === 'number' && Number.isInteger(body.code))
			error.context.code = body.code;
		if (
			typeof body.error_code === 'string' &&
			/^(?!as_sk_)[a-z][a-z\d_-]{0,63}$/i.test(body.error_code)
		) {
			error.context.error_code = body.error_code;
		}
	}
	sanitizedErrors.add(error);
	return error;
}

function httpMessage(status: number, body?: IDataObject): string {
	if (status === 403 && body?.error_code === 'access_temporarily_restricted') {
		return 'AnySearch access is temporarily restricted. Retry after the restriction expires.';
	}
	if (
		status !== 402 &&
		typeof body?.message === 'string' &&
		publicErrorMessages.has(body.message)
	) {
		return body.message;
	}
	if (status === 400) {
		const message = missingParameterMessage(body?.message);
		if (message) return message;
		if (body?.error_code === 'INVALID_TAG') return 'Invalid capability tag.';
		if (typeof body?.message === 'string') {
			// The service may include input values in these messages.
			if (/^Invalid zone: .*\. Valid values: cn, intl\.$/s.test(body.message)) {
				return 'Invalid zone. Valid values: cn, intl.';
			}
			if (body.message.startsWith('Invalid request body:')) {
				const field =
					/into Go struct field SearchRequest\.(query|max_results|tag|zone|language|format|params) of type /.exec(
						body.message,
					)?.[1];
				return field ? `Invalid request body field: ${field}.` : 'Invalid request body.';
			}
		}
	}
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
	// n8n's HTTP helpers can also throw NodeApiError. Only reuse our sanitized errors.
	if (
		(error instanceof NodeApiError || error instanceof NodeOperationError) &&
		sanitizedErrors.has(error)
	)
		return error;
	const details = objectValue(error) ?? {};
	const cause = objectValue(details.cause) ?? {};
	const response = objectValue(details.response) ?? objectValue(cause.response) ?? {};
	const context = objectValue(details.context) ?? {};
	const body =
		readErrorBody(response.data) ?? readErrorBody(response.body) ?? readErrorBody(context.data);
	const requestId = responseRequestId(body, response.headers) ?? safeRequestId(context.request_id);
	const status = Number(
		response.status ??
			response.statusCode ??
			details.httpCode ??
			details.statusCode ??
			details.status,
	);
	if (Number.isInteger(status) && status >= 100 && status <= 599) {
		return apiError(node, httpMessage(status, body), requestId, status, body);
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
	const json = {
		error: failure.message,
		details: {
			...fields,
			...(failure.context.request_id ? { request_id: failure.context.request_id } : {}),
			...(failure.context.http_status ? { http_status: failure.context.http_status } : {}),
			...(failure.context.code !== undefined ? { code: failure.context.code } : {}),
			...(failure.context.error_code ? { error_code: failure.context.error_code } : {}),
		},
	};
	if (node.onError === 'continueErrorOutput') {
		// n8n 2.17 checks json.message when routing two-key error items. Expose the
		// alias during routing and serialize only the public error and diagnostics.
		Object.defineProperty(json, 'message', { value: failure.message });
	}
	return { json, pairedItem: { item: itemIndex } };
}

async function readCredentials(
	this: AnySearchRequestContext,
	itemIndex?: number,
): Promise<ICredentialsDecrypted | undefined> {
	const selected = this.getNode().credentials?.[CREDENTIAL_NAME];
	if (!selected) return undefined;
	const data = await this.getCredentials(CREDENTIAL_NAME, itemIndex);
	if (readAnySearchApiKey(data.apiKey) === undefined) return undefined;
	return { id: selected.id ?? '', name: selected.name, type: CREDENTIAL_NAME, data };
}

async function anySearchRequest(
	this: AnySearchRequestContext,
	options: IHttpRequestOptions,
	itemIndex?: number,
): Promise<AnySearchEnvelope> {
	const requestOptions: IHttpRequestOptions = {
		...options,
		json: true,
		timeout: REQUEST_TIMEOUT,
		disableFollowRedirect: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		headers: {
			...options.headers,
			...(options.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
			'X-Anysearch-Client': 'n8n-nodes-anysearch',
		},
	};
	let response: { body: unknown; statusCode: number; headers?: IDataObject };
	try {
		const credentialsDecrypted = await readCredentials.call(this, itemIndex);
		response =
			credentialsDecrypted === undefined
				? await this.helpers.httpRequest(requestOptions)
				: await this.helpers.httpRequestWithAuthentication.call(
						this,
						CREDENTIAL_NAME,
						requestOptions,
						{ credentialsDecrypted },
					);
	} catch (error) {
		throw toUpstreamError(this.getNode(), error);
	}
	const { statusCode } = response ?? {};
	const body = statusCode === 200 ? objectValue(response?.body) : readErrorBody(response?.body);
	const requestId = responseRequestId(body, response?.headers);
	if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
		throw apiError(this.getNode(), 'AnySearch returned an unexpected HTTP response.', requestId);
	}
	if (statusCode !== 200) {
		throw apiError(this.getNode(), httpMessage(statusCode, body), requestId, statusCode, body);
	}
	return validateEnvelope(this.getNode(), body, statusCode, requestId);
}

function validateEnvelope(
	node: INode,
	value: IDataObject | undefined,
	statusCode: number,
	requestId?: string,
): AnySearchEnvelope {
	if (!value)
		throw apiError(
			node,
			'AnySearch returned an unexpected response: expected a JSON object.',
			requestId,
			statusCode,
		);
	if (typeof value.code !== 'number' || !Number.isInteger(value.code)) {
		throw apiError(
			node,
			'AnySearch returned an unexpected response: missing or invalid code.',
			requestId,
			statusCode,
		);
	}
	if (value.code !== 0) {
		throw apiError(
			node,
			`AnySearch API error ${value.code}. Check the request parameters and account status.`,
			requestId,
			statusCode,
			value,
		);
	}
	return { data: value.data, request_id: requestId };
}

function readDataObject(node: INode, envelope: AnySearchEnvelope, operation: string): IDataObject {
	const data = objectValue(envelope.data);
	if (!data)
		throw invalidData(
			node,
			envelope,
			`AnySearch ${operation} response is missing the data object.`,
		);
	return data;
}

function invalidData(node: INode, envelope: AnySearchEnvelope, message: string) {
	return apiError(node, message, envelope.request_id, 200, { code: 0 });
}

function readArrayField(
	node: INode,
	envelope: AnySearchEnvelope,
	data: IDataObject,
	field: string,
	operation: string,
): IDataObject[] {
	const value = data[field];
	if (!Array.isArray(value) || value.some((entry) => !objectValue(entry))) {
		throw invalidData(
			node,
			envelope,
			`AnySearch ${operation} response contains missing or invalid data.${field}.`,
		);
	}
	return value as IDataObject[];
}

function parseJsonParameter(node: INode, value: string, name: string): IDataObject[string] {
	try {
		return JSON.parse(value);
	} catch {
		throw new NodeOperationError(node, `${name} must be valid JSON`);
	}
}

function searchBody(node: INode, input: IDataObject | undefined): IDataObject {
	if (!input || typeof input.query !== 'string' || input.query.trim() === '') {
		throw new NodeOperationError(node, 'Query must be a non-empty string');
	}
	const strings = ['tag', 'zone', 'language', 'format'];
	const allowed = ['query', 'max_results', ...strings, 'params'];
	if (Object.keys(input).some((key) => !allowed.includes(key))) {
		throw new NodeOperationError(
			node,
			'Search accepts query, max_results, tag, zone, language, format, and params only',
		);
	}
	const query = input.query.trim();
	const body: IDataObject = { query };
	if (input.max_results !== undefined) {
		const max = input.max_results;
		if (typeof max !== 'number' || !Number.isInteger(max) || max < 1 || max > 10) {
			throw new NodeOperationError(node, 'Max Results must be an integer from 1 to 10');
		}
		body.max_results = max;
	}
	for (const key of strings) {
		const value = input[key];
		if (value === undefined) continue;
		if (typeof value !== 'string') throw new NodeOperationError(node, `${key} must be a string`);
		const text = key === 'tag' ? value.trim() : value;
		if (text !== '') body[key] = text;
	}
	if (body.zone !== undefined && body.zone !== 'cn' && body.zone !== 'intl') {
		throw new NodeOperationError(node, 'Zone must be cn or intl');
	}
	if (typeof body.tag === 'string' && !CAPABILITY_TAG_PATTERN.test(body.tag)) {
		throw new NodeOperationError(node, 'Capability Tag must be a complete domain.sub_domain tag');
	}
	if (body.format !== undefined && body.format !== 'json' && body.format !== 'markdown') {
		throw new NodeOperationError(node, 'Response Format must be json or markdown');
	}
	const params = objectValue(input.params);
	if (
		input.params !== undefined &&
		(!params || Object.prototype.toString.call(params) !== '[object Object]')
	) {
		throw new NodeOperationError(node, 'Tag Parameters must be a JSON object');
	}
	const tagParams = capabilityParameters(node, String(body.tag ?? ''), params, query);
	if (tagParams !== undefined) body.params = tagParams;
	return body;
}

function readDomains(node: INode, value: unknown): string[] {
	// Existing workflows can supply a comma-separated expression to the picker.
	const raw = typeof value === 'string' ? value.split(',') : value;
	if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string')) {
		throw new NodeOperationError(node, 'Domain Names or IDs must contain strings');
	}
	if (raw.some((entry) => entry.includes(','))) {
		throw new NodeOperationError(node, 'Each domain name or ID must be a separate array entry');
	}
	const domains = raw.map((entry) => entry.trim()).filter(Boolean);
	if (!domains.length) throw new NodeOperationError(node, 'Domain Names or IDs must not be empty');
	return [...new Set(domains)];
}

async function search(
	this: IExecuteFunctions,
	body: IDataObject,
	itemIndex: number,
): Promise<IDataObject> {
	const envelope = await anySearchRequest.call(
		this,
		{
			method: 'POST',
			url: API_BASE_URL + '/v1/search',
			body,
		},
		itemIndex,
	);
	const data = readDataObject(this.getNode(), envelope, 'search');
	const results = readArrayField(this.getNode(), envelope, data, 'results', 'search');
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
		throw invalidData(
			this.getNode(),
			envelope,
			'AnySearch search response contains invalid result fields.',
		);
	}
	const metadata = objectValue(data.metadata);
	if (
		data.metadata !== undefined &&
		(!metadata ||
			(metadata.total_results !== undefined &&
				(typeof metadata.total_results !== 'number' ||
					!Number.isInteger(metadata.total_results) ||
					metadata.total_results < 0)) ||
			(metadata.search_time_ms !== undefined &&
				(typeof metadata.search_time_ms !== 'number' ||
					!Number.isFinite(metadata.search_time_ms) ||
					metadata.search_time_ms < 0)))
	) {
		throw invalidData(
			this.getNode(),
			envelope,
			'AnySearch search response contains invalid metadata.',
		);
	}
	return {
		request_id: envelope.request_id,
		results: results.map((result) => {
			const url = result.url as string;
			return url.startsWith(REDDIT_ORIGIN + REDDIT_ORIGIN + '/')
				? { ...result, url: url.slice(REDDIT_ORIGIN.length) }
				: result;
		}),
		metadata: metadata ?? {},
	};
}

async function searchOperation(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const node = this.getNode();
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;
	const { maxResults, simplify, params, ...fields } = options;
	if (simplify !== undefined && typeof simplify !== 'boolean') {
		throw new NodeOperationError(node, 'Simplify must be a boolean');
	}
	let tagParameters = params;
	if (params === '') tagParameters = undefined;
	else if (typeof params === 'string') {
		tagParameters = parseJsonParameter(node, params, 'Tag Parameters');
	}
	const body = searchBody(node, {
		...fields,
		query: this.getNodeParameter('query', itemIndex, ''),
		...(maxResults === undefined ? {} : { max_results: maxResults }),
		params: tagParameters,
	});
	const data = await search.call(this, body, itemIndex);
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
	const node = this.getNode();
	const value = this.getNodeParameter('queries', itemIndex, '');
	const queries =
		typeof value === 'string' && value.trim() !== ''
			? parseJsonParameter(node, value, 'Queries')
			: value;
	if (!Array.isArray(queries) || queries.length < 1 || queries.length > 5) {
		throw new NodeOperationError(node, 'Queries must contain between 1 and 5 search objects');
	}
	return Promise.all(
		Array.from(queries, async (query: unknown, queryIndex: number) => {
			const object = objectValue(query);
			const queryText = object?.query;
			const identity = {
				query: typeof queryText === 'string' ? queryText : '',
				query_index: queryIndex,
			};
			try {
				const body = searchBody(node, object);
				const data = await search.call(this, body, itemIndex);
				return { json: { ...identity, ...data }, pairedItem: { item: itemIndex } };
			} catch (error) {
				return errorItem(node, error, itemIndex, identity);
			}
		}),
	);
}

function isNonPublicIPv6(host: string): boolean {
	// URL normalizes the literal, but may leave a run of zero hextets compressed.
	const [prefix, suffix] = host.slice(1, -1).split('::');
	const words = (text: string) =>
		text
			.split(':')
			.filter(Boolean)
			.map((word) => parseInt(word, 16));
	const leading = words(prefix);
	const trailing = suffix === undefined ? [] : words(suffix);
	const [first, second, third, fourth, fifth, sixth] = [
		...leading,
		...Array<number>(8 - leading.length - trailing.length).fill(0),
		...trailing,
	];

	// IANA global unicast is 2000::/3. Keep the globally reachable NAT64 prefix.
	if ((first & 0xe000) !== 0x2000) {
		return !(
			first === 0x64 &&
			second === 0xff9b &&
			third === 0 &&
			fourth === 0 &&
			fifth === 0 &&
			sixth === 0
		);
	}

	// The IANA protocol assignment has more specific entries with different reachability.
	if (first === 0x2001 && second < 0x200) {
		return !(
			second === 0 ||
			second === 3 ||
			(second === 4 && third === 0x112) ||
			(second >= 0x20 && second <= 0x3f) ||
			/^\[2001:1::[123]\]$/.test(host)
		);
	}
	return (first === 0x2001 && second === 0xdb8) || (first === 0x3fff && second < 0x1000);
}

function isNonPublicHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/\.$/, '');
	if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
	const mapped = /^\[::ffff:([\da-f]{1,4}):([\da-f]{1,4})\]$/.exec(host);
	const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
	if (!mapped && !ipv4) return host.startsWith('[') && isNonPublicIPv6(host);

	const high = mapped ? parseInt(mapped[1], 16) : 0;
	const low = mapped ? parseInt(mapped[2], 16) : 0;
	const [first, second, third, fourth] = ipv4
		? ipv4.slice(1).map(Number)
		: [high >>> 8, high & 255, low >>> 8, low & 255];

	// Reject IANA special-purpose addresses marked as non-global, plus multicast.
	return (
		first === 0 ||
		first === 10 ||
		first === 127 ||
		first >= 224 ||
		(first === 100 && second >= 64 && second <= 127) ||
		(first === 169 && second === 254) ||
		(first === 172 && second >= 16 && second <= 31) ||
		(first === 192 && second === 168) ||
		(first === 192 && second === 0 && third === 0 && fourth !== 9 && fourth !== 10) ||
		(first === 192 && second === 0 && third === 2) ||
		(first === 192 && second === 88 && third === 99 && fourth === 2) ||
		(first === 198 && (second === 18 || second === 19)) ||
		(first === 198 && second === 51 && third === 100) ||
		(first === 203 && second === 0 && third === 113)
	);
}

async function extractOperation(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const node = this.getNode();
	const value = this.getNodeParameter('url', itemIndex, '');
	const submitted = typeof value === 'string' ? value.trim() : '';
	if (!/^https?:\/\/[^/]/i.test(submitted) || /[\s\p{Cc}\\]/u.test(submitted)) {
		throw new NodeOperationError(node, 'URL must be an absolute public HTTP(S) URL');
	}
	let url: URL;
	try {
		url = new URL(submitted);
	} catch {
		throw new NodeOperationError(node, 'URL must be an absolute public HTTP(S) URL');
	}
	// The API reads public pages only and has no login or account/password capability.
	if (url.username || url.password) {
		throw new NodeOperationError(node, 'URL must not contain embedded credentials');
	}
	if (isNonPublicHost(url.hostname)) {
		throw new NodeOperationError(node, 'URL must use a public host');
	}
	const body = { url: submitted };
	if (Buffer.byteLength(JSON.stringify(body), 'utf8') > EXTRACT_BODY_LIMIT) {
		throw new NodeOperationError(node, 'Extract request body must be at most 16 KiB');
	}
	const envelope = await anySearchRequest.call(
		this,
		{
			method: 'POST',
			url: API_BASE_URL + '/v1/extract',
			body,
		},
		itemIndex,
	);
	const data = readDataObject(this.getNode(), envelope, 'extract');
	if (
		typeof data.url !== 'string' ||
		typeof data.title !== 'string' ||
		typeof data.content !== 'string'
	) {
		throw invalidData(
			this.getNode(),
			envelope,
			'AnySearch extract response must contain string url, title, and content fields.',
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

function validCapability(value: unknown): boolean {
	const entry = objectValue(value);
	if (typeof entry?.sub_domain !== 'string' || !CAPABILITY_TAG_PATTERN.test(entry.sub_domain)) {
		return false;
	}
	if (entry.params === undefined) return true;
	const params = objectValue(entry.params);
	return (
		!!params &&
		Object.values(params).every((value) => {
			const definition = objectValue(value);
			return (
				typeof definition?.required === 'boolean' &&
				typeof definition.description === 'string' &&
				(definition.sort_order === undefined || Number.isInteger(definition.sort_order))
			);
		})
	);
}

async function fetchDomains(
	this: AnySearchRequestContext,
	selected?: string[],
	itemIndex?: number,
): Promise<{ domains: IDataObject[]; requestId?: string }> {
	let endpoint = '/v1/domains';
	if (selected) {
		const searchParams = new URLSearchParams();
		for (const domain of selected) searchParams.append('domain', domain);
		endpoint = '/v1/sub-domains?' + searchParams.toString();
	}
	const envelope = await anySearchRequest.call(
		this,
		{
			method: 'GET',
			url: API_BASE_URL + endpoint,
		},
		itemIndex,
	);
	const data = readDataObject(this.getNode(), envelope, 'capability');
	const domains = readArrayField(this.getNode(), envelope, data, 'domains', 'capability');
	if (
		domains.some(
			(domain) =>
				typeof domain.domain !== 'string' ||
				!domain.domain ||
				(selected &&
					(!Array.isArray(domain.sub_domains) ||
						domain.sub_domains.some((entry) => !validCapability(entry)))),
		)
	) {
		throw invalidData(
			this.getNode(),
			envelope,
			'AnySearch capability response contains invalid domain definitions.',
		);
	}
	return { domains, requestId: envelope.request_id };
}

async function capabilityOperation(
	this: IExecuteFunctions,
	itemIndex: number,
	operation: string,
): Promise<INodeExecutionData[]> {
	if (operation !== 'getDomains' && operation !== 'getSubDomains') {
		throw new NodeOperationError(this.getNode(), 'Unknown capability operation');
	}
	const selected =
		operation === 'getSubDomains'
			? readDomains(this.getNode(), this.getNodeParameter('domains', itemIndex, []))
			: undefined;
	const { domains, requestId } = await fetchDomains.call(this, selected, itemIndex);
	return domains.map((domain) => ({
		json: { ...domain, ...(requestId ? { request_id: requestId } : {}) },
		pairedItem: { item: itemIndex },
	}));
}

export class AnySearch implements INodeType {
	methods = {
		loadOptions: {
			// Get all capability domains for pickers (does not consume quota).
			async getDomains(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const { domains } = await fetchDomains.call(this);
				return domains.map((domain) => ({
					value: String(domain.domain),
					name: `${String(domain.domain)} — ${String(domain.description ?? '')}`,
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
				default: '',
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
				description: 'AnySearch requires a non-empty search query',
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
							'JSON object with the parameters defined by the capability tag in the AnySearch catalog (e.g. {"market": "US", "type": "stock", "symbol": "AAPL"} for finance.quote)',
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
				description: 'AnySearch requires a public absolute HTTP(S) URL',
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
				required: true,
				typeOptions: {
					loadOptionsMethod: 'getDomains',
				},
				displayOptions: {
					show: {
						resource: ['capability'],
						operation: ['getSubDomains'],
					},
				},
				default: [],
				description:
					'AnySearch requires at least one domain, e.g. code or finance. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
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
