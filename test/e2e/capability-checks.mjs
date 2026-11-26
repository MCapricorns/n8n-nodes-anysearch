import assert from 'node:assert/strict';

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
		params: { type: 'overview', symbol: 'AAPL' },
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
		params: { type: 'income', cn_code: '600519.SH' },
		sent: { type: 'income', cn_code: '600519.SH', symbol: '' },
		result: /600519.*利润表/i,
	},
	{
		query: 'Hide on Bush',
		tag: 'gaming.esports',
		params: { type: 'player', game_name: 'Hide on Bush#KR1', region: 'kr' },
		checkUrl(url) {
			assert.notEqual(new URL(url).pathname, '/', 'Expected a player or match result');
		},
	},
	{
		query: 'Python Reddit comments',
		tag: 'social_media.social_media',
		params: { type: 'reddit_comment', keyword: 'Python' },
		checkUrl(url) {
			assert.equal(new URL(url).hostname, 'www.reddit.com');
			assert.match(new URL(url).pathname, /\/comments\//);
		},
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
		params: { type: 'earnings' },
		sent: { type: 'earnings', period: '90d' },
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
	assert.equal(item.results.length, 1);
	if (entry.result) assert.match(item.results[0].title, entry.result);
	if (entry.checkUrl) entry.checkUrl(item.results[0].url);
}

export function addCapabilityChecks(add, credential) {
	for (const entry of cases.slice(0, 4)) {
		add(
			entry.query,
			{
				resource: 'search',
				operation: 'search',
				query: entry.query,
				options: {
					tag: entry.tag,
					params: JSON.stringify(entry.params),
					maxResults: 1,
					simplify: false,
				},
			},
			credential,
			(items) => {
				assert.equal(items.length, 1);
				checkItem(entry, items[0].json);
			},
		);
	}
	for (let start = 4; start < cases.length; start += 5) {
		const batch = cases.slice(start, start + 5);
		add(
			'Capability batch ' + (1 + (start - 4) / 5),
			{
				resource: 'search',
				operation: 'batchSearch',
				queries: JSON.stringify(
					batch.map(({ query, tag, params }) => ({ query, tag, params, max_results: 1 })),
				),
			},
			credential,
			(items) => {
				assert.equal(items.length, batch.length);
				for (const [i, item] of items.entries()) {
					assert.equal(item.json.query_index ?? item.json.details?.query_index, i);
					checkItem(batch[i], item.json);
				}
			},
		);
	}
}

export function checkCapabilityRequests(requests, tests) {
	const returnedIds = new Set(
		tests.flatMap((test) => (test.results ?? []).map((item) => item.request_id)),
	);
	for (const entry of cases) {
		const sent = requests.filter((r) => r.body?.tag === entry.tag && r.body.query === entry.query);
		if (entry.missing && !entry.status) {
			assert.equal(sent.length, 0, entry.query);
			continue;
		}
		assert.equal(sent.length, 1, entry.query);
		assert.equal(sent[0].status, entry.status ?? 200, entry.query);
		assert(sent[0].request_id && returnedIds.has(sent[0].request_id), entry.query);
		assert.deepEqual(sent[0].body.params, entry.sent ?? entry.params);
	}
}
