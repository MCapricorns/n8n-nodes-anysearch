import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { searchOutputDigest } from './search-output-digest.cjs';
import { catalogCoverage, catalogDefinitions } from './catalog-checks.mjs';
import { assessSearchResults, checkSearchResults } from './result-checks.mjs';

// The node rejects these before any HTTP request; each field must appear in the error text.
const invalid = (query, tag, params, ...invalidFields) => ({ query, tag, params, invalidFields });
// The node rejects these before any HTTP request with a message matching the pattern.
const rejected = (query, tag, params, invalidMessage) => ({ query, tag, params, invalidMessage });

const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const alphaFold = '10.1038/s41586-021-03819-2';
const flight = { departure: 'PEK', arrival: 'SHA', date: '2027-01-10' };

const cases = [
	{
		query: 'CA981',
		tag: 'travel.flight_status',
		params: { flight_number: 'CA981', departure: 'PEK', date: yesterday },
		result: /CA981.*PEK\s*→\s*JFK/i,
	},
	{
		query: 'AAPL',
		tag: 'finance.fundamental',
		params: { market: 'US', type: 'overview', symbol: 'AAPL' },
		result: /AAPL.*Fundamental/i,
	},
	{
		query: 'MU5137',
		tag: 'travel.flight_status',
		params: { flight_number: 'MU5137', departure: 'SHA', date: yesterday },
		result: /MU5137/i,
	},
	{
		query: '贵州茅台 利润表',
		tag: 'finance.fundamental',
		params: { market: 'CN', type: 'income', symbol: '600519.SH' },
		result: /600519.*(?:利润表|income[- ]statement)/i,
	},
	{
		query: 'Hide on Bush',
		tag: 'gaming.esports',
		params: { type: 'mastery', game_name: 'Hide on Bush#KR1', region: 'kr' },
	},
	invalid('Flight ticket parameters missing', 'travel.flight', {}, 'departure', 'arrival', 'date'),
	invalid(
		'Apple Inc (AAPL) fundamentals',
		'finance.fundamental',
		{ type: 'overview' },
		'market',
		'symbol',
	),
	{
		query: 'Upcoming company earnings',
		tag: 'finance.calendar',
		params: { market: 'US', type: 'earnings', symbol: 'AAPL', period: '90d' },
		result: /earnings/i,
	},
	invalid(
		'Esports player region missing',
		'gaming.esports',
		{ type: 'player', game_name: 'Hide on Bush#KR1' },
		'region',
	),
	invalid(
		'Esports match IDs must include their region',
		'gaming.esports',
		{ type: 'match_detail', match_id: '7482819248' },
		'match_id',
	),
	invalid(
		'Esports master leaderboard has no division',
		'gaming.esports',
		{ type: 'leaderboard', region: 'kr', tier: 'MASTER', division: 'I' },
		'division',
	),
	invalid(
		'Stock quote market missing',
		'finance.quote',
		{ type: 'stock', symbol: 'AAPL' },
		'market',
	),
	invalid(
		'Stock quote type unsupported',
		'finance.quote',
		{ market: 'US', type: 'option', symbol: 'AAPL' },
		'type',
	),
	invalid(
		'Forex quote market unsupported',
		'finance.quote',
		{ market: 'US', type: 'forex', symbol: 'EURUSD' },
		'type',
	),
	invalid('Stock quote symbol missing', 'finance.quote', { market: 'US', type: 'stock' }, 'symbol'),
	invalid(
		'History frequency unsupported',
		'finance.quote',
		{ market: 'US', type: 'stock', symbol: 'AAPL', operation: 'history', frequency: '1h' },
		'frequency',
	),
	invalid(
		'Price adjustment unsupported',
		'finance.quote',
		{ market: 'CN', type: 'stock', symbol: '600519.SH', adjustment: 'yesterday' },
		'adjustment',
	),
	invalid(
		'Report period malformed',
		'finance.fundamental',
		{ market: 'US', type: 'overview', symbol: 'AAPL', report_period: 'quarter' },
		'report_period',
	),
	invalid(
		'Report end date needs a period',
		'finance.fundamental',
		{ market: 'US', type: 'income', symbol: 'AAPL', selection: 'report_end_date' },
		'report_period',
	),
	invalid(
		'Ratings market unsupported',
		'finance.fundamental',
		{ market: 'CN', type: 'ratings', symbol: '600519.SH' },
		'type',
	),
	rejected(
		'Fundamental A-share field removed',
		'finance.fundamental',
		{ market: 'CN', type: 'income', symbol: '600519.SH', cn_code: '600519.SH' },
		/Unsupported parameters for finance\.fundamental/,
	),
	invalid(
		'Corporate action type missing',
		'finance.calendar',
		{ market: 'CN', type: 'corporate_action' },
		'event_type',
	),
	invalid(
		'Trading calendar exchange missing',
		'finance.calendar',
		{ market: 'CN', type: 'trade_cal' },
		'exchange',
	),
	invalid(
		'US calendar window too long',
		'finance.calendar',
		{ market: 'US', type: 'earnings', period: '180d' },
		'period',
	),
	invalid(
		'Earnings date type unsupported',
		'finance.calendar',
		{ market: 'US', type: 'earnings', date_type: 'record' },
		'date_type',
	),
	invalid(
		'Macro period unsupported',
		'finance.macro',
		{ market: 'US', type: 'cpi', period: '5y' },
		'period',
	),
	invalid(
		'US macro measure unsupported',
		'finance.macro',
		{ market: 'US', type: 'cpi', measure: 'yoy' },
		'measure',
	),
	invalid('SHIBOR market unsupported', 'finance.macro', { market: 'US', type: 'shibor' }, 'type'),
	invalid(
		'LPR tenor unsupported',
		'finance.macro',
		{ market: 'CN', type: 'lpr', tenor: '3m' },
		'tenor',
	),
	invalid('Stock news symbol missing', 'finance.news', { market: 'US', type: 'stock' }, 'symbol'),
	invalid(
		'Transcript period missing',
		'finance.news',
		{ market: 'US', type: 'transcript', symbol: 'AAPL' },
		'report_period',
	),
	invalid(
		'News source unsupported',
		'finance.news',
		{ market: 'CN', type: 'long_form', news_src: 'eastmoney' },
		'news_src',
	),
	invalid('News type removed', 'finance.news', { market: 'US', type: 'announcement' }, 'type'),
	invalid(
		'Market cap malformed',
		'finance.screen',
		{ market: 'US', type: 'stock', market_cap: 'abc' },
		'market_cap',
	),
	invalid(
		'PE range malformed',
		'finance.screen',
		{ market: 'US', type: 'stock', pe: '0..30..50' },
		'pe',
	),
	invalid(
		'Dividend yield out of range',
		'finance.screen',
		{ market: 'US', type: 'stock', dividend_yield: '0..150' },
		'dividend_yield',
	),
	invalid(
		'Index weight symbol missing',
		'finance.screen',
		{ market: 'CN', type: 'index_weight' },
		'symbol',
	),
	rejected(
		'Screen country removed',
		'finance.screen',
		{ market: 'US', type: 'stock', country: 'US' },
		/Unsupported parameters for finance\.screen/,
	),
	invalid(
		'Threat type mismatch',
		'security.threat_intel',
		{ target: '1.1.1.1', type: 'domain' },
		'target',
	),
	invalid(
		'Threat type unsupported',
		'security.threat_intel',
		{ target: 'APT29', type: 'botnet' },
		'type',
	),
	rejected(
		'Threat intel tag removed',
		'security.intel',
		{ ioc: 'example.com' },
		/Unknown Capability Tag/,
	),
	rejected(
		'FAO tag removed',
		'agriculture.fao',
		{ domain: 'production' },
		/Unknown Capability Tag/,
	),
	rejected(
		'Citation type removed',
		'academic.citation',
		{ id: alphaFold, id_type: 'doi' },
		/Unsupported parameters for academic\.citation/,
	),
	invalid(
		'Citation structured operation needs id',
		'academic.citation',
		{ op: 'citations', sort: 'creation:desc' },
		'id',
	),
	invalid(
		'Citation type unsupported',
		'academic.citation',
		{ id: '', type: 'JournalArticle' },
		'type',
	),
	invalid('Citation year malformed', 'academic.citation', { id: '', year: '23' }, 'year'),
	invalid(
		'Citation filter unsupported',
		'academic.citation',
		{ id: alphaFold, op: 'citations', filter: 'year:2020' },
		'filter',
	),
	invalid(
		'Citation identifier not supported by op',
		'academic.citation',
		{ id: alphaFold, op: 'author' },
		'id',
	),
	invalid(
		'Citation operation unsupported',
		'academic.citation',
		{ id: alphaFold, op: 'related' },
		'op',
	),
	invalid(
		'Citation identifier checksum invalid',
		'academic.citation',
		{ id: '0000-0002-1825-0098', op: 'author' },
		'id',
	),
	invalid('Dataset year malformed', 'academic.dataset', { year: '20' }, 'year'),
	invalid(
		'Dataset resource type unsupported',
		'academic.dataset',
		{ resource_type: 'SoftwarePackage' },
		'resource_type',
	),
	invalid('Agriculture item missing', 'agriculture.stats', { domain: 'production' }, 'item'),
	invalid(
		'Agriculture domain unsupported',
		'agriculture.stats',
		{ item: 'Wheat', domain: 'crops' },
		'domain',
	),
	invalid(
		'Agriculture year malformed',
		'agriculture.stats',
		{ item: 'Wheat', year: '2024;' },
		'year',
	),
	invalid('Snippet regex malformed', 'code.snippet', { regex: 'yes' }, 'regex'),
	invalid('Air quality coordinates malformed', 'environment.aqi', { location: '38.9' }, 'location'),
	invalid('Image type unsupported', 'resource.image', { type: 'gallery' }, 'type'),
	invalid(
		'Flight city with apostrophe',
		'travel.flight',
		{ ...flight, departure: "Xi'an" },
		'departure',
	),
	invalid(
		'Flight return before departure',
		'travel.flight',
		{ ...flight, return_date: '2027-01-05' },
		'return_date',
	),
	invalid('Flight currency malformed', 'travel.flight', { ...flight, currency: 'US' }, 'currency'),
	invalid('Flight stops unsupported', 'travel.flight', { ...flight, max_stops: 2 }, 'max_stops'),
	rejected(
		'Flight origin removed',
		'travel.flight',
		{ ...flight, origin: 'PEK' },
		/Unsupported parameters for travel\.flight/,
	),
	invalid(
		'Flight status date malformed',
		'travel.flight_status',
		{ flight_number: 'CA981', departure: 'PEK', date: '26/11/2026' },
		'date',
	),
	invalid(
		'Flight status number malformed',
		'travel.flight_status',
		{ flight_number: 'China 981', departure: 'PEK' },
		'flight_number',
	),
	rejected(
		'Flight status type removed',
		'travel.flight_status',
		{ flight_number: 'CA981', departure: 'PEK', type: 'FlightStatus' },
		/Unsupported parameters for travel\.flight_status/,
	),
	invalid('Flight number missing', 'travel.flight_status', {}, 'flight_number'),
	rejected(
		'Reserved ISSN',
		'academic.citation',
		{ id: '0000-0000', op: 'venue-citation-count' },
		/0000-0000|id must be/,
	),
	invalid(
		'Esports Riot ID needs a tag line',
		'gaming.esports',
		{ type: 'player', game_name: 'Hide on Bush', region: 'kr' },
		'game_name',
	),
	invalid(
		'Esports division needs a tier',
		'gaming.esports',
		{ type: 'leaderboard', region: 'kr', division: 'II' },
		'division',
	),
	invalid(
		'Esports mastery count is not a positive integer',
		'gaming.esports',
		{ type: 'mastery', game_name: 'Hide on Bush#KR1', region: 'kr', count: 0 },
		'count',
	),
	invalid('Store language unsupported', 'gaming.store', { language: 'fr' }, 'language'),
	invalid('Store region malformed', 'gaming.store', { region: 'usa' }, 'region'),
	rejected(
		'Vulnerability identifiers differ',
		'security.vuln',
		{ type: 'cve', value: 'CVE-2021-44228' },
		/same identifiers/,
	),
];

function safeId(id) {
	return typeof id === 'string' && /^(?!as_sk_)[A-Za-z0-9_-]{1,64}$/i.test(id) ? id : undefined;
}

function quotaLabel(id) {
	return safeId(id) ? `HTTP 402 (${id})` : 'HTTP 402';
}

function isQuotaResponse(item) {
	return (item?.http_status ?? item?.details?.http_status) === 402;
}

function checkItem(entry, item) {
	if (entry.invalidFields || entry.invalidMessage) {
		assert.equal(typeof item.error, 'string');
		for (const field of entry.invalidFields ?? []) assert(item.error.includes(field), item.error);
		if (entry.invalidMessage) assert.match(item.error, entry.invalidMessage);
		assert.equal(item.details.http_status, undefined);
		assert.equal(item.details.request_id, undefined);
		return;
	}
	assert(!item.error, item.error);
	assert(item.request_id);
	checkSearchResults({ ...entry, max_results: 1 }, item.results);
	if (entry.result) assert.match(item.results[0].title, entry.result);
}

const groups = cases
	.slice(0, 4)
	.map((entry) => ({ name: entry.query, entries: [entry], single: true }));
for (let start = 4; start < cases.length; start += 5) {
	groups.push({
		name: 'Capability batch ' + (1 + (start - 4) / 5),
		entries: cases.slice(start, start + 5),
		single: false,
	});
}

export function addCapabilityChecks(add, credential) {
	for (const { name, entries, single } of groups) {
		const [first] = entries;
		const parameters = single
			? {
					resource: 'search',
					operation: 'search',
					query: first.query,
					options: {
						tag: first.tag,
						params: JSON.stringify(first.params),
						maxResults: 1,
						simplify: false,
					},
				}
			: {
					resource: 'search',
					operation: 'batchSearch',
					queries: JSON.stringify(
						entries.map(({ query, tag, params }) => ({ query, tag, params, max_results: 1 })),
					),
				};
		add(name, parameters, credential, (items) => {
			assert.equal(items.length, entries.length);
			const failures = [];
			for (const [i, { json }] of items.entries()) {
				try {
					if (!single) assert.equal(json.query_index ?? json.details?.query_index, i);
					checkItem(entries[i], json);
				} catch (error) {
					if (isQuotaResponse(json)) {
						failures.push(quotaLabel(json.request_id ?? json.details?.request_id));
						continue;
					}
					failures.push(
						entries[i].query +
							' (' +
							(json.request_id ?? json.details?.request_id ?? 'local') +
							'): ' +
							error.message,
					);
				}
			}
			assert.equal(failures.length, 0, failures.join('\n'));
		});
	}
}

export function checkCapabilityRequests(requests, tests) {
	const byNode = new Map(tests.map((test) => [test.name, test.results]));
	const seenIds = new Set();
	const failures = [];
	for (const { name, entries, single } of groups) {
		const results = byNode.get(name);
		for (const [index, entry] of entries.entries()) {
			try {
				const item = results?.[index];
				assert(item, 'Missing node output');
				if (!single) assert.equal(item.query_index, index, 'Unexpected batch index');
				const sameQuery = requests.filter((r) => r.body?.query === entry.query);
				if (entry.invalidFields || entry.invalidMessage) {
					assert.equal(sameQuery.length, 0, 'Invalid parameters reached the HTTP API');
					assert.equal(item.request_id, undefined, 'Local validation has an HTTP request ID');
					assert.equal(item.http_status, undefined, 'Local validation has an HTTP status');
					continue;
				}
				const sent = sameQuery.filter((r) => r.body.tag === entry.tag);
				assert.equal(sent.length, 1, 'Expected exactly one HTTP request');
				const [request] = sent;
				assert.equal(request.method, 'POST', 'Unexpected search HTTP method');
				assert.equal(request.path, '/v1/search', 'Unexpected search HTTP path');
				assert(
					request.request_id && !seenIds.has(request.request_id),
					'Missing or duplicate HTTP request ID',
				);
				seenIds.add(request.request_id);
				assert.equal(
					item.request_id,
					request.request_id,
					'Request ID differs from this node output',
				);
				const expected = {
					query: entry.query,
					tag: entry.tag,
					params: entry.params,
					max_results: 1,
				};
				assert(
					isDeepStrictEqual(request.body, expected),
					'Outgoing search body differs from the expected request',
				);
				if (request.status === 402 && isQuotaResponse(item)) {
					failures.push(quotaLabel(request.request_id));
					continue;
				}
				assert.equal(request.status, 200, entry.query);
			} catch (error) {
				failures.push(entry.query + ': ' + error.message);
			}
		}
	}
	assert.equal(failures.length, 0, failures.join('\n'));
}

export function catalogRequestReport(records, requests, domains) {
	const byId = new Map();
	for (const request of requests) {
		const id = request.request_id;
		if (id) byId.set(id, byId.has(id) ? null : request);
	}
	const seen = new Set();
	const bodies = [];
	const failures = [];
	const unverified = [];
	const checks = [];
	let semanticChecks = 0;
	let nonemptyOnly = 0;
	for (const [index, { input, output }] of records.entries()) {
		const id = safeId(output?.request_id ?? output?.details?.request_id);
		try {
			assert(
				typeof id === 'string' && id && !seen.has(id),
				'Missing or duplicate output request ID',
			);
			seen.add(id);
			const sent = byId.get(id);
			assert.notEqual(sent, null, 'Multiple HTTP requests share the output request ID');
			assert(sent, 'Expected a captured HTTP request');
			assert.equal(sent.method, 'POST', 'Unexpected search HTTP method');
			assert.equal(sent.path, '/v1/search', 'Unexpected search HTTP path');
			assert(
				isDeepStrictEqual(sent.body, input),
				'Outgoing search body differs from the expected request',
			);
			bodies.push(sent.body);
			if (sent.status === 402 && isQuotaResponse(output)) {
				failures.push({ http_status: 402, request_id: id });
				continue;
			}
			if (sent.status === 402 || isQuotaResponse(output)) {
				throw new Error('Wire and node HTTP statuses differ');
			}
			assert(!output.error, output.error);
			assert.equal(sent.status, 200, 'Expected a successful HTTP request');
			assert.equal(sent.code, 0, 'Expected a successful REST response');
			assert.equal(sent.resultCount, output.results?.length, 'Wire and node result counts differ');
			if (output.metadata?.total_results !== undefined)
				assert.equal(
					output.metadata.total_results,
					output.results.length,
					'metadata.total_results differs from the returned count',
				);
			// Older captures recorded the entire wire envelope, which cannot establish
			// equivalence to the node's projected search output.
			if (!sent.searchOutputDigest) {
				unverified.push({
					index,
					tag: input.tag ?? 'general',
					request_id: id,
					reason: 'Missing wire search output digest',
				});
				continue;
			}
			assert.equal(
				searchOutputDigest(output.results, output.metadata),
				sent.searchOutputDigest,
				'Wire and node search results or metadata differ',
			);
			const result = assessSearchResults(input, output.results);
			const evidence = {
				index,
				tag: input.tag ?? 'general',
				request_id: id,
				reason: result.reason,
			};
			checks.push({ ...evidence, status: result.status });
			switch (result.status) {
				case 'verified':
					semanticChecks++;
					break;
				case 'nonemptyOnly':
					nonemptyOnly++;
					break;
				case 'unverified':
					unverified.push(evidence);
					break;
				case 'mismatch':
					failures.push({ ...evidence, kind: 'resultMismatch' });
					break;
			}
		} catch (error) {
			failures.push({ index, tag: input.tag ?? 'general', request_id: id, reason: error.message });
		}
	}
	return {
		domains: domains.length,
		...catalogCoverage(bodies, catalogDefinitions(domains)),
		cases: records.length,
		verified: semanticChecks,
		semanticChecks,
		nonemptyOnly,
		unverified,
		failures,
		checks,
	};
}

export function checkCatalogRequests(report) {
	assert(report.cases > 0, 'The catalog acceptance matrix is empty');
	assert.equal(
		report.failures.length,
		0,
		report.failures
			.map(({ index, tag, request_id, reason, http_status }) => {
				if (http_status === 402) return quotaLabel(request_id);
				return `Catalog[${index}] ${tag} (${request_id ?? 'no request ID'}): ${reason}`;
			})
			.join('\n'),
	);
	return report;
}
