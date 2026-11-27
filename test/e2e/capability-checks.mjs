import assert from 'node:assert/strict';
import { catalogCoverage, catalogDefinitions } from './catalog-checks.mjs';
import { checkSearchResults } from './result-checks.mjs';

const cases = [
	{
		query: 'CA981',
		tag: 'travel.flight_status',
		params: { flight_number: 'CA981' },
		sent: { flight_number: 'CA981', departure: '' },
		result: /CA981.*PEK\s*→\s*JFK/i,
	},
	{
		query: 'AAPL',
		tag: 'finance.fundamental',
		params: { type: 'overview', symbol: 'AAPL', cn_code: '600519.SH' },
		sent: { type: 'overview', symbol: 'AAPL', cn_code: '' },
		result: /AAPL.*Fundamental/i,
	},
	{
		query: 'Flight number missing',
		tag: 'travel.flight_status',
		params: { departure: '' },
		status: 400,
		missing: ['flight_number'],
	},
	{
		query: 'Player region missing',
		tag: 'gaming.esports',
		params: { type: 'player', game_name: 'Hide on Bush#KR1' },
		missing: ['region'],
	},
	{
		query: '贵州茅台 利润表',
		tag: 'finance.fundamental',
		params: { type: 'income', cn_code: '600519.SH', symbol: 'AAPL' },
		sent: { type: 'income', cn_code: '600519.SH', symbol: '' },
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
		status: 400,
		missing: ['departure', 'arrival', 'date'],
	},
	{
		query: 'Crypto symbol missing',
		tag: 'finance.quote',
		params: { type: 'crypto' },
		missing: ['symbol'],
	},
	{
		query: 'Upcoming company earnings',
		tag: 'finance.calendar',
		params: { type: 'earnings', symbol: 'AAPL', period: '7d' },
		sent: { type: 'earnings', symbol: 'AAPL', period: '90d' },
		result: /earnings/i,
	},
	...['ranked', 'mastery', 'live_game', 'leaderboard'].map((type) => ({
		query: type + ' without a region',
		tag: 'gaming.esports',
		params: { type, game_name: 'Hide on Bush#KR1' },
		missing: ['region'],
	})),
	{
		query: 'Player name missing',
		tag: 'gaming.esports',
		params: { type: 'player', region: 'kr' },
		missing: ['game_name'],
	},
	{
		query: 'Match ID missing',
		tag: 'gaming.esports',
		params: { type: 'match_detail' },
		missing: ['match_id'],
	},
	{
		query: 'Tier missing for division',
		tag: 'gaming.esports',
		params: { type: 'leaderboard', region: 'kr', division: 'I' },
		missing: ['tier'],
	},
	{
		query: 'Single citation requires an OCI',
		tag: 'academic.citation',
		params: { op: 'citation', id: '10.1038/s41586-021-03819-2' },
		missing: ['OCI', 'id'],
	},
	{
		query: 'Malformed match ID',
		tag: 'gaming.esports',
		params: { type: 'match_detail', match_id: 'garbage' },
		missing: ['match_id'],
	},
	{
		query: 'Boolean leaderboard division',
		tag: 'gaming.esports',
		params: { type: 'leaderboard', region: 'kr', tier: 'GOLD', division: false },
		missing: ['division'],
	},
	{
		query: 'Zero-day stock quote',
		tag: 'finance.quote',
		params: { type: 'stock', symbol: 'AAPL', period: '000d' },
		missing: ['period'],
	},
];

function checkItem(entry, item) {
	if (entry.missing) {
		assert.equal(typeof item.error, 'string');
		for (const field of entry.missing) assert(item.error.includes(field), item.error);
		assert.equal(item.details.http_status, entry.status);
		if (entry.status) assert(item.details.request_id);
		else assert.equal(item.details.request_id, undefined);
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
				if (entry.missing && !entry.status) {
					assert.equal(sent.length, 0, 'Locally invalid parameters reached HTTP');
					assert.equal(item.request_id, undefined, 'Local failure has a request ID');
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
				assert.deepEqual(request.body, {
					query: entry.query,
					tag: entry.tag,
					params: entry.sent ?? entry.params,
					max_results: 1,
				});
				assert.equal(request.status, entry.status ?? 200, entry.query);
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
	let semanticChecks = 0;
	let nonemptyOnly = 0;
	for (const [index, { input, output, expectedParams }] of records.entries()) {
		const id = output?.request_id ?? output?.details?.request_id;
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
			assert.deepEqual(
				sent.body,
				expected,
				'Outgoing search body differs from the expected request',
			);
			bodies.push(sent.body);
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
			if (checkSearchResults(input, output.results)) semanticChecks++;
			else nonemptyOnly++;
		} catch (error) {
			failures.push({ index, tag: input.tag ?? 'general', request_id: id, reason: error.message });
		}
	}
	return {
		domains: domains.length,
		...catalogCoverage(bodies, catalogDefinitions(domains)),
		cases: records.length,
		verified: records.length - failures.length,
		semanticChecks,
		nonemptyOnly,
		failures,
	};
}

export function checkCatalogRequests(report) {
	assert(report.cases > 0, 'The catalog acceptance matrix is empty');
	assert.equal(
		report.failures.length,
		0,
		report.failures
			.map(
				({ index, tag, request_id, reason }) =>
					'Catalog[' + index + '] ' + tag + ' (' + (request_id ?? 'no request ID') + '): ' + reason,
			)
			.join('\n'),
	);
	return report;
}
