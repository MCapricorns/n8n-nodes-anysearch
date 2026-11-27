import type { CapabilityRuleMap, FieldRule } from './parameterRules';
import { choice, dateValue, format, integer } from './parameterRules';

const airport = format(/^[a-z]{3}$/i, 'a three-letter IATA airport code');
const flightCurrency = format(/^[a-z]{3}$/i, 'a three-letter currency code such as USD or CNY');
const count = integer(0);
const flightDate = dateValue('DD/MM/YYYY', 'YYYY-MM-DD');

const dnsName =
	/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.?$/i;
const urlScheme = /^[a-z][a-z\d+.-]*:\/\//i;
const ipv6Candidate = /^[a-f\d.]*:[a-f\d.]*:[a-f\d:.]*$/i;

function isIntelHash(value: string): boolean {
	// Intel leaves hash algorithms open, including digests with an algorithm prefix.
	if (!/^[a-z\d+/_-]+(?::[a-z\d+/_-]+)*={0,2}$/i.test(value)) return false;
	const digest = value.slice(value.lastIndexOf(':') + 1);
	if (urlScheme.test(value)) {
		// A prefixed Base64 digest may start with "//". Keep special URL schemes on the URL path.
		if (/^(?:ftp|file|https?|wss?):/i.test(value)) return false;
		const encoded = Buffer.from(digest, 'base64').toString('base64');
		return digest === encoded || digest === encoded.replace(/=+$/, '');
	}
	if (/[a-z\d]/i.test(digest)) return true;
	// Symbols alone can encode bytes in Base64 or Base64url only in complete quartets.
	return /^(?:(?:[+/]{4})+|(?:[-_]{4})+)$/.test(digest);
}

function isIPv4(value: string): boolean {
	const octets = value.split('.');
	return (
		octets.length === 4 &&
		octets.every((octet) => /^(?:0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)
	);
}

function isNetworkIndicator(value: string): boolean {
	if (isIPv4(value)) return true;
	const hasScheme = urlScheme.test(value);
	const isHostName = !/[\s:/\\?#@%]/.test(value);
	const isIPv6Candidate = ipv6Candidate.test(value);
	if (!hasScheme && !isHostName && !isIPv6Candidate) return false;
	try {
		const authority = isIPv6Candidate ? `[${value}]` : value;
		const { hostname } = new URL(hasScheme ? value : `https://${authority}`);
		if (isIPv6Candidate) return hostname.startsWith('[');
		if (hasScheme)
			return hostname.startsWith('[') || (/[a-z\d]/i.test(hostname) && !/[,;]/.test(hostname));
		return dnsName.test(hostname) && !isIPv4(hostname);
	} catch {
		return false;
	}
}

function indicator(isHash: (value: string) => boolean, expected: string): FieldRule {
	return {
		matches: (value) =>
			typeof value === 'string' &&
			!/[\s\p{Cc}]/u.test(value) &&
			((!ipv6Candidate.test(value) && isHash(value)) || isNetworkIndicator(value)),
		expected,
	};
}

const packageRegistries = new Set([
	'npm',
	'PyPI',
	'Maven',
	'NuGet',
	'RubyGems',
	'crates.io',
	'Go',
	'Packagist',
	'Hex',
	'Pub',
	'CRAN',
]);
const knownEcosystems = new Set(
	[...packageRegistries, 'Debian', 'Alpine'].map((ecosystem) => ecosystem.toLowerCase()),
);

function packageIdentifier(value: string): boolean {
	const version = value.lastIndexOf('@');
	if (version < 0 || !/^[^\s@,]+$/.test(value.slice(version + 1))) return false;
	const [ecosystem, ...nameParts] = value.slice(0, version).split(':');
	if (!nameParts.every((part) => /^[^\s,]+$/.test(part))) return false;
	if (ecosystem === 'npm')
		return nameParts.length === 1 && /^(?:@[^@/]+\/)?[^@/]+$/.test(nameParts[0]);
	if (nameParts.some((part) => part.includes('@'))) return false;
	if (ecosystem === 'Maven') return nameParts.length === 2;
	if (packageRegistries.has(ecosystem)) return nameParts.length === 1;
	if (ecosystem === 'Debian' || ecosystem === 'Alpine') {
		return nameParts.length === 1 || nameParts.length === 2;
	}
	// Release-qualified OS names are open-ended. Registry spelling is still case-sensitive.
	return (
		/^[a-z\d][a-z\d .-]*$/i.test(ecosystem) &&
		!knownEcosystems.has(ecosystem.toLowerCase()) &&
		nameParts.length === 2
	);
}

const cveId = /^CVE-\d{4}-\d{4,}$/i;
const commitId = /^[a-f\d]{40}$/i;

function identifiers(value: string, type: unknown): string[] {
	return value.split(',').map((entry) => {
		const identifier = entry.trim();
		return type === 'package' ? identifier : identifier.toLowerCase();
	});
}

const vulnerabilityValue: FieldRule = {
	matches: (value, params) => {
		if (typeof value !== 'string') return false;
		const { type } = params;
		const values = identifiers(value, type);
		if (type === 'cve') return values.length <= 5 && values.every((id) => cveId.test(id));
		if (type === 'commit') return values.every((id) => commitId.test(id));
		if (type === 'package') return values.length <= 1000 && values.every(packageIdentifier);
		return false;
	},
	expected: 'identifiers matching type, with up to 5 CVEs or 1000 packages',
};

export const technicalParameterRules: CapabilityRuleMap = {
	'security.intel': {
		fields: { ioc: indicator(isIntelHash, 'a single domain, IP address, URL, or file hash') },
	},
	'security.noise': {
		fields: {
			ip: {
				matches: (value) => typeof value === 'string' && isIPv4(value),
				expected: 'a single IPv4 address',
			},
		},
	},
	'security.scan': {
		fields: {
			ioc: indicator(
				(value) => /^(?:[a-f\d]{32}|[a-f\d]{40}|[a-f\d]{64})$/i.test(value),
				'a domain, IP address, URL, or MD5, SHA1, or SHA256 hash',
			),
		},
	},
	'security.vuln': {
		fields: { type: choice('cve', 'commit', 'package'), value: vulnerabilityValue },
		check: (params, query) => {
			if (typeof params.value !== 'string') return undefined;
			const expected = new Set(identifiers(params.value, params.type));
			const requested = new Set(identifiers(query, params.type));
			if (requested.size !== expected.size || [...requested].some((id) => !expected.has(id))) {
				return 'query must use the same identifiers as params.value';
			}
			return undefined;
		},
	},
	'travel.flight': {
		fields: {
			adults: count,
			arrival: airport,
			cabin_class: choice('Economy', 'Business', 'First', 'PremiumEconomy'),
			children: count,
			currency: flightCurrency,
			date: flightDate,
			departure: airport,
			infants: count,
			return_date: flightDate,
			type: choice('FlightSearch'),
		},
	},
	'travel.flight_status': {
		fields: {
			date: dateValue('YYYY-MM-DD'),
			departure: airport,
			flight_number: format(/^(?:[a-z][a-z\d]|\d[a-z]) ?\d{1,4}[a-z]?$/i, 'an IATA flight number'),
			type: choice('FlightStatus'),
		},
	},
};
