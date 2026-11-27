import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { catalogRequestReport, checkCatalogRequests } from './e2e/capability-checks.mjs';
import { catalogCoverage, changedDefinitions } from './e2e/catalog-checks.mjs';
import { searchOutputDigest } from './e2e/search-output-digest.cjs';
import { assessSearchResults, checkSearchResults } from './e2e/result-checks.mjs';

const cases = JSON.parse(await readFile(new URL('./e2e/search-cases.json', import.meta.url)));
const domains = [
	{
		domain: 'social_media',
		sub_domains: [
			{
				sub_domain: 'social_media.social_media',
				params: { type: { required: false, description: 'Platform and search pattern' } },
			},
		],
	},
];
const job = {
	query: 'Python',
	tag: 'social_media.social_media',
	params: { type: 'linkedin_jobs' },
	max_results: 1,
};
const jobResult = {
	title: 'Software Engineer',
	url: 'https://de.linkedin.com/jobs/view/software-engineer-123456/',
};

function matrix(inputs, outputs) {
	const records = inputs.map((input, i) => ({
		input,
		output: { request_id: 'request-' + i, results: outputs[i] },
	}));
	const requests = records.map(({ input, output }) => ({
		body: input,
		method: 'POST',
		path: '/v1/search',
		request_id: output.request_id,
		status: 200,
		code: 0,
		resultCount: output.results.length,
		searchOutputDigest: searchOutputDigest(output.results, output.metadata),
	}));
	return { records, requests };
}

function checkMatrix(records, requests, domains) {
	return checkCatalogRequests(catalogRequestReport(records, requests, domains));
}

test('only matching, non-empty output joined to the actual request can pass catalog acceptance', () => {
	const { records, requests } = matrix([job], [[jobResult]]);
	assert.deepEqual(checkMatrix(records, requests, domains), {
		domains: 1,
		requests: 1,
		tags: 1,
		parameters: 1,
		missing: [],
		unexpected: [],
		cases: 1,
		verified: 1,
		semanticChecks: 1,
		nonemptyOnly: 0,
		unverified: [],
		failures: [],
		checks: [
			{ index: 0, tag: job.tag, request_id: 'request-0', status: 'verified', reason: undefined },
		],
	});
	assert.throws(
		() => checkMatrix(records, [{ ...requests[0], resultCount: 0 }], domains),
		/counts differ/,
	);
	assert.throws(
		() => checkMatrix([...records, ...records], requests, domains),
		/duplicate output request ID/,
	);
	assert.throws(() => checkMatrix(records, [], domains), /HTTP request/);
	assert.throws(
		() => checkMatrix(records, [{ ...requests[0], path: '/v1/extract' }], domains),
		/Unexpected search HTTP path/,
	);
	assert.throws(
		() => checkMatrix(records, [...requests, ...requests], domains),
		/Multiple HTTP requests/,
	);
	records[0].output.results = [{ ...jobResult, url: 'https://www.youtube.com/watch?v=123' }];
	assert.throws(
		() => checkMatrix(records, requests, domains),
		/Wire and node search results or metadata differ/,
	);
	requests[0].searchOutputDigest = searchOutputDigest(records[0].output.results);
	assert.throws(() => checkMatrix(records, requests, domains), /linkedin_jobs/);
	delete requests[0].searchOutputDigest;
	assert.equal(catalogRequestReport(records, requests, domains).unverified.length, 1);
});

test('the outgoing request must equal the recorded catalog input with no added fields', () => {
	const input = {
		query: 'AAPL fiscal calendar',
		tag: 'finance.calendar',
		params: { type: 'earnings' },
	};
	const { records, requests } = matrix([input], [[{ title: 'AAPL earnings calendar', url: '' }]]);
	assert.equal(checkMatrix(records, requests, domains).verified, 1);
	requests[0].body = { ...input, params: { type: 'earnings', period: '90d' } };
	assert.throws(() => checkMatrix(records, requests, domains), /Outgoing search body/);
	assert.throws(() => checkMatrix([], [], domains), /matrix is empty/);
	const generic = matrix(
		[{ query: 'n8n' }],
		[[{ title: 'n8n Docs', url: 'https://docs.n8n.io/' }]],
	);
	assert.equal(checkMatrix(generic.records, generic.requests, domains).nonemptyOnly, 1);
});

test('fundamental overview distinguishes similar tickers and fiscal periods', () => {
	const input = {
		query: 'Apple Inc (AAPL) fundamentals',
		tag: 'finance.fundamental',
		params: { market: 'US', type: 'overview', symbol: 'AAPL' },
	};
	const annual = {
		title: 'AAPL — Annual Fundamental',
		url: 'https://site.financialmodelingprep.com/?ref=fundamental-AAPL',
		content: 'Symbol: AAPL | ReportPeriod: annual | Income(2026 FY): Revenue=478.83B',
	};
	const wrongTicker = {
		...annual,
		title: 'APC.DE — Annual Fundamental',
		content: 'Symbol: APC.DE | ReportPeriod: annual',
	};
	assert.equal(assessSearchResults(input, [annual]).status, 'verified');
	assert.equal(assessSearchResults(input, [wrongTicker]).status, 'mismatch');
	const marketWide = { ...input, params: { market: 'US', type: 'overview' } };
	assert.equal(assessSearchResults(marketWide, [wrongTicker]).status, 'mismatch');
	assert.equal(
		assessSearchResults({ ...marketWide, query: 'Apple fundamentals' }, [annual]).status,
		'unverified',
	);
	const quarter = {
		...annual,
		title: 'AAPL — Quarterly Fundamental',
		content: 'Symbol: AAPL | ReportPeriod: quarter | Income(2026 Q4): Revenue=114.48B',
	};
	assert.equal(assessSearchResults(input, [quarter]).status, 'mismatch');
	assert.equal(
		assessSearchResults({ ...input, params: { ...input.params, report_basis: 'single_quarter' } }, [
			quarter,
		]).status,
		'verified',
	);
	assert.equal(
		assessSearchResults(input, [{ ...annual, content: quarter.content }]).status,
		'mismatch',
	);
});

test('HTTP 200 and code zero with empty outputs fail every positive catalog case', () => {
	const { records, requests } = matrix(
		cases,
		cases.map(() => []),
	);
	assert.throws(
		() => checkMatrix(records, requests, domains),
		(error) => error.message.split('Expected a non-empty result set').length - 1 === cases.length,
	);
	assert.throws(() => checkSearchResults(job, [{}]), /populated result/);
	assert.throws(() => checkSearchResults(job, [jobResult, jobResult]), /max_results/);
});

test('catalog drift covers flags and descriptions as well as new, removed and stale fields', () => {
	const field = { required: false, description: 'Forward range' };
	const reviewed = {
		'finance.calendar': { period: field, type: { ...field, required: true } },
		'old.tag': {},
	};
	const changed = {
		'finance.calendar': {
			period: { ...field, description: 'Always 90d' },
			type: field,
			extra: field,
		},
		'new.tag': {},
	};
	assert.deepEqual(changedDefinitions(reviewed, changed).sort(), [
		'finance.calendar.extra',
		'finance.calendar.period',
		'finance.calendar.type',
		'new.tag',
		'old.tag',
	]);
	const coverage = catalogCoverage(
		[{ tag: 'old.tag' }, { tag: 'finance.calendar', params: { period: '90d', retired: 1 } }],
		changed,
	);
	assert.deepEqual(coverage.missing.sort(), [
		'finance.calendar.extra',
		'finance.calendar.type',
		'new.tag',
	]);
	assert.deepEqual(coverage.unexpected.sort(), ['finance.calendar.retired', 'old.tag']);
});

test('long-form articles are recognized by the metadata block of their snippet', () => {
	const sina = { tag: 'finance.news', params: { type: 'long_form', news_src: 'sina' } };
	const article = {
		title: '广发证券：维持买入评级 长篇资讯',
		url: '',
		snippet:
			'src=新浪财经 | content_scope=summary | content_length=1200 | content_truncated=true | pub_time=2026-11-27 10:08:00 | title=广发证券 | content= 广发证券发布研报称',
	};
	checkSearchResults(sina, [article]);
	assert.throws(
		() =>
			checkSearchResults(sina, [
				{ ...article, snippet: article.snippet.replace('新浪财经', '财联社') },
			]),
		/long_form article from sina/,
	);
	// A source without articles answers with a coverage status instead of a hit.
	assert.deepEqual(
		assessSearchResults(sina, [
			{
				title: 'Coverage status',
				url: '',
				snippet:
					'coverage_reason: major_news returned no rows for the requested window and source coverage_status: no_data has_more: false',
			},
		]),
		{ status: 'unverified', reason: 'news_src sina returned coverage_status no_data' },
	);
	// The display names of the other sources are still being observed.
	const wallstreetcn = { ...sina, params: { ...sina.params, news_src: 'wallstreetcn' } };
	assert.equal(assessSearchResults(wallstreetcn, [article]).status, 'unverified');
	assert.deepEqual(
		assessSearchResults(wallstreetcn, [
			{ ...article, snippet: article.snippet.replace('src=新浪财经 | ', '') },
		]),
		{
			status: 'unverified',
			reason: 'The long_form record for news_src wallstreetcn names no source',
		},
	);
});

const socialLinks = {
	weibo: 'm.weibo.cn/detail/5369820149450193',
	weibo_hot: 's.weibo.com/top/summary',
	zhihu: 'zhihu.com/question/123',
	zhihu_hot: 'zhihu.com/hot',
	x_top: 'x.com/python/status/123',
	x_latest: 'twitter.com/python/status/456',
	x_media: 'x.com/python/status/123/photo/1',
	x_people: 'x.com/python',
	x_lists: 'x.com/i/lists/123',
	reddit_post: 'www.reddit.com/r/python/comments/abc123/python/',
	reddit_community: 'old.reddit.com/r/python/',
	reddit_comment: 'reddit.com/r/python/comments/abc123/python/d9c8b7/',
	reddit_media: 'i.redd.it/image123.png',
	reddit_people: 'reddit.com/user/python/',
	linkedin_people: 'linkedin.com/in/python/',
	linkedin_jobs: 'ca.linkedin.com/jobs/view/12345/',
	linkedin_company: 'linkedin.com/company/python/',
	linkedin_posts: 'linkedin.com/feed/update/urn:li:activity:12345/',
	wechatmp: 'mp.weixin.qq.com/s/abc123',
};
for (const [type, source] of Object.entries(socialLinks)) {
	test('social selector ' + type + ' requires a matching source', () => {
		const input = { tag: 'social_media.social_media', params: { type } };
		checkSearchResults(input, [{ url: 'https://' + source }]);
		assert.throws(
			() => checkSearchResults(input, [{ title: 'Python', url: 'https://example.org/' + source }]),
			new RegExp(type),
		);
	});
}

test('the document path distinguishes a Reddit comment, LinkedIn job and legal collection', () => {
	const comment = {
		tag: 'social_media.social_media',
		params: { type: 'reddit_comment' },
		max_results: 2,
	};
	const post = { url: 'https://' + socialLinks.reddit_post, title: 'Re: Python' };
	assert.throws(
		() => checkSearchResults(comment, [{ url: 'https://' + socialLinks.reddit_comment }, post]),
		/reddit_comment/,
	);
	assert.deepEqual(assessSearchResults(comment, [post]), {
		status: 'unverified',
		reason: 'reddit_comment returned a parent thread without a comment permalink',
	});
	assert.throws(
		() => checkSearchResults(job, [{ url: 'https://linkedin.com/posts/python-jobs' }]),
		/linkedin_jobs/,
	);
	const links = {
		FR: 'www.federalregister.gov/documents/2025/01/10/2025-01234/rule',
		CFR: 'www.ecfr.gov/current/title-40/chapter-I/part-50/section-50.1',
		USCODE: 'uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title42-section7401',
		BILLS: 'www.congress.gov/bill/119th-congress/house-bill/11102',
	};
	for (const [collection, link] of Object.entries(links)) {
		const input = { tag: 'legal.legislation', params: { jurisdiction: 'US', collection } };
		checkSearchResults(input, [{ url: 'https://' + link }]);
		checkSearchResults(input, [
			{ url: 'https://www.govinfo.gov/app/details/' + collection + '-2025-example' },
		]);
		for (const wrong of Object.values(links).filter((v) => v !== link)) {
			assert.throws(
				() => checkSearchResults(input, [{ url: 'https://' + wrong }]),
				new RegExp(collection),
			);
		}
	}
});

test('ECHR acceptance needs a judgment record and respondent evidence', () => {
	const input = {
		tag: 'legal.judicial',
		params: { jurisdiction: 'ECHR', respondent: 'FRA', doc_type: 'JUDGMENT' },
	};
	const judgment = {
		title: 'Case of X v. France',
		content: 'JUDGMENT',
		url: 'https://hudoc.echr.coe.int/eng?i=001-123456',
	};
	checkSearchResults(input, [judgment]);
	for (const invalid of [
		{ ...judgment, title: 'Case of Y v. Italy' },
		{ ...judgment, content: 'Decision' },
		{ ...judgment, url: 'https://www.echr.coe.int/european-convention-on-human-rights' },
		{ ...judgment, url: 'https://fra.europa.eu/en/eu-charter/article/47' },
	])
		assert.throws(() => checkSearchResults(input, [invalid]), /HUDOC judgment/);
});

test('paper and citation metadata require the exact DOI of the result', () => {
	const doi = '10.1038/s41586-021-03819-2';
	for (const input of [
		{ tag: 'academic.citation', params: { op: 'metadata', id: doi } },
		{ tag: 'academic.paper', params: { doi } },
	]) {
		checkSearchResults(input, [{ url: 'https://doi.org/' + doi.toUpperCase() }]);
		checkSearchResults(input, [{ url: 'https://www.nature.com/articles/s41586-021-03819-2' }]);
		for (const url of [
			'https://doi.org/10.1007/s43442-021-0078-9',
			'https://doi.org/' + doi + '0',
			'https://example.org/?doi=' + doi,
		]) {
			assert.throws(
				() => checkSearchResults(input, [{ url, content: 'References: ' + doi }]),
				/DOI/,
			);
		}
	}
	checkSearchResults({ tag: 'academic.paper', params: { doi: '10.48550/arXiv.1706.03762' } }, [
		{ url: 'https://arxiv.org/abs/1706.03762' },
	]);
});

test('match and player results identify the requested object', () => {
	const match_id = 'KR_7482819248';
	const matchUrl = 'https://www.leagueofgraphs.com/match/kr/7482819248';
	const input = { tag: 'gaming.esports', params: { type: 'match_detail', match_id } };
	const row = JSON.stringify({
		matchId: match_id,
		name: 'Player#KR1',
		championName: 'Galio',
		kills: 7,
	});
	checkSearchResults(input, [{ url: matchUrl }]);
	checkSearchResults(input, [{ url: matchUrl + '#p1', content: row }]);
	// An unknown match is answered with a no_data record for that ID.
	const noData = (subject) =>
		JSON.stringify({
			detail: 'Match ID does not exist',
			kind: 'match',
			status: 'no_data',
			subject,
		});
	checkSearchResults(input, [
		{ title: 'No match found: ' + match_id, url: '', content: noData(match_id) },
	]);
	for (const result of [
		{ url: 'https://lolesports.com/' },
		{ url: matchUrl + '0' },
		{ url: matchUrl.replace('/kr/', '/na/') },
		{ url: 'https://example.org/?match=' + match_id },
		{ url: matchUrl, content: row.replace(match_id, 'KR_7482819247') },
		{ url: '', content: noData('KR_7482819247') },
	])
		assert.throws(() => checkSearchResults(input, [result]), /Expected match/);
	const player = {
		tag: input.tag,
		params: { type: 'player', region: 'kr', game_name: 'Hide on Bush#KR1' },
	};
	const profile = 'https://www.op.gg/summoners/kr/Hide%20on%20Bush-KR1';
	checkSearchResults(player, [{ url: profile }]);
	// A recent-match row names its match and region but not the player.
	const recent = 'https://www.leagueofgraphs.com/match/kr/8421752997';
	const recentRow = JSON.stringify({ matchId: 'KR_8421752997', championName: 'Galio', kills: 7 });
	assert.deepEqual(assessSearchResults(player, [{ url: recent, content: recentRow }]), {
		status: 'unverified',
		reason: 'Recent match rows do not identify the player',
	});
	for (const result of [
		{ url: recent.replace('/kr/', '/na/'), content: recentRow },
		{ url: recent, content: recentRow.replace('KR_8421752997', 'KR_1') },
		{ url: profile.replace('KR1', 'KR2') },
		{ url: profile.replace('/kr/', '/na/') },
	])
		assert.throws(() => checkSearchResults(player, [result]), /profile or match record/);
});

test('a populated structured record can have a blank URL without qualifying as a source hit', () => {
	const results = [{ title: '贵州茅台 600519.SH', content: '收盘价 1500', url: '' }];
	checkSearchResults(
		{ tag: 'finance.quote', params: { market: 'CN', type: 'stock', symbol: '600519.SH' } },
		results,
	);
	assert.throws(() => checkSearchResults(job, results), /linkedin_jobs/);
});

test('an earnings calendar lookup cannot pass with a quarterly news release or a different ticker', () => {
	const input = { tag: 'finance.calendar', params: { type: 'earnings', symbol: 'AAPL' } };
	const hit = { title: 'AAPL Earnings (2027-02-04)', snippet: 'EPS Est: 2.94', url: '' };
	checkSearchResults(input, [hit]);
	assert.throws(
		() =>
			checkSearchResults(input, [
				{ title: 'AAPL reports quarterly earnings', url: 'https://apple.com/newsroom/q4' },
			]),
		/calendar record/,
	);
	assert.throws(
		() => checkSearchResults(input, [{ ...hit, title: 'AAPLL Earnings (2027-02-04)' }]),
		/calendar ticker/,
	);
	checkSearchResults(
		{ tag: input.tag, params: { market: 'CN', type: 'earnings', symbol: '600519.SH' } },
		[{ title: '600519.SH 财报披露（20260930）已披露', url: '' }],
	);
});

test('data repositories, ORCIDs and media selectors reject neighboring result types', () => {
	for (const [client_id, url] of [
		['cern.zenodo', 'https://zenodo.org/records/123'],
		['dryad.dryad', 'https://doi.org/10.5061/dryad.123'],
		['figshare.ars', 'https://doi.org/10.6084/m9.figshare.123'],
	]) {
		const input = { tag: 'academic.dataset', params: { client_id } };
		checkSearchResults(input, [{ url }]);
		assert.throws(
			() => checkSearchResults(input, [{ url: 'https://doi.org/10.1038/other' }]),
			/dataset repository/,
		);
	}
	const orcid = '0000-0002-1825-0097';
	const author = { tag: 'academic.person', params: { orcid } };
	checkSearchResults(author, [{ url: 'https://orcid.org/' + orcid }]);
	assert.throws(
		() =>
			checkSearchResults(author, [{ title: orcid, url: 'https://orcid.org/0000-0003-0530-4305' }]),
		/ORCID/,
	);
	for (const [type, url] of [
		['x_media', socialLinks.x_top],
		['reddit_media', socialLinks.reddit_post],
	]) {
		assert.throws(
			() =>
				checkSearchResults({ tag: 'social_media.social_media', params: { type } }, [
					{ url: 'https://' + url },
				]),
			/media/,
		);
	}
});

test('source IDs must agree with structured IDs and recognized publisher article links', () => {
	const doi = '10.1371/journal.pone.0000176';
	const input = { tag: 'academic.paper', params: { doi } };
	const url = 'https://journals.plos.org/plosone/article?id=' + encodeURIComponent(doi);
	assert.equal(checkSearchResults(input, [{ url, doi }]), true);
	for (const row of [
		{ url: 'https://link.springer.com/article/10.1007/other', doi },
		{ url, doi: '10.1007/other' },
		{
			url,
			content:
				'OpenAlex ID: W1 DOI: https://doi.org/10.1007/other Authors: A. Author Abstract: reference ' +
				doi,
		},
	])
		assert.throws(() => checkSearchResults(input, [row]), /DOI/);
	const match = { tag: 'gaming.esports', params: { type: 'match_detail', match_id: 'KR_123' } };
	const row = { matchId: 'KR_123', name: 'Player#KR1', championName: 'Galio', kills: 1 };
	assert.equal(checkSearchResults(match, [{ url: '', content: JSON.stringify(row) }]), true);
	assert.throws(
		() =>
			checkSearchResults(match, [
				{
					url: 'https://leagueofgraphs.com/match/kr/123',
					content: JSON.stringify({ ...row, matchId: 'KR_124' }),
				},
			]),
		/Expected match/,
	);
});

test('court documents and respondents are identified from the case record', () => {
	const ca = {
		tag: 'legal.judicial',
		params: { jurisdiction: 'CA', case_id: '2016scc27', case_number: '2016 SCC 27' },
	};
	const url = 'https://www.canlii.org/en/ca/scc/doc/2016/2016scc27/2016scc27.html';
	assert.equal(checkSearchResults(ca, [{ url, title: 'R. v. Jordan, 2016 SCC 27' }]), true);
	assert.equal(
		checkSearchResults(ca, [
			{
				url: 'https://decisions.scc-csc.ca/scc-csc/scc-csc/en/item/16057/index.do',
				case_number: '2016 SCC 27',
				title: 'R. v. Jordan',
			},
		]),
		true,
	);
	for (const row of [
		{ url: url.replaceAll('2016scc27', '2016scc28'), title: 'R. v. Jordan, 2016 SCC 27' },
		{ url, case_number: '2016 SCC 28' },
		{ url: 'https://www.congress.gov/bill/119th-congress/house-bill/11102', title: 'R. v. Jordan' },
	])
		assert.throws(() => checkSearchResults(ca, [row]), /Canadian/);
	const regulation = {
		tag: 'legal.legislation',
		params: { jurisdiction: 'CA', database_id: 'car', resource_kind: 'rules' },
	};
	for (const link of [
		'https://www.canlii.org/en/ca/laws/regu/sor-2012-69/latest/sor-2012-69.html',
		'https://laws-lois.justice.gc.ca/eng/regulations/SOR-2012-69/',
	])
		assert.equal(checkSearchResults(regulation, [{ url: link }]), true);
	for (const link of [
		url,
		'https://laws-lois.justice.gc.ca/eng/acts/F-11/',
		'https://www.congress.gov/bill/119th-congress/house-bill/11102',
	]) {
		assert.throws(
			() => checkSearchResults(regulation, [{ url: link }]),
			/Canadian federal regulation/,
		);
	}
	const echr = {
		tag: ca.tag,
		params: { jurisdiction: 'ECHR', doc_type: 'JUDGMENT', respondent: 'FRA' },
	};
	const italy = {
		title: 'CASE OF X v. ITALY',
		url: 'https://hudoc.echr.coe.int/eng?i=001-12345',
		content: 'JUDGMENT. The court cited Y v. France.',
	};
	assert.throws(() => checkSearchResults(echr, [italy]), /HUDOC/);
	assert.throws(() => checkSearchResults(echr, [{ ...italy, respondent: 'FRA' }]), /HUDOC/);
	assert.equal(
		checkSearchResults(echr, [{ title: 'AFFAIRE X c. FRANCE', content: 'ARRÊT', url: italy.url }]),
		true,
	);
});

test('leaderboard entries carry rank, division and the requested server', () => {
	const input = {
		tag: 'gaming.esports',
		params: {
			type: 'leaderboard',
			region: 'kr',
			tier: 'GOLD',
			division: 'I',
			queue: 'RANKED_SOLO_5x5',
		},
	};
	const row = {
		puuid: 'player123',
		leaguePoints: 97,
		rank: 'I',
		wins: 8,
		losses: 3,
		queueType: 'RANKED_SOLO_5x5',
	};
	const entry = {
		title: '#1 player123 — GOLD 97LP',
		url: 'https://www.op.gg/summoners/kr/by-puuid/player123',
		content: JSON.stringify(row),
	};
	assert.equal(checkSearchResults(input, [entry]), true);
	const withoutQueue = { ...row };
	delete withoutQueue.queueType;
	assert.throws(
		() => checkSearchResults(input, [{ ...entry, content: JSON.stringify(withoutQueue) }]),
		/Missing leaderboard queue/,
	);
	assert.equal(
		checkSearchResults(input, [
			{ ...entry, url: entry.url + '?queue=420', content: JSON.stringify(withoutQueue) },
		]),
		true,
	);
	for (const invalid of [
		{ ...entry, url: 'https://example.org/unrelated' },
		{ ...entry, url: entry.url.replace('/kr/', '/na/') },
		{ ...entry, title: '#1 player123 — BRONZE 97LP' },
		{ ...entry, content: JSON.stringify({ ...row, rank: 'IV' }) },
		{ ...entry, content: JSON.stringify({ ...row, queueType: 'RANKED_FLEX_SR' }) },
		{ ...entry, url: entry.url + '?queue=440' },
		{ ...entry, content: '' },
	])
		assert.throws(() => checkSearchResults(input, [invalid]), /leaderboard|ranked player/);
	for (const [type, url] of [
		['x_people', 'https://x.com/notifications'],
		['weibo_hot', 'https://weibo.com/settings'],
	]) {
		assert.throws(
			() => checkSearchResults({ tag: 'social_media.social_media', params: { type } }, [{ url }]),
			new RegExp(type),
		);
	}
});

test('paper filters use publication metadata from the record, outside the abstract and references', () => {
	const input = {
		tag: 'academic.paper',
		params: {
			authors: 'Ashish Vaswani',
			year: '2017-2018',
			venue: 'Advances in Neural Information Processing Systems',
			language: 'en',
			min_citations: '5',
			open_access: 'true',
		},
	};
	const paper = {
		title: 'Attention Is All You Need',
		url: 'https://proceedings.neurips.cc/paper_files/paper/2017/hash/example-Abstract.html',
		snippet:
			'Ashish Vaswani, Noam Shazeer, et al. (2017) — neural information processing systems — cited 127362 times [Open Access]',
		content:
			'OpenAlex ID: W2626778328 DOI: https://doi.org/10.48550/arxiv.1706.03762 Authors: Ashish Vaswani, Noam Shazeer Type: conference-paper Venue: neural information processing systems Publication date: 2017-06-12 Publication year: 2017 Citation count: 127362 Open access: true Language: en Abstract: See an article from 2025. Publication year: 2025.',
	};
	assert.equal(checkSearchResults(input, [paper]), true);
	const conflicting = {
		title: 'An article',
		publication_year: 2015,
		language: 'fr',
		content: '{"publication_year":2020,"language":"English"}',
	};
	for (const [field, value, pattern] of [
		['year', '2020', /publication year/],
		['language', 'en', /language/],
	])
		assert.throws(
			() => checkSearchResults({ tag: input.tag, params: { [field]: value } }, [conflicting]),
			pattern,
		);
	for (const [field, value, pattern] of [
		['year', '2019', /publication year/],
		['year', '2022-', /publication year/],
		['year', '-2016', /publication year/],
		['authors', 'Other researcher', /authors/],
		['venue', 'Nature', /venue/],
		['language', 'fr', /language/],
		['min_citations', '130000', /citations/],
		['open_access', 'false', /open-access/],
		['publication_type', 'journal_article', /publication type/],
	])
		assert.throws(
			() => checkSearchResults({ ...input, params: { [field]: value } }, [paper]),
			pattern,
		);
	const singleYear = { tag: input.tag, params: { year: '2017', sort: 'date_asc' }, max_results: 1 };
	assert.throws(
		() =>
			checkSearchResults(singleYear, [
				{
					title: 'Diabetes in 2017',
					url: '',
					snippet: 'A. Author (2024) — Example Journal — cited 5 times',
				},
			]),
		/publication year/,
	);
	assert.equal(
		checkSearchResults(singleYear, [
			{ title: 'Diabetes in 2017', url: '', snippet: 'Unlabeled body text' },
		]),
		false,
	);
	assert.throws(
		() =>
			checkSearchResults({ tag: input.tag, params: { sort: 'cited' } }, [
				{ title: 'First', cited_by_count: 5 },
				{ title: 'Second', cited_by_count: 20 },
			]),
		/paper order/,
	);
	assert.equal(
		checkSearchResults({ tag: input.tag, params: { sort: 'cited' } }, [
			{ title: 'First', cited_by_count: 20 },
		]),
		false,
	);
});

test('international dividend results reject mainland A-share records with no source URL', () => {
	const input = { tag: 'finance.calendar', params: { type: 'dividends' } };
	const aShare = {
		title: '301199.SZ 分红（20260930）实施',
		url: '',
		content: '{"ts_code":"301199.SZ","cash_div":0.1,"pay_date":"20261127"}',
	};
	assert.throws(() => checkSearchResults(input, [aShare]), /A-share ticker/);
	assert.throws(() => checkSearchResults(input, [{ ...aShare, content: '' }]), /A-share ticker/);
	assert.equal(
		checkSearchResults(input, [
			{ title: 'AAPL Dividend', url: '', content: '{"symbol":"AAPL","cash_div":0.25}' },
		]),
		true,
	);
	assert.equal(
		checkSearchResults(input, [{ title: 'Unidentified dividend record', url: '' }]),
		false,
	);
});

test('patent applicant filters use ownership fields and allow structured records without links', () => {
	const input = { tag: 'ip.global', params: { type: 'GlobalPatent', applicant: 'Panasonic' } };
	const wrong = {
		title: 'Solar cell string',
		url: '',
		snippet: 'Assignee: JINGAO SOLAR CO LTD | Date: 20250304',
		content:
			'Title: Solar cell string Assignee: JINGAO SOLAR CO LTD Inventor: CHEN, DAOYUAN === Bibliographic Data === abstracts: References a Panasonic design. applicants: JINGAO SOLAR CO LTD inventors: CHEN, DAOYUAN',
	};
	assert.throws(() => checkSearchResults(input, [wrong]), /Patent applicant\/assignee/);
	assert.equal(
		checkSearchResults(input, [
			{
				title: 'Solar cell',
				url: '',
				snippet: 'Assignee: PANASONIC IP MANAGEMENT CO LTD | Date: 20250304',
			},
		]),
		true,
	);
	assert.equal(
		checkSearchResults(input, [
			{ title: 'Solar cell', url: '', content: 'References a Panasonic design.' },
		]),
		false,
	);
	const ibm = { ...input, params: { ...input.params, applicant: 'IBM' } };
	assert.equal(
		checkSearchResults(ibm, [
			{ title: 'Patent', url: '', applicant: 'International Business Machines Corporation' },
		]),
		true,
	);
});

test('a Reddit media post can identify its image or video in the provider metadata', () => {
	const input = { tag: 'social_media.social_media', params: { type: 'reddit_media' } };
	const url = 'https://www.reddit.com/r/PythonLearning/comments/abc123/example/';
	const header = 'Subreddit: r/PythonLearning Author: u/example Score: 128 | Comments: 40 ';
	const image = {
		url,
		title: 'Python example',
		content: header + 'Type: IMAGE Domain: i.redd.it --- Comments --- user text',
	};
	assert.equal(checkSearchResults(input, [image]), true);
	assert.equal(
		checkSearchResults(input, [
			{ ...image, content: image.content.replace('IMAGE Domain: i.', 'VIDEO Domain: v.') },
		]),
		true,
	);
	for (const wrong of [
		{
			...image,
			content: header + 'Type: TEXT Domain: self.PythonLearning --- Comments --- ' + image.content,
		},
		{ ...image, content: image.content.replace('i.redd.it', 'i.redd.it.example.org') },
		{ ...image, url: 'https://www.reddit.com/r/PythonLearning/' },
	])
		assert.throws(() => checkSearchResults(input, [wrong]), /media/);
});

test('hot lists require the list itself or ranking data for the linked post', () => {
	const hot = (type, row) =>
		checkSearchResults({ tag: 'social_media.social_media', params: { type } }, [row]);
	const answer = {
		url: 'https://www.zhihu.com/question/20009081/answer/2108614520633612236',
		snippet: '作者: Soulflare',
		content: '普通回答提到热榜第一名',
	};
	assert.equal(hot('zhihu', answer), true);
	assert.throws(() => hot('zhihu_hot', answer), /hot-list/);
	assert.equal(hot('zhihu_hot', { ...answer, content: '{"type":"zhihu_hot","rank":2}' }), true);
	assert.equal(hot('zhihu_hot', { url: 'https://www.zhihu.com/hot' }), true);
	assert.throws(() => hot('zhihu_hot', { ...answer, hot_rank: 0 }), /hot-list/);
	for (const type of ['zhihu', 'zhihu_hot', 'weibo', 'weibo_hot']) {
		const host = type.startsWith('zhihu') ? 'zhihu.com' : 'weibo.com';
		assert.throws(
			() => hot(type, { url: 'https://' + host + '/terms', hot_rank: 1 }),
			new RegExp(type),
		);
	}
	assert.throws(() => hot('weibo_hot', { url: 'https://s.weibo.com/weibo?q=Python' }), /hot-list/);
	assert.equal(hot('weibo_hot', { url: 'https://s.weibo.com/weibo?q=Python&band_rank=3' }), true);
	for (const type of ['x_latest', 'x_top'])
		assert.equal(hot(type, { url: 'https://x.com/python/status/123' }), false);
	for (const [type, url, extra] of [
		['wechatmp', 'https://mp.weixin.qq.com/s/', {}],
		['x_lists', 'https://x.com/i/lists/privacy', {}],
		['linkedin_posts', 'https://www.linkedin.com/posts/privacy', {}],
		['x_media', 'https://x.com/settings', { media_url: 'https://pbs.twimg.com/media/image' }],
		['reddit_media', 'https://www.reddit.com/settings/', { media: [] }],
	])
		assert.throws(() => hot(type, { url, ...extra }), /Expected/);
});

test('earnings record identifiers must agree across the calendar header, JSON and title', () => {
	const us = { tag: 'finance.calendar', params: { type: 'earnings', symbol: 'AAPL' } };
	const valid = {
		title: 'AAPL Earnings (2027-02-04)',
		url: 'https://site.financialmodelingprep.com/?ref=calendar-earnings-AAPL',
		content:
			'Symbol: AAPL | Date: 2027-02-04 | EPS_Actual: N/A | EPS_Estimated: 2.9400 | CalendarSource: market-calendar | MarketWide: false',
	};
	assert.equal(checkSearchResults(us, [valid]), true);
	for (const row of [
		{ title: 'MSFT earnings calendar', content: 'Symbol: MSFT | Date: 2027-01-26 | See also AAPL' },
		{ ...valid, symbol: 'MSFT' },
		{ ...valid, title: 'MSFT Earnings (2027-02-04)' },
		{ ...valid, content: valid.content.replace('Symbol: AAPL', 'Symbol: MSFT') },
		{ title: 'Calendar', content: 'Earnings calendar; See also AAPL' },
	])
		assert.throws(() => checkSearchResults(us, [row]), /calendar/);
	const cn = { tag: us.tag, params: { market: 'CN', type: 'earnings', symbol: '600519.SH' } };
	const local = {
		title: '600519.SH 财报披露（20260930）已披露',
		url: '',
		content: '{"ts_code":"600519.SH","end_date":"20260930","actual_date":"20261031"}',
	};
	assert.equal(checkSearchResults(cn, [local]), true);
	assert.throws(
		() =>
			checkSearchResults(cn, [
				{ ...local, content: local.content.replace('600519.SH', '301199.SZ') },
			]),
		/calendar ticker/,
	);
});

test('ORCID resolution rejects conflicting identity fields and ambiguous candidate lists', () => {
	const orcid = '0000-0002-1825-0097';
	const other = '0000-0003-0530-4305';
	const input = { tag: 'academic.person', params: { orcid } };
	const valid = {
		title: 'Example Person',
		url: 'https://openalex.org/A5012345678',
		content: JSON.stringify({
			id: 'https://openalex.org/A5012345678',
			display_name: 'Example Person',
			orcid: 'https://orcid.org/' + orcid,
		}),
	};
	assert.equal(checkSearchResults(input, [valid]), true);
	for (const row of [
		{ url: 'https://orcid.org/' + other, orcid },
		{ url: 'https://orcid.org/' + orcid, orcid: other },
		{ ...valid, orcid: other },
		{ url: 'https://orcid.org/login', orcid },
		{ ...valid, orcid: [orcid], content: undefined },
		{
			...valid,
			status: 'RESOLVED',
			content: JSON.stringify({ orcid, status: 'AMBIGUOUS_IDENTITY' }),
		},
		{
			url: '',
			orcid,
			title: 'Ambiguous author identity in OpenAlex',
			content: 'status: AMBIGUOUS_IDENTITY orcid: ' + orcid + ' reason: multiple author profiles',
		},
	])
		assert.throws(() => checkSearchResults(input, [row]), /ORCID/);
	const doi = '10.1007/s43442-021-0078-9';
	assert.equal(
		checkSearchResults({ tag: 'academic.paper', params: { doi } }, [
			{ url: 'https://link.springer.com/content/pdf/' + doi + '.pdf', doi },
		]),
		true,
	);
});

test('a dataset repository identifies a record rather than a policy, account or search page', () => {
	for (const [client_id, host, path] of [
		['cern.zenodo', 'zenodo.org', '/record/8279574'],
		['figshare.ars', 'figshare.com', '/articles/dataset/ghg-emissions_csv/14903061/1'],
		['dryad.dryad', 'datadryad.org', '/stash/dataset/doi:10.5061/dryad.123ab'],
	]) {
		const input = { tag: 'academic.dataset', params: { client_id, resource_type: 'Dataset' } };
		assert.equal(
			checkSearchResults(input, [{ url: 'https://' + host + path, resource_type: 'Dataset' }]),
			true,
		);
		for (const wrong of ['/login', '/terms', '/search?q=Dataset', '/about']) {
			assert.throws(
				() =>
					checkSearchResults(input, [{ url: 'https://' + host + wrong, resource_type: 'Dataset' }]),
				/dataset repository/,
			);
		}
		if (client_id === 'figshare.ars')
			assert.throws(
				() =>
					checkSearchResults(input, [
						{ url: 'https://' + host + path.replace('/dataset/', '/figure/') },
					]),
				/resource type/,
			);
	}
	const cfr = {
		tag: 'legal.legislation',
		params: { jurisdiction: 'US', collection: 'CFR', title: '42' },
	};
	assert.equal(
		checkSearchResults(cfr, [{ url: 'https://www.govinfo.gov/link/cfr/42/5.100' }]),
		true,
	);
	assert.throws(
		() => checkSearchResults(cfr, [{ url: 'https://www.govinfo.gov/link/cfr/24/5.100' }]),
		/CFR title/,
	);
	for (const title of ['042', '+42']) {
		assert.equal(
			checkSearchResults({ ...cfr, params: { ...cfr.params, title } }, [
				{ url: 'https://www.govinfo.gov/link/cfr/42/5.100' },
			]),
			true,
		);
	}
	assert.equal(
		checkSearchResults(
			{ ...cfr, params: { jurisdiction: 'US', collection: 'BILLS', congress: '0119' } },
			[{ url: 'https://www.congress.gov/bill/119th-congress/house-bill/11102' }],
		),
		true,
	);
});

test('a requested paper ordering needs comparable distinct results even when record metadata matches a filter', () => {
	const paper = (citations) => ({
		title: 'An article',
		type: 'article',
		cited_by_count: citations,
	});
	const input = {
		tag: 'academic.paper',
		params: { publication_type: 'journal_article', sort: 'cited' },
		max_results: 3,
	};
	assert.equal(checkSearchResults(input, [paper(5)]), false);
	assert.equal(checkSearchResults({ tag: input.tag, params: input.params }, [paper(5)]), false);
	assert.equal(checkSearchResults(input, [paper(5), paper(5)]), false);
	assert.equal(checkSearchResults(input, [paper(7), paper(5)]), true);
	assert.throws(() => checkSearchResults(input, [paper(5), paper(7)]), /paper order/);
	const dates = { ...input, params: { year: '2017', sort: 'date_asc' } };
	const row = { title: 'Study', publication_year: 2017 };
	assert.equal(checkSearchResults(dates, [row, row]), false);
	assert.equal(
		checkSearchResults(dates, [
			{ ...row, publication_date: '2017-02-12' },
			{ ...row, publication_date: '2017-06-12' },
		]),
		true,
	);
	assert.throws(
		() =>
			checkSearchResults({ ...dates, params: { sort: 'date_asc' } }, [
				{ ...row, publication_date: '2017-06-12' },
				{ ...row, publication_date: '2017-02-12' },
				{ ...row, publication_year: 2018 },
			]),
		/paper order/,
	);
});

test('ranked, live game and champion mastery need evidence of the named operation', () => {
	const url = 'https://www.op.gg/summoners/kr/Hide%20on%20Bush-KR1';
	const input = (type, extra = {}) => ({
		tag: 'gaming.esports',
		params: { type, region: 'kr', game_name: 'Hide on Bush#KR1', ...extra },
	});
	const record = (fields) => ({
		url,
		content: JSON.stringify({ gameName: 'Hide on Bush', tagLine: 'KR1', ...fields }),
	});
	// A profile link alone shows neither a tier nor mastery points.
	assert.equal(checkSearchResults(input('ranked'), [{ url, title: 'Player profile' }]), false);
	assert.equal(
		checkSearchResults(input('ranked'), [record({ tier: 'MASTER', rank: 'I', leaguePoints: 231 })]),
		true,
	);
	assert.deepEqual(assessSearchResults(input('mastery'), [{ url, title: 'Player profile' }]), {
		status: 'unverified',
		reason: 'No mastery record for Hide on Bush#KR1',
	});
	assert.equal(
		checkSearchResults(input('mastery'), [
			record({ championName: 'LeBlanc', points: 633199, level: 60 }),
		]),
		true,
	);
	const mastery = input('mastery', { champion: 'Yasuo' });
	checkSearchResults(mastery, [record({ championName: 'Yasuo', points: 225480 })]);
	assert.throws(
		() => checkSearchResults(mastery, [record({ championName: 'LeBlanc', points: 633199 })]),
		/Expected mastery filtered to champion Yasuo/,
	);
	// A record for another player contradicts the request, whoever it links to.
	assert.throws(
		() =>
			checkSearchResults(input('mastery'), [
				{
					url,
					content: JSON.stringify({
						gameName: 'Other player',
						tagLine: 'KR1',
						championName: 'LeBlanc',
						points: 1,
					}),
				},
			]),
		/profile record/,
	);
	// Only the answer for a player who is not in a game has been observed.
	assert.equal(checkSearchResults(input('live_game'), [record({ inGame: false })]), true);
	assert.deepEqual(assessSearchResults(input('live_game'), [record({ inGame: true })]), {
		status: 'unverified',
		reason: 'No live-game details for Hide on Bush#KR1',
	});
});

test('catalog distinguishes unverified filters, source mismatches and nonempty-only cases', () => {
	const hot = { tag: 'social_media.social_media', params: { type: 'weibo_hot' }, max_results: 2 };
	const post = { title: 'Python', url: 'https://m.weibo.cn/detail/123' };
	const rankedPost = { ...post, content: '{"source":"weibo_hot","position":2}' };
	const elsewhere = { url: 'https://www.python.org/' };
	const { records, requests } = matrix(
		[hot, hot, hot, { query: 'general' }],
		[[rankedPost], [post], [post, elsewhere], [{ title: 'Generic result' }]],
	);
	const report = catalogRequestReport(records, requests, domains);
	assert.equal(report.verified, 1);
	assert.equal(report.semanticChecks, 1);
	assert.equal(report.nonemptyOnly, 1);
	assert.deepEqual(
		report.unverified.map((item) => item.index),
		[1],
	);
	assert.match(report.unverified[0].reason, /hot-list/);
	assert.deepEqual(
		report.failures.map((item) => [item.index, item.kind]),
		[[2, 'resultMismatch']],
	);
});

test('record identity alone does not verify additional requested filters', () => {
	const doi = '10.1038/s41586-021-03819-2';
	for (const [tag, params, result] of [
		[
			'finance.calendar',
			{ market: 'US', type: 'dividends', symbol: 'AAPL' },
			{ url: 'https://example.com/dividend', title: 'Quarterly dividend declared' },
		],
		[
			'academic.person',
			{ orcid: '0000-0002-1825-0097', affiliations: 'example university' },
			{ url: 'https://orcid.org/0000-0002-1825-0097' },
		],
		[
			'legal.legislation',
			{ jurisdiction: 'US', collection: 'CFR', title: 40, agency: 'epa' },
			{ url: 'https://www.ecfr.gov/current/title-40/chapter-I/part-50/section-50.1' },
		],
		[
			'legal.judicial',
			{ jurisdiction: 'ECHR', respondent: 'FRA', doc_type: 'JUDGMENT', legal_basis: 'Article 6' },
			{
				url: 'https://hudoc.echr.coe.int/eng?i=001-123456',
				title: 'Case X v. France',
				content: 'JUDGMENT',
			},
		],
		[
			'social_media.social_media',
			{ type: 'weibo_hot', region: 'Beijing', keyword: 'Python' },
			{ url: 'https://s.weibo.com/top/summary', title: 'Top searches' },
		],
		[
			'finance.calendar',
			{ type: 'earnings', symbol: 'AAPL', period: '90d' },
			{ url: 'https://example.com/record', title: 'AAPL earnings (1900-01-01)' },
		],
		[
			'ip.global',
			{ type: 'GlobalPatent', applicant: 'Huawei', date_start: '2026', ipc: 'H01L' },
			{
				title: 'Example patent',
				content: '{"applicant":"Huawei","publicationYear":2020,"ipc":"G06N"}',
			},
		],
	]) {
		assert.equal(assessSearchResults({ tag, params }, [result]).status, 'unverified');
	}
	const dataset = {
		tag: 'academic.dataset',
		params: { client_id: 'cern.zenodo', year: '2020-2025' },
	};
	const result = { url: 'https://zenodo.org/records/123' };
	assert.equal(assessSearchResults(dataset, [result]).status, 'unverified');
	assert.equal(
		assessSearchResults(dataset, [{ ...result, publicationYear: [2023] }]).status,
		'unverified',
	);
	assert.equal(
		assessSearchResults(dataset, [{ ...result, publicationYear: 2023 }]).status,
		'verified',
	);
	assert.equal(
		assessSearchResults(dataset, [{ ...result, publicationYear: 1900 }]).status,
		'mismatch',
	);
	assert.equal(
		assessSearchResults(dataset, [
			{ ...result, publicationYear: 1900, content: '{"publicationYear":2023}' },
		]).status,
		'mismatch',
	);
	assert.equal(
		assessSearchResults({ ...dataset, params: { ...dataset.params, resource_type: 'Dataset' } }, [
			{ ...result, publicationYear: 1900 },
		]).status,
		'mismatch',
	);
});

test('queue attribution, identity resolution and player-only mastery are inconclusive', () => {
	const rank = {
		title: 'GOLD',
		url: 'https://op.gg/summoners/kr/by-puuid/P',
		content: '{"puuid":"P","leaguePoints":97,"rank":"I","wins":8,"losses":3}',
	};
	const queue = {
		tag: 'gaming.esports',
		params: {
			type: 'leaderboard',
			region: 'kr',
			tier: 'GOLD',
			division: 'I',
			queue: 'RANKED_SOLO_5x5',
		},
	};
	assert.equal(assessSearchResults(queue, [rank]).status, 'unverified');
	assert.equal(
		assessSearchResults(queue, [{ ...rank, url: rank.url + '?queue=440' }]).status,
		'mismatch',
	);
	assert.equal(
		assessSearchResults(queue, [{ ...rank, url: rank.url + '?queue=420' }]).status,
		'verified',
	);
	for (const extra of [
		{ region: 'na', queueId: 420 },
		{ division: 'IV', queueId: 420 },
		{ queueId: [420] },
	]) {
		const content = JSON.stringify({ ...JSON.parse(rank.content), ...extra });
		assert.equal(assessSearchResults(queue, [{ ...rank, content }]).status, 'mismatch');
	}
	const person = { tag: 'academic.person', params: { orcid: '0000-0002-1825-0097' } };
	assert.equal(
		assessSearchResults(person, [{ title: 'No selection', content: 'status: AMBIGUOUS_IDENTITY' }])
			.status,
		'unverified',
	);
	assert.equal(
		assessSearchResults(person, [{ url: 'https://orcid.org/0000-0003-0530-4305' }]).status,
		'mismatch',
	);
	const profile = { url: 'https://www.op.gg/summoners/kr/Hide%20on%20Bush-KR1', title: 'Profile' };
	const match = cases.find(
		({ tag, params }) => tag === 'gaming.esports' && params.type === 'match_detail',
	);
	const mastery = cases.find(
		({ tag, params }) => tag === 'gaming.esports' && params.type === 'mastery',
	);
	assert.equal(assessSearchResults(mastery, [profile]).status, 'unverified');
	assert.equal(
		assessSearchResults(mastery, [
			{
				...profile,
				content: JSON.stringify({
					gameName: 'Hide on Bush',
					tagLine: 'KR1',
					championName: 'Yasuo',
					points: 225480,
				}),
			},
		]).status,
		'verified',
	);
	// A participant row names the match; a page without it does not.
	const row = { matchId: match.params.match_id, championName: 'Galio', kills: 7 };
	assert.equal(
		assessSearchResults(match, [{ url: '', content: JSON.stringify(row) }]).status,
		'verified',
	);
	assert.equal(
		assessSearchResults(match, [{ url: 'https://lolesports.com/', title: 'LoL Esports' }]).status,
		'mismatch',
	);
});

test('quota evidence is limited to the status and request ID after a unique wire match', () => {
	const { records, requests } = matrix([job], [[]]);
	Object.assign(records[0].output, {
		error: 'private vendor details',
		details: { http_status: 402 },
	});
	Object.assign(requests[0], { status: 402, message: 'private vendor details' });
	const report = catalogRequestReport(records, requests, domains);
	assert.deepEqual(report.failures, [{ http_status: 402, request_id: 'request-0' }]);
	assert.throws(
		() => checkCatalogRequests(report),
		(error) =>
			error.message.includes('HTTP 402 (request-0)') &&
			!error.message.includes('private vendor details'),
	);
	const duplicated = catalogRequestReport(records, [requests[0], requests[0]], domains);
	assert.match(duplicated.failures[0].reason, /Multiple HTTP requests/);
});

test('paper ordering and available metadata cannot stand in for missing filters', () => {
	const paper = (params, results) =>
		assessSearchResults({ tag: 'academic.paper', params }, results).status;
	const ordered = [
		{ title: 'A', citationCount: 7 },
		{ title: 'B', citationCount: 2 },
	];
	assert.equal(paper({ sort: 'cited' }, ordered), 'verified');
	assert.equal(paper({ doi: '10.1234/example', sort: 'cited' }, ordered), 'unverified');
	assert.equal(
		paper({ authors: 'Alice Li', year: '2026' }, [{ title: 'A', year: 2026 }]),
		'unverified',
	);
	assert.equal(
		paper({ doi: '10.1234/example', year: '2026' }, [{ title: 'A', year: 2023 }]),
		'mismatch',
	);
	assert.equal(paper({ language: 'EN' }, [{ title: 'A', language: 'en' }]), 'verified');
});

test('unknown source rules and malformed structured evidence cannot certify a result', () => {
	const match = cases.find(
		({ tag, params }) => tag === 'gaming.esports' && params.type === 'match_detail',
	);
	const dataset = { tag: 'academic.dataset', params: { client_id: 'another.repository' } };
	assert.equal(
		assessSearchResults(dataset, [{ url: 'https://example.org/datasets/1' }]).status,
		'nonemptyOnly',
	);
	const hot = { tag: 'social_media.social_media', params: { type: 'weibo_hot' } };
	for (const fields of [
		{ type: 'zhihu_hot', source: 'zhihu_hot', hot_rank: 1 },
		{ type: 'weibo_hot', position: [2] },
	]) {
		assert.equal(
			assessSearchResults(hot, [
				{ url: 'https://m.weibo.cn/detail/123', content: JSON.stringify(fields) },
			]).status,
			'mismatch',
		);
	}
	for (const content of ['not json', '[]', '{}', JSON.stringify({ matchId: 'KR_1' })]) {
		assert.equal(
			assessSearchResults(match, [{ url: 'https://lolesports.com/', content }]).status,
			'mismatch',
		);
	}
});
