// Rewrite nodes/AnySearch/catalog.json from the live directory, then align the node with it
// (see AGENTS.md). Discovery is public and uses no search quota. Usage: npm run catalog:sync
import { readFile, writeFile } from 'node:fs/promises';
import { catalogDefinitions, discoverCatalog } from '../test/e2e/catalog-checks.mjs';

const file = new URL('../nodes/AnySearch/catalog.json', import.meta.url);
const { reviewed } = JSON.parse(await readFile(file, 'utf8'));
const { topologyVersion, domains } = await discoverCatalog();
const live = catalogDefinitions(domains);
// Alphabetical order keeps the file diffable while the directory keeps moving.
const tags = {};
for (const tag of Object.keys(live).sort()) {
	tags[tag] = {};
	for (const field of Object.keys(live[tag]).sort()) tags[tag][field] = live[tag][field];
}
const fields = Object.values(tags).flatMap((tag) => Object.values(tag));
const summary = {
	topology_version: topologyVersion,
	tags: Object.keys(tags).length,
	fields: fields.length,
	required: fields.filter((field) => field.required).length,
};
await writeFile(
	file,
	JSON.stringify(
		{
			reviewed: new Date().toISOString().slice(0, 10),
			source: 'https://api.anysearch.com/v1/sub-domains',
			topology_version: topologyVersion,
			tags,
		},
		null,
		2,
	) + '\n',
);
console.log(
	`Wrote nodes/AnySearch/catalog.json: topology ${summary.topology_version}, ${summary.tags} tags, ${summary.fields} fields, ${summary.required} required`,
);
