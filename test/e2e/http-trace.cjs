// Records only test request parameters, header presence, and response diagnostics.
const fs = require('node:fs');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { searchOutputDigest } = require('./search-output-digest.cjs');
const redditOrigin = 'https://www.reddit.com';
const maxBodyBytes = 4 * 1024 * 1024;

function shortText(value, length) {
	return typeof value === 'string'
		? value.replace(/as_sk_[A-Za-z0-9_-]+|\bBearer\s+\S+/gi, '[REDACTED]').slice(0, length)
		: undefined;
}

function resultSummary(row) {
	return {
		title: shortText(row?.title, 250),
		url: shortText(row?.url, 400),
		snippet: shortText(row?.snippet, 400),
		contentPrefix: shortText(row?.content, 600),
		contentLength: typeof row?.content === 'string' ? Array.from(row.content).length : undefined,
	};
}

function summarizeResponse(body) {
	const data = body.data;
	const metadata = data?.metadata;
	return {
		message: shortText(body.message, 400),
		metadata: metadata && {
			totalResults: metadata.total_results,
			searchTimeMs: metadata.search_time_ms,
		},
		results: Array.isArray(data?.results) ? data.results.map(resultSummary) : undefined,
		extract: typeof data?.content === 'string' ? resultSummary(data) : undefined,
		domains: Array.isArray(data?.domains)
			? data.domains.map((row) => ({
					domain: shortText(row?.domain, 60),
					subDomains: row?.sub_domain_count ?? row?.sub_domains?.length,
				}))
			: undefined,
	};
}

function safeRequestId(value) {
	return typeof value === 'string' && /^(?!as_sk_)[a-zA-Z0-9_-]{1,64}$/i.test(value)
		? value
		: undefined;
}

function readResponse(chunks, encoding) {
	let bytes = Buffer.concat(chunks);
	const options = { maxOutputLength: maxBodyBytes };
	if (encoding === 'gzip' || encoding === 'deflate') bytes = zlib.unzipSync(bytes, options);
	else if (encoding === 'br') bytes = zlib.brotliDecompressSync(bytes, options);
	return JSON.parse(bytes.toString());
}

for (const protocol of ['http', 'https']) {
	const transport = require('node:' + protocol);
	const original = transport.request;
	transport.request = function (...args) {
		const request = original.apply(this, args);
		const host = String(request.getHeader('host') || '');
		if (!/^api\.anysearch\.com(?::443)?$/.test(host)) return request;
		const authorization = request.getHeader('authorization');
		const path = request.path.replace(/^https:\/\/api\.anysearch\.com(?::443)?(?=\/)/, '');
		const record = {
			method: request.method,
			path,
			startedAt: Date.now(),
			clientHeader: request.getHeader('x-anysearch-client'),
			authorizationPresent: Boolean(authorization),
			bearerPresent: /^Bearer\s+\S+$/i.test(String(authorization || '')),
			emptyBearer: /^Bearer\s*$/i.test(String(authorization || '')),
			fixtureBearer: authorization === 'Bearer synthetic_invalid_key',
		};
		const chunks = [];
		for (const method of ['write', 'end']) {
			const send = request[method];
			request[method] = function (chunk, ...rest) {
				if (typeof chunk === 'string' || Buffer.isBuffer(chunk)) chunks.push(Buffer.from(chunk));
				return send.call(this, chunk, ...rest);
			};
		}
		// Capture the encoding before the HTTP client decodes the stream and removes the header.
		request.prependListener('response', (response) => {
			const encoding = response.headers['content-encoding'];
			record.status = response.statusCode;
			record.request_id = safeRequestId(response.headers['x-request-id']);
			const bodyChunks = [];
			let size = 0;
			response.on('data', (chunk) => {
				size += chunk.length;
				if (size <= maxBodyBytes) bodyChunks.push(chunk);
			});
			response.on('end', () => {
				record.finishedAt = Date.now();
				try {
					record.body = JSON.parse(Buffer.concat(chunks).toString());
				} catch {}
				try {
					const body = readResponse(bodyChunks, encoding);
					record.request_id = safeRequestId(body.request_id) ?? record.request_id;
					if (record.status !== 402) {
						record.responseSummary = summarizeResponse(body);
						if (Number.isInteger(body.code)) record.code = body.code;
						if (
							typeof body.error_code === 'string' &&
							/^(?!as_sk_)[a-z][a-z\d_-]{0,63}$/i.test(body.error_code)
						)
							record.error_code = body.error_code;
						record.resultCount =
							body.data?.results?.length ??
							body.data?.domains?.length ??
							(typeof body.data?.content === 'string' ? 1 : undefined);
						record.contentLength =
							typeof body.data?.content === 'string'
								? Array.from(body.data.content).length
								: undefined;
						if (
							record.status === 200 &&
							body.code === 0 &&
							record.path === '/v1/search' &&
							Array.isArray(body.data?.results)
						) {
							// The node repairs a duplicated Reddit origin when returning results.
							const results = body.data.results.map((row) =>
								typeof row?.url === 'string' &&
								row.url.startsWith(redditOrigin + redditOrigin + '/')
									? { ...row, url: row.url.slice(redditOrigin.length) }
									: row,
							);
							record.searchOutputDigest = searchOutputDigest(results, body.data.metadata);
						}
						if (body.code === 0)
							record.responseDigest = crypto
								.createHash('sha256')
								.update(JSON.stringify(body.data))
								.digest('hex');
					}
				} catch {
					if (record.status !== 402) record.responseSummary = { parseError: true, bytes: size };
				}
				const { bearerPresent, emptyBearer, fixtureBearer, ...withoutAuthDetails } = record;
				const evidence =
					record.status === 402
						? { status: 402, request_id: record.request_id }
						: withoutAuthDetails;
				fs.appendFileSync(process.env.ANYSEARCH_E2E_TRACE, JSON.stringify(evidence) + '\n');
				// The parent verifies the actual outgoing body in memory, including quota refusals.
				if (process.env.ANYSEARCH_E2E_TRACE_PIPE === '1')
					fs.writeFileSync(3, JSON.stringify(record) + '\n');
			});
		});
		return request;
	};
}
