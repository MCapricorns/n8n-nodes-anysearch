import type { IDataObject } from 'n8n-workflow';

export interface FieldRule {
	matches: (value: unknown, params: IDataObject) => boolean;
	expected: string;
	applies?: (params: IDataObject) => boolean;
}

export type CapabilityRuleMap = Record<
	string,
	{
		fields?: Record<string, FieldRule>;
		check?: (params: IDataObject, query: string) => string | undefined;
	}
>;

export function choice(...values: string[]): FieldRule {
	return {
		matches: (value) => typeof value === 'string' && values.includes(value),
		expected: values.join(', '),
	};
}

export function wholeNumber(...values: number[]): FieldRule {
	return {
		matches: (value) =>
			typeof value === 'number'
				? values.includes(value)
				: typeof value === 'string' && values.some((entry) => String(entry) === value),
		expected: values.join(' or '),
	};
}

export function format(pattern: RegExp, expected: string): FieldRule {
	return { matches: (value) => typeof value === 'string' && pattern.test(value), expected };
}

export function commaSeparated(rule: FieldRule): FieldRule {
	return {
		matches: (value, params) =>
			typeof value === 'string' &&
			value.split(',').every((entry) => rule.matches(entry.trim(), params)),
		expected: `a comma-separated list of ${rule.expected}`,
	};
}

// "Comma-separated multi-value without spaces."
export function tightList(rule: FieldRule): FieldRule {
	return {
		matches: (value, params) =>
			typeof value === 'string' && value.split(',').every((entry) => rule.matches(entry, params)),
		expected: `a comma-separated list of ${rule.expected} without spaces`,
	};
}

export function integer(minimum: number): FieldRule {
	return {
		matches(value) {
			if (typeof value === 'string' && /^-?\d+$/.test(value)) value = Number(value);
			return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
		},
		expected: `an integer of at least ${minimum}`,
	};
}

export const booleanValue: FieldRule = {
	matches: (value) => value === true || value === false || value === 'true' || value === 'false',
	expected: 'true or false',
};

type DateFormat = 'YYYY' | 'YYYY-MM' | 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'YYYYMMDD' | 'YYYY/MM/DD';

const datePatterns: Record<DateFormat, RegExp> = {
	YYYYMMDD: /^(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})$/,
	'YYYY/MM/DD': /^(?<year>\d{4})\/(?<month>\d{2})\/(?<day>\d{2})$/,
	YYYY: /^(?<year>\d{4})$/,
	'YYYY-MM': /^(?<year>\d{4})-(?<month>\d{2})$/,
	'YYYY-MM-DD': /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/,
	'DD/MM/YYYY': /^(?<day>\d{2})\/(?<month>\d{2})\/(?<year>\d{4})$/,
};

function validDate(value: string, pattern: RegExp): boolean {
	const parts = pattern.exec(value)?.groups;
	if (!parts) return false;
	const year = Number(parts.year);
	const month = Number(parts.month ?? 1);
	const day = Number(parts.day ?? 1);
	const date = new Date(0);
	date.setUTCFullYear(year, month - 1, day);
	return (
		year > 0 &&
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	);
}

export function dateValue(...formats: DateFormat[]): FieldRule {
	return {
		matches: (value) =>
			typeof value === 'string' && formats.some((entry) => validDate(value, datePatterns[entry])),
		expected: `a valid date in ${formats.join(' or ')} format`,
	};
}

// These fields give date examples and leave other provider-specific formats open.
const yearFirstPatterns = [
	datePatterns.YYYY,
	datePatterns['YYYY-MM'],
	datePatterns['YYYY-MM-DD'],
	datePatterns.YYYYMMDD,
];

function yearFirstPattern(value: string): RegExp | undefined {
	return yearFirstPatterns.find((entry) => entry.test(value));
}

export const providerDate: FieldRule = {
	expected: 'a date with a valid calendar month and day when supplied',
	matches(value) {
		if (typeof value !== 'string' || value.trim() === '') return false;
		const text = value.trim();
		const pattern = yearFirstPattern(text);
		return pattern === undefined || validDate(text, pattern);
	},
};

// YYYY (single year), YYYY-YYYY (range), YYYY- (lower bound) or -YYYY (upper bound).
export const yearRange: FieldRule = format(
	/^(?:\d{4}(?:-\d{4})?|\d{4}-|-\d{4})$/,
	'YYYY, YYYY-YYYY, YYYY-, or -YYYY',
);

// A positive number of days, such as 7d or 30d.
export const dayRange: FieldRule = format(
	/^0*[1-9]\d*d$/,
	'a positive day range such as 7d or 30d',
);

// A lookback such as 7d, 30d, 90d, 1y or a positive number of days.
export const lookback: FieldRule = format(
	/^(?:0*[1-9]\d*d|[1-9]\d*y)$/,
	'a lookback such as 7d, 30d, 90d, 1y or a positive number of days',
);

// YYYY-MM-DD..YYYY-MM-DD; start.. has no end and ..end uses the default window.
// Datetime bounds are accepted only where the catalog says they are normalized.
export function dateRange(dateTime = false): FieldRule {
	const day = dateValue('YYYY-MM-DD');
	const time = dateTime ? '(?:[T ]\\d{2}:\\d{2}(?::\\d{2})?(?:Z|[+-]\\d{2}:?\\d{2})?)?' : '';
	const pattern = new RegExp(`^(\\d{4}-\\d{2}-\\d{2}${time})?\\.\\.(\\d{4}-\\d{2}-\\d{2}${time})?$`);
	return {
		matches(value) {
			if (typeof value !== 'string') return false;
			const match = pattern.exec(value);
			if (!match || (!match[1] && !match[2])) return false;
			return [match[1], match[2]].every(
				(bound) => bound === undefined || day.matches(bound.slice(0, 10), {}),
			);
		},
		expected: dateTime
			? 'YYYY-MM-DD[..YYYY-MM-DD], each with an optional time'
			: 'YYYY-MM-DD..YYYY-MM-DD, start.., or ..end',
	};
}

const NUMBER = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
// min..max, where either bound may be omitted for an open range.
export function numberRange(minimum?: number, maximum?: number): FieldRule {
	const pattern = new RegExp(`^(${NUMBER})?\\.\\.(${NUMBER})?$`);
	const bounds = [minimum, maximum].filter((bound) => bound !== undefined);
	return {
		matches(value) {
			if (typeof value !== 'string') return false;
			const match = pattern.exec(value);
			if (!match || (!match[1] && !match[2])) return false;
			return [match[1], match[2]].every(
				(bound) =>
					bound === undefined ||
					((minimum === undefined || Number(bound) >= minimum) &&
						(maximum === undefined || Number(bound) <= maximum)),
			);
		},
		expected: bounds.length
			? `a min..max number range within ${minimum} to ${maximum}`
			: 'a min..max number range',
	};
}

// YYYY, YYYYQn, or a date (a quarter-end date when quarterEndOnly is set).
export function quarter(quarterEndOnly = false): FieldRule {
	const day = dateValue('YYYY-MM-DD');
	const ends = ['-03-31', '-06-30', '-09-30', '-12-31'];
	return {
		matches(value) {
			if (typeof value !== 'string') return false;
			if (/^\d{4}(?:Q[1-4])?$/.test(value)) return true;
			return day.matches(value, {}) && (!quarterEndOnly || ends.some((end) => value.endsWith(end)));
		},
		expected: quarterEndOnly ? 'YYYY, YYYYQn, or a quarter-end date' : 'YYYY, YYYYQn, or YYYY-MM-DD',
	};
}

// SIX ISO 4217 lists one (2026-09-17) and three (2026-01-01).
// https://www.six-group.com/en/products-services/financial-information/market-reference-data/data-standards.html
const currencyCodes = new Set(
	`ADP AED AFA AFN ALK ALL AMD ANG AOA AOK AON AOR ARA ARP ARS ARY ATS AUD AWG AYM AZM AZN
	BAD BAM BBD BDT BEC BEF BEL BGJ BGK BGL BGN BHD BIF BMD BND BOB BOP BOV BRB BRC BRE BRL
	BRN BRR BSD BTN BUK BWP BYB BYN BYR BZD CAD CDF CHC CHE CHF CHW CLF CLP CNY COP COU CRC
	CSD CSJ CSK CUC CUP CVE CYP CZK DDM DEM DJF DKK DOP DZD ECS ECV EEK EGP ERN ESA ESB ESP
	ETB EUR FIM FJD FKP FRF GBP GEK GEL GHC GHP GHS GIP GMD GNE GNF GNS GQE GRD GTQ GWE GWP
	GYD HKD HNL HRD HRK HTG HUF IDR IEP ILP ILR ILS INR IQD IRR ISJ ISK ITL JMD JOD JPY KES
	KGS KHR KMF KPW KRW KWD KYD KZT LAJ LAK LBP LKR LRD LSL LSM LTL LTT LUC LUF LUL LVL LVR
	LYD MAD MDL MGA MGF MKD MLF MMK MNT MOP MRO MRU MTL MTP MUR MVQ MVR MWK MXN MXP MXV MYR
	MZE MZM MZN NAD NGN NIC NIO NLG NOK NPR NZD OMR PAB PEH PEI PEN PES PGK PHP PKR PLN PLZ
	PTE PYG QAR RHD ROK ROL RON RSD RUB RUR RWF SAR SBD SCR SDD SDG SDP SEK SGD SHP SIT SKK
	SLE SLL SOS SRD SRG SSP STD STN SUR SVC SYP SZL THB TJR TJS TMM TMT TND TOP TPE TRL TRY
	TTD TWD TZS UAH UAK UGS UGW UGX USD USN USS UYI UYN UYP UYU UYW UZS VEB VED VEF VES VNC
	VND VUV WST XAD XAF XAG XAU XBA XBB XBC XBD XCD XCG XDR XEU XFO XFU XOF XPD XPF XPT XRE
	XSU XTS XUA XXX YDD YER YUD YUM YUN ZAL ZAR ZMK ZMW ZRN ZRZ ZWC ZWD ZWG ZWL ZWN ZWR`.split(
		/\s+/,
	),
);

export const currency: FieldRule = {
	matches: (value) => typeof value === 'string' && currencyCodes.has(value),
	expected: 'a three-letter ISO 4217 currency code',
};

export const anyCaseCurrency: FieldRule = {
	matches: (value) => typeof value === 'string' && currencyCodes.has(value.toUpperCase()),
	expected: 'a three-letter ISO 4217 currency code',
};

// https://id.loc.gov/vocabulary/iso639-1.json
const languageCodes = new Set(
	`aa ab ae af ak am an ar as av ay az ba be bg bi bm bn bo br bs ca ce ch co cr cs cu cv
	cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho
	hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku
	kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn
	no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm
	sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi
	vo wa wo xh yi yo za zh zu`.split(/\s+/),
);

export const language: FieldRule = {
	matches: (value) =>
		typeof value === 'string' && /^[a-zA-Z]{2}$/.test(value) && languageCodes.has(value.toLowerCase()),
	expected: 'a two-letter ISO 639-1 language code',
};

// ISO 3166-1 assigned alpha-2 codes, including territories.
const countryCodes = new Set(
	`AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN
	BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
	DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL
	GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM
	JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME
	MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP
	NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD
	SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO
	TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(/\s+/),
);

export const countryCode: FieldRule = {
	matches: (value) =>
		typeof value === 'string' &&
		/^[A-Za-z]{2}$/.test(value) &&
		countryCodes.has(value.toUpperCase()),
	expected: 'an ISO 3166-1 alpha-2 country code such as US',
};
