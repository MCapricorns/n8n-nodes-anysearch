// Offline fetch stub for scripts/smoke.mjs.
//
// Preloaded with --require so the smoke script never reaches the network:
//   SMOKE_FIXTURE_MODE=valid     → documented envelopes for every endpoint
//   SMOKE_FIXTURE_MODE=malformed → HTTP 200 with an empty JSON object everywhere
//
// Any request to a host other than api.anysearch.com fails loudly.

const mode = process.env.SMOKE_FIXTURE_MODE || 'malformed';
const BASE_URL = 'https://api.anysearch.com';

function validBody(pathname) {
	if (pathname === '/v1/search') {
		return {
			code: 0,
			request_id: 'fixture-request-id',
			data: {
				results: [{ title: 'Fixture title', url: 'https://example.com/fixture', content: 'Fixture content' }],
				metadata: { pages: 1 },
			},
		};
	}
	if (pathname === '/v1/extract') {
		return {
			code: 0,
			data: { url: 'https://example.com', title: 'Example Domain', content: 'Example content' },
		};
	}
	if (pathname === '/v1/domains') {
		return { code: 0, data: { domains: [{ domain: 'code', description: 'Code', sub_domain_count: 2 }] } };
	}
	if (pathname === '/v1/sub-domains') {
		return { code: 0, data: { domains: [{ domain: 'code.code', description: 'Code snippets' }] } };
	}
	throw new Error(`Offline fixture has no payload for ${pathname}`);
}

globalThis.fetch = async (input) => {
	const url = String(input);
	if (!url.startsWith(`${BASE_URL}/`)) {
		throw new Error(`Offline fixture forbids network access to ${url}`);
	}
	const { pathname } = new URL(url);
	const body = mode === 'valid' ? validBody(pathname) : {};
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
};
