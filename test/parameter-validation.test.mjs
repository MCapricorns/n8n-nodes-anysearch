import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { catalogCoverage } from './e2e/catalog-checks.mjs';

const require = createRequire(import.meta.url);
const { capabilityParameters } = require('../dist/nodes/AnySearch/capabilityParameters.js');
const { tags } = require('../dist/nodes/AnySearch/catalog.json');
const cases = require('./e2e/search-cases.json');

const node = {
	id: 'parameter-validation',
	name: 'AnySearch',
	type: 'n8n-nodes-anysearch.anySearch',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

function expectedOverrides(tag, params) {
	if (tag === 'finance.calendar' && params?.type === 'earnings' && params.period === undefined) {
		return { period: '90d' };
	}
	if (tag === 'finance.fundamental' && params?.type === 'overview') return { cn_code: '' };
	if (tag === 'finance.fundamental') return { symbol: '' };
	return {};
}

function assertFieldError(tag, field, params, query) {
	assert.throws(() => capabilityParameters(node, tag, params, query), {
		name: 'NodeOperationError',
		message: new RegExp(`\\b${field}\\b`, 'i'),
	});
}

test('the compiled validator accepts all positive fixtures, covers the catalog, and leaves inputs intact', () => {
	const outputs = cases.map(({ tag, query, params }) => {
		const input = Object.freeze(structuredClone(params));
		const result = capabilityParameters(node, tag, input, query);
		const expected =
			params === undefined ? undefined : { ...params, ...expectedOverrides(tag, params) };
		assert.deepEqual(result, expected, tag);
		assert.deepEqual(input, params, tag);
		return { tag, params: result };
	});
	const { missing, unexpected } = catalogCoverage(outputs, tags);
	assert.deepEqual(missing, []);
	assert.deepEqual(unexpected, []);
});

test('catalog fields reject objects and arrays unless the node replaces that field with a documented value', () => {
	const failures = new Set();
	for (const { tag, query, params } of cases) {
		const overrides = expectedOverrides(tag, params);
		for (const field of Object.keys(params ?? {})) {
			for (const [kind, value] of [
				['object', Object.freeze({ invalid: true })],
				['array', Object.freeze(['invalid'])],
			]) {
				const input = Object.freeze({ ...params, [field]: value });
				try {
					if (Object.hasOwn(overrides, field)) {
						assert.deepEqual(capabilityParameters(node, tag, input, query), {
							...params,
							...overrides,
						});
					} else {
						assertFieldError(tag, field, input, query);
					}
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
	for (const [tag, field, value] of [
		['business.trade', 'hs_code', '847'],
		['energy.electricity', 'metric', 'invalid_metric'],
		['energy.production', 'frequency', 'fortnightly'],
		['finance.quote', 'period', '0d'],
		['finance.screen', 'country', 'ZZ'],
		['gaming.esports', 'game_name', 'Faker#'],
		['gaming.esports', 'match_id', 'invalid'],
		['social_media.social_media', 'type', 'linkedin_feed'],
		['academic.paper', 'year', '2019-2018'],
		['academic.person', 'orcid', '0000-0002-1825-0098'],
		['legal.judicial', 'judgment_date', '2023-02-29'],
		['security.intel', 'ioc', 'not an indicator at all'],
		['travel.flight', 'cabin_class', 'UnknownClass'],
		['travel.flight_status', 'departure', 'JFKK'],
	]) {
		const sample = cases.find(
			(entry) => entry.tag === tag && Object.hasOwn(entry.params ?? {}, field),
		);
		assert(sample, `${tag}.${field} must have a positive fixture`);
		assertFieldError(tag, field, { ...sample.params, [field]: value }, sample.query);
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

test('academic citation identifiers and CFR title numbers follow published standards', () => {
	for (const [id_type, id] of [
		['isbn', '9781402096327'],
		['isbn', '0-306-40615-2'],
		['isbn', '0-8044-2957-X'],
		['issn', '0138-9130'],
		['issn', '0378-5955'],
		['omid', 'br/06101801781'],
		['omid', 'ra/06250110138'],
		['omid', 'br/060/1'],
	]) {
		const params = { id_type, id };
		assert.deepEqual(capabilityParameters(node, 'academic.citation', params, id), params);
	}
	for (const [id_type, id] of [
		['isbn', '9781402096328'],
		['isbn', '0-306-40615-3'],
		['isbn', '4006381333931'],
		['isbn', '9790060115615'],
		['issn', '0138-9131'],
		['omid', 'fake/1/2'],
		['omid', 'br/060/1/2'],
	]) {
		assertFieldError('academic.citation', 'id', { id_type, id }, id);
	}
	const tag = 'legal.legislation';
	for (const title of [1, '50']) {
		const params = { jurisdiction: 'US', collection: 'CFR', title };
		assert.deepEqual(capabilityParameters(node, tag, params, 'CFR'), params);
	}
	for (const title of [0, 51, ' 51 ', '-1']) {
		assertFieldError(tag, 'title', { jurisdiction: 'US', collection: 'CFR', title }, 'CFR');
	}
	const params = { jurisdiction: 'US', collection: 'USCODE', title: 51 };
	assert.deepEqual(capabilityParameters(node, tag, params, 'US code'), params);
});

test('documented defaults add or replace the fields needed in outbound requests', () => {
	for (const [tag, query, params, expected] of [
		[
			'travel.flight_status',
			'CA981 flight status',
			{ flight_number: 'CA981' },
			{ flight_number: 'CA981', departure: '' },
		],
		[
			'finance.fundamental',
			'Apple fundamentals',
			{ type: 'overview' },
			{ type: 'overview', symbol: '', cn_code: '' },
		],
		[
			'finance.fundamental',
			'贵州茅台 利润表',
			{ type: 'income', cn_code: '600519.SH', symbol: ['unused'] },
			{ type: 'income', cn_code: '600519.SH', symbol: '' },
		],
	]) {
		const input = Object.freeze(structuredClone(params));
		assert.deepEqual(capabilityParameters(node, tag, input, query), expected, tag);
		assert.deepEqual(input, params, tag);
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

test('A-share identifiers are checked only for operations that use them', () => {
	for (const [tag, type] of [
		['finance.calendar', 'earnings'],
		['finance.fundamental', 'income'],
		['finance.news', 'announcement'],
	]) {
		for (const cn_code of ['not-a-ticker', 'not a ticker 1', '??1??', '600519..SH', 'SH:']) {
			assertFieldError(tag, 'cn_code', { type, cn_code }, 'test');
		}
		for (const cn_code of ['600519.SH', '600519', 'BJ.920002', 'SSE:600519', 'SH600519']) {
			const params = { type, cn_code };
			assert.deepEqual(capabilityParameters(node, tag, params, 'test'), {
				...params,
				...expectedOverrides(tag, params),
			});
		}
	}
	for (const [tag, params] of [
		['finance.calendar', { type: 'earnings', cn_code: '' }],
		['finance.news', { type: 'announcement', cn_code: '' }],
		['finance.fundamental', { type: 'overview', symbol: 'AAPL', cn_code: 'unused' }],
		['finance.quote', { type: 'forex', cn_code: 'USDCNH.FXCM' }],
	]) {
		assert.deepEqual(capabilityParameters(node, tag, params, 'test'), {
			...params,
			...expectedOverrides(tag, params),
		});
	}
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
