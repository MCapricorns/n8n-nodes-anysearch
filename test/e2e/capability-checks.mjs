import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { searchOutputDigest } from './search-output-digest.cjs';
import { catalogCoverage, catalogDefinitions } from './catalog-checks.mjs';
import { assessSearchResults, checkSearchResults } from './result-checks.mjs';

const cases = [
	{
		query: 'CA981',
		tag: 'travel.flight_status',
		params: { flight_number: 'CA981', departure: 'PEK', date: '2026-11-26', type: 'FlightStatus' },
		result: /CA981.*PEK\s*→\s*JFK/i,
	},
	{
		query: 'AAPL',
		tag: 'finance.fundamental',
		params: { type: 'overview', symbol: 'AAPL', cn_code: '600519.SH' },
		expectedParams: { type: 'overview', symbol: 'AAPL', cn_code: '' },
		result: /AAPL.*Fundamental/i,
	},
	{
		query: 'Flight number missing',
		tag: 'travel.flight_status',
		params: { departure: '' },
		invalidFields: ['flight_number'],
	},
	{
		query: 'DL47',
		tag: 'travel.flight_status',
		params: { flight_number: 'DL47' },
		expectedParams: { flight_number: 'DL47', departure: '' },
		result: /DL47/i,
	},
	{
		query: '贵州茅台 利润表',
		tag: 'finance.fundamental',
		params: { type: 'income', cn_code: '600519.SH', symbol: 'AAPL' },
		expectedParams: { type: 'income', cn_code: '600519.SH', symbol: '' },
		result: /600519.*利润表/i,
	},
	{
		query: 'Hide on Bush',
		tag: 'gaming.esports',
		params: { type: 'player', game_name: 'Hide on Bush#KR1', region: 'kr' },
	},
	{
		query: 'Python Reddit comments',
		tag: 'social_media.social_media',
		params: { type: 'reddit_comment', keyword: 'Python' },
	},
	{
		query: 'Flight ticket parameters missing',
		tag: 'travel.flight',
		params: {},
		invalidFields: ['departure', 'arrival', 'date'],
	},
	{
		query: 'Apple Inc (AAPL) fundamentals',
		tag: 'finance.fundamental',
		params: { type: 'overview' },
		expectedParams: { type: 'overview', symbol: '', cn_code: '' },
		result: /AAPL.*Fundamental/i,
	},
	{
		query: 'Upcoming company earnings',
		tag: 'finance.calendar',
		params: { type: 'earnings', symbol: 'AAPL' },
		expectedParams: { type: 'earnings', symbol: 'AAPL', period: '90d' },
		result: /earnings/i,
	},
	{
		query: 'Esports player region missing',
		tag: 'gaming.esports',
		params: { type: 'player', game_name: 'Hide on Bush#KR1' },
		invalidFields: ['region'],
	},
	{
		query: 'Esports match IDs must include their region',
		tag: 'gaming.esports',
		params: { type: 'match_detail', match_id: '7482819248' },
		invalidFields: ['match_id'],
	},
	{
		query: 'Esports master leaderboard has no division',
		tag: 'gaming.esports',
		params: { type: 'leaderboard', region: 'kr', tier: 'MASTER', division: 'I' },
		invalidFields: ['division'],
	},
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
	if (entry.invalidFields) {
		assert.equal(typeof item.error, 'string');
		for (const field of entry.invalidFields) assert(item.error.includes(field), item.error);
		assert.equal(item.details.http_status, undefined);
		assert.equal(item.details.request_id, undefined);
		return;
	}
	assert(!item.error, item.error);
	assert(item.request_id);
	checkSearchResults(
		{ ...entry, params: entry.expectedParams ?? entry.params, max_results: 1 },
		item.results,
	);
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
				const sent = requests.filter(
					(r) => r.body?.tag === entry.tag && r.body.query === entry.query,
				);
				if (entry.invalidFields) {
					assert.equal(sent.length, 0, 'Invalid parameters reached the HTTP API');
					assert.equal(item.request_id, undefined, 'Local validation has an HTTP request ID');
					continue;
				}
				assert.equal(sent.length, 1, 'Expected exactly one HTTP request');
				const [request] = sent;
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
					params: entry.expectedParams ?? entry.params,
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
	let semanticChecks = 0;
	let nonemptyOnly = 0;
	for (const [index, { input, output, expectedParams }] of records.entries()) {
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
			const expected = expectedParams === undefined ? input : { ...input, params: expectedParams };
			assert(
				isDeepStrictEqual(sent.body, expected),
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
			const result = assessSearchResults(expected, output.results);
			const evidence = {
				index,
				tag: input.tag ?? 'general',
				request_id: id,
				reason: result.reason,
			};
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
