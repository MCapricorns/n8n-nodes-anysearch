import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

export function catalogDefinitions(domains) {
	const tags = {};
	for (const { sub_domains } of domains) {
		for (const { sub_domain, params = {} } of sub_domains) {
			assert(!Object.hasOwn(tags, sub_domain), 'Duplicate tag ' + sub_domain);
			tags[sub_domain] = Object.fromEntries(
				Object.entries(params).map(([field, { required, description, sort_order }]) => {
					assert.equal(typeof required, 'boolean', sub_domain + '.' + field);
					assert.equal(typeof description, 'string', sub_domain + '.' + field);
					assert(
						sort_order === undefined || Number.isInteger(sort_order),
						sub_domain + '.' + field,
					);
					return [field, { required, description }];
				}),
			);
		}
	}
	return tags;
}

export function changedDefinitions(reviewed, live) {
	const changed = [];
	for (const tag of new Set([...Object.keys(reviewed), ...Object.keys(live)])) {
		if (!reviewed[tag] || !live[tag]) {
			changed.push(tag);
			continue;
		}
		for (const field of new Set([...Object.keys(reviewed[tag]), ...Object.keys(live[tag])])) {
			if (!isDeepStrictEqual(reviewed[tag][field], live[tag][field]))
				changed.push(tag + '.' + field);
		}
	}
	return changed;
}

// Count fields from actual matrix requests, including tags that have no parameters.
export function catalogCoverage(bodies, tags) {
	const seen = new Map();
	const unexpected = new Set();
	for (const { tag, params = {} } of bodies) {
		if (!tag) continue;
		if (!Object.hasOwn(tags, tag)) unexpected.add(tag);
		const fields = seen.get(tag) ?? new Set();
		for (const field of Object.keys(params)) {
			if (!Object.hasOwn(tags[tag] ?? {}, field)) unexpected.add(tag + '.' + field);
			fields.add(field);
		}
		seen.set(tag, fields);
	}
	const missing = [];
	let parameters = 0;
	for (const [tag, fields] of Object.entries(tags)) {
		if (!seen.has(tag)) missing.push(tag);
		for (const field of Object.keys(fields)) {
			parameters++;
			if (!seen.get(tag)?.has(field)) missing.push(tag + '.' + field);
		}
	}
	return {
		requests: bodies.length,
		tags: Object.keys(tags).length,
		parameters,
		missing,
		unexpected: [...unexpected],
	};
}
