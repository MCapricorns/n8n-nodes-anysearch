// Compare the bundled catalog and the matrix with the live directory. Discovery uses no quota.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
	catalogCoverage,
	catalogDefinitions,
	changedDefinitions,
	discoverCatalog,
} from '../test/e2e/catalog-checks.mjs';

const { domains } = await discoverCatalog();
const live = catalogDefinitions(domains);
const { tags: reviewed } = JSON.parse(
	await readFile(new URL('../nodes/AnySearch/catalog.json', import.meta.url)),
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
