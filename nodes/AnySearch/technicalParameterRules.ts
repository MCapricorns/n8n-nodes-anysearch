import type { IDataObject } from 'n8n-workflow';
import type { CapabilityRuleMap, FieldRule } from './parameterRules';
import { anyCaseCurrency, choice, dateValue, format, integer, wholeNumber } from './parameterRules';

const airport = format(/^[a-z]{3}$/i, 'a three-letter IATA airport code');
// "IATA 3-letter airport or city code … or a city name"; names with an apostrophe do not resolve.
const location = format(
	/^(?:[a-z]{3}|\p{L}+(?:[ -]\p{L}+)*)$/iu,
	'a three-letter IATA airport or city code, or a city name',
);
const count = integer(0);
const flightDate = dateValue('DD/MM/YYYY', 'YYYY-MM-DD');
const flightNumber = format(/^(?:[a-z][a-z\d]|\d[a-z]) ?\d{1,4}[a-z]?$/i, 'an IATA flight number');

// "return date, empty = one-way; must not be earlier than date"
function dayNumber(value: string): number {
	return Number(
		value.includes('/') ? value.split('/').reverse().join('') : value.replace(/\D/g, ''),
	);
}
function checkFlight({ date, return_date }: IDataObject): string | undefined {
	if (typeof date !== 'string' || typeof return_date !== 'string' || return_date === '')
		return undefined;
	return dayNumber(return_date) < dayNumber(date)
		? 'return_date must not be earlier than date.'
		: undefined;
}

const dnsName =
	/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.?$/i;
const urlScheme = /^[a-z][a-z\d+.-]*:\/\//i;
const ipv6Candidate = /^[a-f\d.]*:[a-f\d.]*:[a-f\d:.]*$/i;

function isIPv4(value: string): boolean {
	const octets = value.split('.');
	return (
		octets.length === 4 &&
		octets.every((octet) => /^(?:0|[1-9]\d{0,2})$/.test(octet) && Number(octet) <= 255)
	);
}

function isIPv6(value: string): boolean {
	if (!ipv6Candidate.test(value)) return false;
	try {
		return new URL(`https://[${value}]`).hostname.startsWith('[');
	} catch {
		return false;
	}
}

function isDomain(value: string): boolean {
	if (/[\s:/\\?#@%]/.test(value)) return false;
	try {
		const { hostname } = new URL(`https://${value}`);
		// The DNS length includes a byte for each label length and one for the root.
		return hostname.replace(/\.$/, '').length <= 253 && dnsName.test(hostname) && !isIPv4(hostname);
	} catch {
		return false;
	}
}

function isUrl(value: string): boolean {
	if (!urlScheme.test(value)) return false;
	try {
		return new URL(value).hostname !== '';
	} catch {
		return false;
	}
}

function isNetworkIndicator(value: string): boolean {
	if (isIPv4(value)) return true;
	const hasScheme = urlScheme.test(value);
	const isHostName = !/[\s:/\\?#@%]/.test(value);
	const isIPv6Candidate = ipv6Candidate.test(value);
	if (!hasScheme && !isHostName && !isIPv6Candidate) return false;
	try {
		// The URL parser converts internationalized domain names to ASCII.
		const authority = isIPv6Candidate ? `[${value}]` : value;
		const { hostname } = new URL(hasScheme ? value : `https://${authority}`);
		if (isIPv6Candidate) return hostname.startsWith('[');
		if (hasScheme)
			return hostname.startsWith('[') || (/[a-z\d]/i.test(hostname) && !/[,;]/.test(hostname));
		const bare = hostname.replace(/\.$/, '');
		return (
			// The DNS length includes a byte for each label length and one for the root.
			bare.length <= 253 &&
			dnsName.test(hostname) &&
			!isIPv4(bare) &&
			!/^\d+(?:\.\d+){3}$/.test(bare)
		);
	} catch {
		return false;
	}
}

const hash = (value: string) => /^(?:[a-f\d]{32}|[a-f\d]{40}|[a-f\d]{64})$/i.test(value);

function indicator(isHash: (value: string) => boolean, expected: string): FieldRule {
	return {
		matches: (value) =>
			typeof value === 'string' &&
			!/[\s\p{Cc}]/u.test(value) &&
			((!ipv6Candidate.test(value) && isHash(value)) || isNetworkIndicator(value)),
		expected,
	};
}

// "Optional subject type: ip / domain / url / hash / actor / technique / software / campaign."
const subjectTypes: Record<string, (target: string) => boolean> = {
	ip: (target) => isIPv4(target) || isIPv6(target),
	domain: isDomain,
	url: isUrl,
	hash,
};
function checkThreatIntel({ type, target }: IDataObject): string | undefined {
	if (typeof type !== 'string' || typeof target !== 'string') return undefined;
	if (!Object.prototype.hasOwnProperty.call(subjectTypes, type)) return undefined;
	return subjectTypes[type](target)
		? undefined
		: `target must be a single ${type} when type is ${type}.`;
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
	'security.asset': {
		fields: {
			target: indicator(() => false, 'a single IPv4 or IPv6 address, domain name, or URL'),
		},
	},
	'security.malware': {
		fields: {
			ioc: indicator(hash, 'a domain, IP address, URL, or MD5, SHA1, or SHA256 hash'),
		},
	},
	'security.threat_intel': {
		fields: {
			type: choice('ip', 'domain', 'url', 'hash', 'actor', 'technique', 'software', 'campaign'),
		},
		check: checkThreatIntel,
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
			arrival: location,
			cabin_class: choice('Economy', 'Business', 'First', 'PremiumEconomy'),
			children: count,
			currency: anyCaseCurrency,
			date: flightDate,
			departure: location,
			infants: count,
			max_stops: wholeNumber(0, 1),
			return_date: flightDate,
		},
		check: checkFlight,
	},
	'travel.flight_status': {
		fields: {
			date: dateValue('YYYY-MM-DD', 'YYYYMMDD', 'YYYY/MM/DD'),
			departure: airport,
			flight_number: flightNumber,
		},
	},
};
