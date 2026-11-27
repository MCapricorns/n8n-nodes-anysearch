// Records only test request parameters, header presence, and response diagnostics.
const fs = require('node:fs');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const maxBodyBytes = 4 * 1024 * 1024;

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
		const record = {
			method: request.method,
			path: request.path,
			startedAt: Date.now(),
			clientHeader: request.getHeader('x-anysearch-client'),
			authorizationPresent: Boolean(authorization),
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
						record.code = body.code;
						record.error_code = body.error_code;
						record.resultCount = body.data?.results?.length;
						record.contentLength =
							typeof body.data?.content === 'string'
								? Array.from(body.data.content).length
								: undefined;
						if (body.code === 0)
							record.responseDigest = crypto
								.createHash('sha256')
								.update(JSON.stringify(body.data))
								.digest('hex');
					}
				} catch {}
				fs.appendFileSync(process.env.ANYSEARCH_E2E_TRACE, JSON.stringify(record) + '\n');
			});
		});
		return request;
	};
}
