const { createHash } = require('node:crypto');

function searchOutputDigest(results, metadata) {
	const canonical = JSON.stringify({ results, metadata: metadata ?? {} }, (_key, value) => {
		if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, value[key]]),
		);
	});
	return createHash('sha256').update(canonical).digest('hex');
}

module.exports = { searchOutputDigest };
