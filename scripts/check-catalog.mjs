// Capability discovery is public and does not use search quota.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
	catalogCoverage,
	catalogDefinitions,
	changedDefinitions,
} from '../test/e2e/catalog-checks.mjs';

async function discover(path) {
	const response = await fetch('https://api.anysearch.com' + path, {
		signal: AbortSignal.timeout(30_000),
	});
	assert(response.ok, 'Capability discovery returned HTTP ' + response.status);
	const envelope = await response.json();
	assert.equal(envelope.code, 0, 'Capability discovery failed');
	assert(
		Array.isArray(envelope.data?.domains) && envelope.data.domains.length > 0,
		'Empty domain catalog',
	);
	return envelope.data.domains;
}

const listed = (await discover('/v1/domains')).map(({ domain }) => domain);
const query = new URLSearchParams(listed.map((domain) => ['domain', domain]));
const domains = await discover('/v1/sub-domains?' + query);
assert.deepEqual(domains.map(({ domain }) => domain).sort(), listed.sort());
const live = catalogDefinitions(domains);
const { tags: reviewed } = JSON.parse(
	await readFile(new URL('../test/e2e/catalog.json', import.meta.url)),
);
const cases = JSON.parse(await readFile(new URL('../test/e2e/search-cases.json', import.meta.url)));
const coverage = catalogCoverage(cases, live);
const changed = changedDefinitions(reviewed, live);
console.log(JSON.stringify({ domains: domains.length, ...coverage, changed }, null, 2));
assert.deepEqual(
	changed,
	[],
	'Review updated field descriptions, required flags and node behavior before refreshing catalog.json',
);
assert.deepEqual(coverage.missing, [], 'Live catalog fields missing from the matrix');
assert.deepEqual(coverage.unexpected, [], 'Matrix still uses fields outside the live catalog');
