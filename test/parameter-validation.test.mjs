import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { catalogCoverage } from './e2e/catalog-checks.mjs';

const require = createRequire(import.meta.url);
const { capabilityParameters } = require('../dist/nodes/AnySearch/capabilityParameters.js');
const { tags } = require('../dist/nodes/AnySearch/catalog.json');
const cases = require('./e2e/search-cases.json');
const DOI = '10.1038/s41586-021-03819-2';

const node = {
	id: 'parameter-validation',
	name: 'AnySearch',
	type: 'n8n-nodes-anysearch.anySearch',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

function assertFieldError(tag, field, params, query) {
	assert.throws(() => capabilityParameters(node, tag, params, query), {
		name: 'NodeOperationError',
		message: new RegExp(`\\b${field}\\b`, 'i'),
	});
}

function assertRequestError(tag, params, query, message) {
	assert.throws(() => capabilityParameters(node, tag, params, query), {
		name: 'NodeOperationError',
		message,
	});
}

test('the compiled validator accepts all positive fixtures, covers the catalog, and leaves inputs intact', () => {
	const outputs = cases.map(({ tag, query, params }) => {
		const input = Object.freeze(structuredClone(params));
		const result = capabilityParameters(node, tag, input, query);
		// Parameters reach the API exactly as provided; the node adds no defaults.
		assert.deepEqual(result, params, tag);
		assert.deepEqual(input, params, tag);
		return { tag, params: result };
	});
	const { missing, unexpected } = catalogCoverage(outputs, tags);
	assert.deepEqual(missing, []);
	assert.deepEqual(unexpected, []);
});

test('required flags, supported fields and tags come from the catalog', () => {
	for (const [tag, fields] of Object.entries(tags)) {
		for (const field of Object.keys(fields)) {
			const sample = cases.find(
				(entry) => entry.tag === tag && Object.hasOwn(entry.params ?? {}, field),
			);
			assert(sample, `${tag}.${field} must have a positive fixture`);
			if (!fields[field].required) continue;
			const { [field]: removed, ...params } = sample.params;
			assertRequestError(
				tag,
				params,
				sample.query,
				new RegExp(`Provide required parameters for ${tag}:.*\\b${field}\\b`),
			);
		}
		assertRequestError(
			tag,
			{ ...cases.find((entry) => entry.tag === tag)?.params, unsupported_field: 'value' },
			'test',
			new RegExp(`Unsupported parameters for ${tag}\\.`),
		);
	}
	assertRequestError('security.intel', { ioc: 'example.com' }, 'test', /Unknown Capability Tag/);
	assertRequestError('agriculture.fao', { domain: 'production' }, 'test', /Unknown Capability Tag/);
});

test('catalog fields reject objects and arrays', () => {
	const failures = new Set();
	for (const { tag, query, params } of cases) {
		for (const field of Object.keys(params ?? {})) {
			for (const [kind, value] of [
				['object', Object.freeze({ invalid: true })],
				['array', Object.freeze(['invalid'])],
			]) {
				const input = Object.freeze({ ...params, [field]: value });
				try {
					assertFieldError(tag, field, input, query);
					assert.equal(input[field], value);
				} catch (error) {
					failures.add(`${tag}.${field} with an ${kind}\n${error.message}`);
				}
			}
		}
	}
	assert.deepEqual([...failures], []);
});

test('documented scalar constraints reject malformed values across capability groups', () => {
	for (const [tag, params, field] of [
		['business.trade', { type: 'GlobalBilateralTrade', hs_code: '847' }, 'hs_code'],
		['energy.electricity', { type: 'GlobalElectricity', metric: 'invalid_metric' }, 'metric'],
		['energy.production', { type: 'USEnergyData', frequency: 'fortnightly' }, 'frequency'],
		['finance.quote', { market: 'US', type: 'stock', symbol: 'AAPL', period: '0d' }, 'period'],
		['finance.quote', { market: 'US', type: 'stock', symbol: 'AAPL', period: '7w' }, 'period'],
		['finance.quote', { market: 'XX', type: 'stock', symbol: 'AAPL' }, 'market'],
		[
			'finance.quote',
			{ market: 'US', type: 'stock', symbol: 'AAPL', operation: 'history', frequency: '1h' },
			'frequency',
		],
		[
			'finance.quote',
			{ market: 'CN', type: 'stock', symbol: '600519.SH', adjustment: 'yesterday' },
			'adjustment',
		],
		[
			'finance.quote',
			{ market: 'CN', type: 'fund', symbol: '510300.SH', operation: 'nav', nav_type: 'total' },
			'nav_type',
		],
		[
			'finance.screen',
			{ market: 'US', type: 'stock', registration_country: 'ZZ' },
			'registration_country',
		],
		['finance.screen', { market: 'US', type: 'stock', sector: 'Tech' }, 'sector'],
		['finance.screen', { market: 'US', type: 'stock', market_cap: 'abc' }, 'market_cap'],
		[
			'finance.screen',
			{ market: 'US', type: 'stock', market_cap: '1e9..5e10..9e10' },
			'market_cap',
		],
		['finance.screen', { market: 'US', type: 'stock', pe: '0..30..50' }, 'pe'],
		['finance.screen', { market: 'US', type: 'stock', dividend_yield: '0..150' }, 'dividend_yield'],
		['finance.screen', { market: 'US', type: 'stock', roe: 'high' }, 'roe'],
		['finance.screen', { market: 'US', type: 'stock', sort: 'ticker' }, 'sort'],
		['finance.screen', { market: 'US', type: 'stock', page: '2.5' }, 'page'],
		[
			'finance.screen',
			{ market: 'US', type: 'stock', snapshot_date: '2026-11-32' },
			'snapshot_date',
		],
		['finance.calendar', { market: 'US', type: 'earnings', period: '180d' }, 'period'],
		['finance.calendar', { market: 'CN', type: 'earnings', period: '0d' }, 'period'],
		['finance.calendar', { market: 'US', type: 'earnings', date_type: 'record' }, 'date_type'],
		['finance.calendar', { market: 'CN', type: 'earnings', date_type: 'listing' }, 'date_type'],
		[
			'finance.calendar',
			{ market: 'CN', type: 'corporate_action', event_type: 'dividend' },
			'event_type',
		],
		['finance.calendar', { market: 'CN', type: 'trade_cal', exchange: 'NASDAQ' }, 'exchange'],
		[
			'finance.calendar',
			{ market: 'CN', type: 'earnings', report_period: '2026Q5' },
			'report_period',
		],
		[
			'finance.calendar',
			{ market: 'CN', type: 'earnings', report_period: '2026-05-15' },
			'report_period',
		],
		['finance.calendar', { market: 'US', type: 'economic', currency: 'US' }, 'currency'],
		[
			'finance.calendar',
			{ market: 'US', type: 'economic', date_range: '2026-11-20...2026-12-31' },
			'date_range',
		],
		['finance.calendar', { market: 'US', type: 'economic', date_range: '..' }, 'date_range'],
		[
			'finance.calendar',
			{ market: 'US', type: 'economic', date_range: '2026-13-01..2026-12-31' },
			'date_range',
		],
		['finance.calendar', { market: 'US', type: 'flash' }, 'type'],
		[
			'finance.fundamental',
			{ market: 'US', type: 'overview', symbol: 'AAPL', report_period: 'quarter' },
			'report_period',
		],
		[
			'finance.fundamental',
			{ market: 'US', type: 'ratings', symbol: 'AAPL', aggregation: 'average' },
			'aggregation',
		],
		[
			'finance.fundamental',
			{ market: 'US', type: 'estimates', symbol: 'AAPL', aggregation: 'individual' },
			'aggregation',
		],
		[
			'finance.fundamental',
			{ market: 'US', type: 'metrics', symbol: 'AAPL', metric_ids: 'pe ttm' },
			'metric_ids',
		],
		[
			'finance.fundamental',
			{ market: 'US', type: 'income', symbol: 'AAPL', selection: 'oldest' },
			'selection',
		],
		['finance.macro', { market: 'US', type: 'cpi', period: '5y' }, 'period'],
		['finance.macro', { market: 'US', type: 'cpi', measure: 'yoy' }, 'measure'],
		['finance.macro', { market: 'CN', type: 'cpi', measure: 'period' }, 'measure'],
		['finance.macro', { market: 'CN', type: 'lpr', tenor: '3m' }, 'tenor'],
		['finance.news', { market: 'CN', type: 'long_form', news_src: 'eastmoney' }, 'news_src'],
		['finance.news', { market: 'US', type: 'stock', content_scope: 'headline' }, 'content_scope'],
		[
			'finance.news',
			{ market: 'US', type: 'transcript', symbol: 'AAPL', report_period: '2026-Q3' },
			'report_period',
		],
		['finance.news', { market: 'US', type: 'flash' }, 'type'],
		['gaming.esports', { type: 'player', game_name: 'Faker#', region: 'kr' }, 'game_name'],
		['gaming.esports', { type: 'match_detail', match_id: 'invalid' }, 'match_id'],
		['gaming.esports', { type: 'player', game_name: 'Hide on Bush', region: 'kr' }, 'game_name'],
		[
			'gaming.esports',
			{ type: 'leaderboard', region: 'kr', tier: 'GOLD', division: 'V' },
			'division',
		],
		[
			'gaming.esports',
			{ type: 'mastery', game_name: 'Hide on Bush#KR1', region: 'kr', count: 2.5 },
			'count',
		],
		['gaming.store', { language: 'fr' }, 'language'],
		['gaming.store', { region: 'usa' }, 'region'],
		['social_media.social_media', { type: 'linkedin_feed' }, 'type'],
		['academic.paper', { year: '2019/2018' }, 'year'],
		['academic.person', { orcid: '0000-0002-1825-0098' }, 'orcid'],
		['legal.judicial', { judgment_date: '2023-02-29' }, 'judgment_date'],
		['security.threat_intel', { target: 'APT29', type: 'botnet' }, 'type'],
		['security.threat_intel', { target: '1.1.1.1', type: 'domain' }, 'target'],
		[
			'travel.flight',
			{ departure: 'PEK', arrival: 'SHA', date: '2027-01-10', cabin_class: 'UnknownClass' },
			'cabin_class',
		],
		[
			'travel.flight',
			{ departure: 'PEK', arrival: 'SHA', date: '2027-01-10', currency: 'US' },
			'currency',
		],
		[
			'travel.flight',
			{ departure: 'PEK', arrival: 'SHA', date: '2027-01-10', adults: -1 },
			'adults',
		],
		[
			'travel.flight',
			{ departure: 'PEK', arrival: 'SHA', date: '2027-01-10', max_stops: '2' },
			'max_stops',
		],
		['travel.flight', { departure: "Xi'an", arrival: 'Beijing', date: '2027-01-10' }, 'departure'],
		['travel.flight', { departure: 'PEK', arrival: 'SHA', date: '2027-02-29' }, 'date'],
		[
			'travel.flight',
			{ departure: 'PEK', arrival: 'SHA', date: '2027-01-10', return_date: '2027-01-05' },
			'return_date',
		],
		['travel.flight_status', { flight_number: 'CA981', departure: 'JFKK' }, 'departure'],
		[
			'travel.flight_status',
			{ flight_number: 'CA981', departure: 'PEK', date: '26/11/2026' },
			'date',
		],
		['travel.flight_status', { flight_number: 'China 981', departure: 'PEK' }, 'flight_number'],
		['academic.citation', { id: '', type: 'JournalArticle' }, 'type'],
		['academic.citation', { id: '', type: 'journal_article, preprint' }, 'type'],
		['academic.citation', { id: '', year: '23' }, 'year'],
		['academic.citation', { id: '', year: '2019/2018' }, 'year'],
		['academic.citation', { id: DOI, op: 'citations', filter: 'year:2020' }, 'filter'],
		['academic.citation', { id: DOI, op: 'citations', filter: 'creation:>2020,' }, 'filter'],
		['academic.citation', { id: DOI, op: 'citations', sort: 'creation:down' }, 'sort'],
		['academic.citation', { id: DOI, op: 'related' }, 'op'],
		['academic.dataset', { year: '20' }, 'year'],
		['academic.dataset', { resource_type: 'SoftwarePackage' }, 'resource_type'],
		['agriculture.stats', { item: 'Wheat', domain: 'crops' }, 'domain'],
		['agriculture.stats', { item: 'Wheat', year: '2024;' }, 'year'],
		['agriculture.stats', { item: 'Wheat', year: '20' }, 'year'],
		['code.snippet', { regex: 'yes' }, 'regex'],
	]) {
		assertFieldError(tag, field, params, 'test');
	}
});

test('documented formats accept every listed representation', () => {
	for (const [tag, params] of [
		[
			'academic.citation',
			{ id: DOI, op: 'citations', filter: 'creation:>2020,author_sc:no', sort: 'creation:desc' },
		],
		['academic.citation', { id: DOI, op: 'references', sort: 'citing:asc' }],
		['academic.citation', { id: '', op: 'metadata', type: 'journal_article,preprint' }],
		['academic.citation', { id: '', year: '2023' }],
		['academic.citation', { id: '', year: '2021-2023' }],
		['academic.citation', { id: '', year: '2021-' }],
		['academic.citation', { id: '', year: '-2023' }],
		['academic.dataset', { year: '2020' }],
		['academic.dataset', { year: '2020-2025' }],
		['academic.dataset', { year: '2020-' }],
		['academic.dataset', { year: '-2025' }],
		['academic.dataset', { resource_type: 'InteractiveResource' }],
		['academic.dataset', { resource_type: 'interactive-resource' }],
		['academic.dataset', { resource_type: 'output-management-plan' }],
		['agriculture.stats', { item: '15', year: '2020,2021,2022' }],
		['code.snippet', { regex: true }],
		['code.snippet', { regex: 'false' }],
		['finance.calendar', { market: 'US', type: 'economic', date_range: '2026-11-20..2026-12-31' }],
		['finance.calendar', { market: 'US', type: 'economic', date_range: '2026-11-20..' }],
		['finance.calendar', { market: 'US', type: 'economic', date_range: '..2026-12-31' }],
		['finance.calendar', { market: 'CN', type: 'earnings', period: '30d' }],
		['finance.calendar', { market: 'CN', type: 'earnings', report_period: '2026' }],
		['finance.calendar', { market: 'CN', type: 'earnings', report_period: '2026Q3' }],
		['finance.calendar', { market: 'CN', type: 'earnings', report_period: '2026-09-30' }],
		[
			'finance.fundamental',
			{ market: 'US', type: 'overview', symbol: 'AAPL', report_period: '2026-09-30' },
		],
		['finance.fundamental', { market: 'US', type: 'income', symbol: 'AAPL', report_basis: 'ttm' }],
		[
			'finance.fundamental',
			{ market: 'US', type: 'income', symbol: 'AAPL', report_basis: 'single_quarter' },
		],
		['finance.macro', { market: 'CN', type: 'shibor', tenor: 'on' }],
		['finance.macro', { market: 'CN', type: 'gdp', measure: 'period', period: '45d' }],
		[
			'finance.news',
			{ market: 'US', type: 'general', date_range: '2026-11-20T10:00:00Z..2026-11-27' },
		],
		['finance.news', { market: 'US', type: 'transcript', symbol: 'AAPL', report_period: '2026Q4' }],
		['finance.quote', { market: 'US', type: 'stock', symbol: 'AAPL', period: '1y' }],
		[
			'finance.quote',
			{ market: 'US', type: 'stock', symbol: 'AAPL', operation: 'history', frequency: '1mo' },
		],
		[
			'finance.quote',
			{
				market: 'US',
				type: 'stock',
				symbol: 'AAPL',
				operation: 'minute',
				date_range: '2026-11-25..',
			},
		],
		['finance.screen', { market: 'US', type: 'stock', market_cap: '-5e9..1e12' }],
		['finance.screen', { market: 'US', type: 'stock', pe: '10..' }],
		['finance.screen', { market: 'US', type: 'stock', roe: '..30' }],
		['finance.screen', { market: 'US', type: 'stock', page: 2 }],
		['finance.screen', { market: 'US', type: 'stock', sector: 'Consumer Staples' }],
		['travel.flight', { departure: 'New York', arrival: 'SFO', date: '15/06/2026' }],
		[
			'travel.flight',
			{ departure: 'PEK', arrival: 'SHA', date: '2026-06-15', currency: 'usd', adults: '2' },
		],
		['travel.flight', { departure: 'PEK', arrival: 'SHA', date: '2026-06-15', return_date: '' }],
		['travel.flight', { departure: 'PEK', arrival: 'SHA', date: '2026-06-15', max_stops: 1 }],
		['travel.flight_status', { flight_number: 'CA981', departure: 'PEK', date: '20261126' }],
		['travel.flight_status', { flight_number: 'CA981', departure: 'PEK', date: '2026/11/26' }],
		['travel.flight_status', { flight_number: 'CA981', departure: 'pek' }],
		['security.asset', { target: 'https://example.com/path' }],
		['security.asset', { target: '2001:db8::1' }],
		['security.malware', { ioc: 'd41d8cd98f00b204e9800998ecf8427e' }],
		['security.threat_intel', { target: 'T1566' }],
		['security.threat_intel', { target: 'S0002', type: 'software' }],
		['security.threat_intel', { target: 'https://example.com/path', type: 'url' }],
		[
			'gaming.esports',
			{ type: 'leaderboard', region: 'kr', tier: 'GOLD', division: 'II', queue: 'RANKED_FLEX_SR' },
		],
		[
			'gaming.esports',
			{
				type: 'mastery',
				game_name: 'Hide on Bush#KR1',
				region: 'kr',
				champion: 'Yasuo',
				count: '3',
			},
		],
		['gaming.esports', { type: 'player', region: 'kr' }],
		['gaming.store', { language: 'ja', region: 'JP' }],
	]) {
		assert.deepEqual(
			capabilityParameters(node, tag, params, 'test'),
			params,
			tag + ' ' + JSON.stringify(params),
		);
	}
});

test('conditions stated in field descriptions are enforced', () => {
	for (const [tag, params, message] of [
		[
			'finance.quote',
			{ market: 'US', type: 'stock' },
			/Provide symbol for security-level quote operations/,
		],
		[
			'finance.quote',
			{ market: 'US', type: 'forex', symbol: 'EURUSD' },
			/type forex supports market GLOBAL only/,
		],
		[
			'finance.fundamental',
			{ market: 'US', type: 'income', symbol: 'AAPL', selection: 'report_end_date' },
			/Provide report_period when selection is report_end_date/,
		],
		[
			'finance.fundamental',
			{ market: 'CN', type: 'regulatory_filing', symbol: '600519.SH' },
			/type regulatory_filing supports market US only/,
		],
		[
			'finance.calendar',
			{ market: 'CN', type: 'corporate_action' },
			/Provide event_type when type is corporate_action/,
		],
		[
			'finance.calendar',
			{ market: 'CN', type: 'trade_cal' },
			/Provide exchange when type is trade_cal/,
		],
		[
			'finance.calendar',
			{ market: 'US', type: 'forecast' },
			/type forecast supports market CN only/,
		],
		['finance.macro', { market: 'US', type: 'pmi' }, /type pmi supports market CN only/],
		['finance.macro', { market: 'CN', type: 'nonfarm' }, /type nonfarm supports market US only/],
		['finance.news', { market: 'US', type: 'stock' }, /Provide symbol when type is stock/],
		[
			'finance.news',
			{ market: 'US', type: 'transcript', symbol: 'AAPL' },
			/Provide report_period when type is transcript/,
		],
		[
			'finance.news',
			{ market: 'CN', type: 'general' },
			/type general supports market US, GLOBAL only/,
		],
		[
			'finance.screen',
			{ market: 'US', type: 'index_weight' },
			/type index_weight supports market CN only/,
		],
		[
			'finance.screen',
			{ market: 'CN', type: 'index_weight' },
			/Provide symbol when type is index_weight/,
		],
		[
			'academic.citation',
			{ id: DOI, year: '2021' },
			/Use type and year only for metadata keyword search with id empty/,
		],
		[
			'academic.citation',
			{ id: DOI, type: 'preprint' },
			/Use type and year only for metadata keyword search with id empty/,
		],
		[
			'academic.citation',
			{ id: DOI, filter: 'creation:>2020' },
			/Use filter and sort only with op citations or references/,
		],
		[
			'academic.citation',
			{ id: DOI, op: 'metadata', sort: 'creation:desc' },
			/Use filter and sort only with op citations or references/,
		],
		['gaming.esports', { type: 'player' }, /Provide region for gaming.esports type player/],
		[
			'gaming.esports',
			{ type: 'leaderboard', region: 'kr', division: 'II' },
			/Use division only with a leaderboard tier from DIAMOND to IRON/,
		],
		[
			'gaming.esports',
			{ type: 'leaderboard', region: 'kr', tier: 'MASTER', division: 'I' },
			/Use division only with a leaderboard tier from DIAMOND to IRON/,
		],
	]) {
		assertRequestError(tag, params, 'test', message);
	}
});

test('explicit identifier standards and submission limits drive validation', () => {
	for (const [tag, params] of [
		['academic.paper', { doi: '10.1234/Research data', language: 'he' }],
		['legal.enforcement', { currency: 'XCG' }],
	]) {
		assert.deepEqual(capabilityParameters(node, tag, params, 'test'), params);
	}
	assertFieldError('academic.paper', 'language', { language: 'iw' }, 'test');
	assertFieldError('academic.paper', 'doi', { doi: '10.1234/Research\tdata' }, 'test');
	assertFieldError('legal.enforcement', 'currency', { currency: 'CNH' }, 'test');
	const tooMany = Array(6).fill('CVE-2021-44228').join(',');
	assertFieldError('security.vuln', 'value', { type: 'cve', value: tooMany }, tooMany);
});

test('citation identifiers follow the support listed for each operation', () => {
	for (const [op, id] of [
		[undefined, '10.1038/s41586-021-03819-2'],
		['metadata', '10.1038/s41586-021-03819-2'],
		['metadata', '32033602'],
		['metadata', '0138-9130'],
		['metadata', '9781402096327'],
		['metadata', '0-306-40615-2'],
		['metadata', '0-8044-2957-X'],
		['metadata', '0000-0002-1825-0097'],
		['metadata', 'br/06101801781'],
		['metadata', 'ra/06250110138'],
		['metadata', 'br/060/1'],
		['citations', 'br/06101801781'],
		['references', '32033602'],
		['citation-count', 'br/060/1'],
		['reference-count', '0138-9130'],
		['author', '0000-0002-1825-0097'],
		['editor', 'ra/06250110138'],
		['venue-citation-count', '0138-9130'],
		['citation', '020011020023310019-020011020023310019'],
	]) {
		const params = { id, ...(op ? { op } : {}) };
		assert.deepEqual(capabilityParameters(node, 'academic.citation', params, id), params);
	}
	for (const [op, id] of [
		['metadata', '9781402096328'],
		['metadata', '0-306-40615-3'],
		['metadata', '4006381333931'],
		['metadata', '9790060115615'],
		['metadata', '0138-9131'],
		['metadata', '0000-0000'],
		['metadata', 'fake/1/2'],
		['metadata', 'br/060/1/2'],
		['author', '0000-0002-1825-0098'],
		['author', '10.1038/s41586-021-03819-2'],
		['citations', '0138-9130'],
		['citations', '0000-0002-1825-0097'],
		['citations', ''],
		['venue-citation-count', '10.1038/s41586-021-03819-2'],
		['citation', '10.1038/s41586-021-03819-2'],
	]) {
		assertFieldError('academic.citation', 'id', { id, op }, id);
	}
});

test('a citation keyword search needs no identifier and a structured operation needs one', () => {
	for (const params of [{ op: 'metadata' }, { type: 'preprint', year: '2021' }]) {
		assert.deepEqual(capabilityParameters(node, 'academic.citation', params, 'preprints'), params);
	}
	assertFieldError(
		'academic.citation',
		'type',
		{ type: 'preprint', id: '10.1038/s41586-021-03819-2' },
		'preprint',
	);
	for (const op of ['citations', 'references', 'author', 'citation']) {
		assertRequestError(
			'academic.citation',
			{ op },
			op,
			new RegExp('Provide id for op ' + op + '\\.'),
		);
	}
});

test('air quality locations are a place name or up to three coordinate pairs', () => {
	for (const location of [
		'Beijing',
		'Beijing,Shanghai',
		'38.9,-77.0',
		'38.9, -77.0; 40.1,-73.9 and 51.5,-0.12',
		'Beijing;38.9',
	]) {
		const params = { location };
		assert.deepEqual(capabilityParameters(node, 'environment.aqi', params, location), params);
	}
	for (const location of ['', '38.9', '38.9,-77.0,120', '1,2,3,4', '91,10', '38.9,181']) {
		assertFieldError('environment.aqi', 'location', { location }, 'air quality');
	}
});

test('image lookups choose the asset or discover mode', () => {
	for (const type of ['asset', 'discover']) {
		const params = { type };
		assert.deepEqual(capabilityParameters(node, 'resource.image', params, 'Eiffel Tower'), params);
	}
	assertFieldError('resource.image', 'type', { type: 'gallery' }, 'Eiffel Tower');
});

test('legislation titles accept any provider title or CFR title number', () => {
	const tag = 'legal.legislation';
	for (const title of [1, 51, 55, '40', 'Clean Air Act', ' 51 ']) {
		const params = { jurisdiction: 'US', collection: 'CFR', title };
		assert.deepEqual(capabilityParameters(node, tag, params, 'CFR'), params);
	}
	for (const title of [0, 1.5, -1, '   ', '']) {
		assertFieldError(tag, 'title', { jurisdiction: 'US', collection: 'CFR', title }, 'CFR');
	}
});

test('provider date examples reject impossible calendar values and preserve other representations', () => {
	for (const [tag, field, type, invalid, valid] of [
		['energy.electricity', 'date_start', 'EUElectricity', '2026-02-30', '2026-05-23'],
		['energy.electricity', 'date_end', 'EUElectricity', '2026-13-01', '2026-05-24'],
		['energy.production', 'date_start', 'USEnergyData', '2026-13', '2023-01'],
		['ip.global', 'date_start', 'GlobalPatent', '20260229', '20240229'],
	]) {
		assertFieldError(tag, field, { type, [field]: invalid }, 'test');
		for (const date of [valid, '2020', '2024-02-29', '2026-Q1']) {
			const params = { type, [field]: date };
			assert.deepEqual(capabilityParameters(node, tag, params, 'test'), params);
		}
	}
});

test('removed catalog fields are rejected instead of being rewritten', () => {
	for (const [tag, params] of [
		['finance.calendar', { type: 'earnings', cn_code: '600519.SH' }],
		['finance.fundamental', { market: 'CN', type: 'income', symbol: '600519.SH', cn_code: '' }],
		['finance.quote', { market: 'CN', type: 'stock', symbol: '600519.SH', cn_code: '600519.SH' }],
		['finance.news', { market: 'CN', type: 'long_form', cn_code: '600519.SH' }],
		['finance.screen', { market: 'US', type: 'stock', country: 'US' }],
		['travel.flight', { departure: 'PEK', arrival: 'SHA', date: '2026-06-15', origin: 'PEK' }],
		['travel.flight_status', { flight_number: 'CA981', departure: 'PEK', type: 'FlightStatus' }],
		['academic.citation', { id: DOI, id_type: 'doi' }],
	]) {
		assertRequestError(tag, params, 'test', new RegExp(`Unsupported parameters for ${tag}\\.`));
	}
	// Without the removed departure default, a flight number alone is incomplete.
	assertRequestError(
		'travel.flight_status',
		{ flight_number: 'CA981' },
		'CA981',
		/Provide required parameters for travel\.flight_status: departure\./,
	);
});

test('electricity date filters are passed to the provider without imposing their order', () => {
	const tag = 'energy.electricity';
	const type = 'EUElectricity';
	for (const [date_start, date_end] of [
		['2026-05-24', '2026-05-23'],
		['20260525', '2026-05-23'],
		['2027-01', '2026'],
		['2026-05-24', '2026-05-24'],
		['2026-05-24', '2026'],
		['2026', '2026-01-01'],
		['2026-12', '2027'],
		['2026-Q1', '2026-01'],
	]) {
		const params = { type, date_start, date_end };
		assert.deepEqual(capabilityParameters(node, tag, params, 'test'), params);
	}
});
