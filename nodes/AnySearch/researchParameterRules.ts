import type { IDataObject } from 'n8n-workflow';
import type { CapabilityRuleMap, FieldRule } from './parameterRules';
import { booleanValue, choice, commaSeparated, dateValue, format, integer } from './parameterRules';

// DOI Foundation handbook §4.3.1 includes Unicode spacing characters in DOI names.
const doi = format(
	/^10\.\d+(?:\.\d+)*\/[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}]+$/u,
	'a DOI such as 10.1038/s41586-021-03819-2',
);
const textList = commaSeparated(format(/\S/, 'non-empty text'));
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
	XSU XTS XUA XXX YDD YER YUD YUM YUN ZAL ZAR ZMK ZMW ZRN ZRZ ZWC ZWD ZWG ZWL ZWN ZWR`.split(/\s+/),
);
const language: FieldRule = {
	matches: (value) =>
		typeof value === 'string' &&
		/^[a-zA-Z]{2}$/.test(value) &&
		languageCodes.has(value.toLowerCase()),
	expected: 'a two-letter ISO 639-1 language code',
};
const currency: FieldRule = {
	matches: (value) => typeof value === 'string' && currencyCodes.has(value),
	expected: 'a three-letter ISO 4217 currency code',
};
const publicationDate = dateValue('YYYY', 'YYYY-MM', 'YYYY-MM-DD');
const day = dateValue('YYYY-MM-DD');
const citationCount = format(/^\d+$/, 'a non-negative integer string');
const datasetYear: FieldRule = {
	matches: (value) =>
		typeof value === 'number'
			? Number.isSafeInteger(value)
			: typeof value === 'string' && /^-?\d+$/.test(value),
	expected: 'a publication year as an integer or integer string',
};
const positiveInteger = integer(1);

function validOrcid(value: unknown): boolean {
	if (typeof value !== 'string' || !/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(value)) return false;
	const digits = value.replace(/-/g, '');
	let total = 0;
	for (const digit of digits.slice(0, 15)) total = (total + Number(digit)) * 2;
	const checkDigit = (12 - (total % 11)) % 11;
	return digits[15] === (checkDigit === 10 ? 'X' : String(checkDigit));
}

// ISSNs and legacy ISBN-10 numbers use descending weights with a modulo 11 check.
function hasModulo11Checksum(digits: string): boolean {
	let sum = 0;
	for (let index = 0; index < digits.length; index++) {
		const digit = digits[index].toUpperCase();
		sum += (digit === 'X' ? 10 : Number(digit)) * (digits.length - index);
	}
	return sum % 11 === 0;
}

function validIsbn(id: string): boolean {
	const digits = id.replace(/[ -]/g, '');
	if (/^\d{9}[\dX]$/i.test(digits)) return hasModulo11Checksum(digits);
	// The 979-0 registration group is reserved for ISMNs.
	if (!/^(?:978\d|979[1-9])\d{9}$/.test(digits)) return false;
	let sum = 0;
	for (let index = 0; index < digits.length; index++) {
		sum += Number(digits[index]) * (index % 2 === 0 ? 1 : 3);
	}
	return sum % 10 === 0;
}

const identifierTypes = new Map<string, (id: string) => boolean>([
	['doi', (id) => doi.matches(id, {})],
	['pmid', (id) => /^\d+$/.test(id)],
	['issn', (id) => /^\d{4}-?\d{3}[\dX]$/i.test(id) && hasModulo11Checksum(id.replace('-', ''))],
	['isbn', validIsbn],
	['orcid', validOrcid],
	// OpenCitations Meta assigns IDs to these five entity types.
	['omid', (id) => /^(?:br|ra|ar|re|id)\/\d+(?:\/\d+)?$/i.test(id)],
]);

function validCitationId(value: unknown, params: IDataObject): boolean {
	if (typeof value !== 'string') return false;
	const type = params.id_type;
	if (params.op === 'citation') return /^\d+-\d+$/.test(value);
	if (typeof type === 'string' && type !== '') {
		return identifierTypes.get(type)?.(value) ?? false;
	}
	return [...identifierTypes.values()].some((match) => match(value));
}

// Document type IDs from https://api.crossref.org/types.
const crossrefTypes = new Set(
	`book book-chapter book-part book-section book-series book-set book-track component database
	dataset dissertation edited-book grant journal journal-article journal-issue journal-volume
	monograph other peer-review posted-content proceedings proceedings-article proceedings-series
	reference-book reference-entry report report-component report-series standard`.split(/\s+/),
);
const citationPublicationTypes = commaSeparated(
	choice(
		'JournalArticle',
		'Conference',
		'Review',
		'CaseReport',
		'ClinicalTrial',
		'Dataset',
		'Editorial',
		'LettersAndComments',
		'MetaAnalysis',
		'News',
		'Study',
		'Book',
		'BookSection',
	),
);

function checkRange(params: IDataObject, lower: string, upper: string): string | undefined {
	const start = params[lower];
	const end = params[upper];
	if (typeof start !== 'string' || typeof end !== 'string') return undefined;
	// An end specified as only a year or month includes that whole interval.
	const precision = Math.min(start.length, end.length);
	if (start.slice(0, precision) > end.slice(0, precision)) {
		return `${lower} must be on or before ${upper}.`;
	}
	return undefined;
}

export const researchParameterRules: CapabilityRuleMap = {
	'academic.citation': {
		fields: {
			category: commaSeparated(
				choice(
					'Computer Science',
					'Medicine',
					'Biology',
					'Chemistry',
					'Physics',
					'Mathematics',
					'Materials Science',
					'Engineering',
					'Environmental Science',
					'Geology',
					'Geography',
					'Sociology',
					'Psychology',
					'Economics',
					'Business',
					'Political Science',
					'Linguistics',
					'Philosophy',
					'History',
					'Art',
					'Education',
					'Law',
				),
			),
			doi,
			filter: format(/^[^:\s]+:\s*\S/, 'a RAMOSE field:value expression'),
			id: {
				matches: validCitationId,
				expected: 'a bare persistent identifier matching id_type, or an OCI for op=citation',
			},
			id_type: choice('', 'doi', 'pmid', 'issn', 'isbn', 'orcid', 'omid'),
			min_citations: citationCount,
			op: choice(
				'metadata',
				'citations',
				'references',
				'citation-count',
				'reference-count',
				'author',
				'editor',
				'venue-citation-count',
				'citation',
			),
			open_access: booleanValue,
			// RAMOSE supports ascending and descending order: https://api.opencitations.net/index/v2
			sort: format(/^[^:\s]+:(?:asc|desc)$/, 'a RAMOSE field:asc or field:desc expression'),
			type: {
				matches(value, params) {
					return (
						typeof value === 'string' &&
						(crossrefTypes.has(value) ||
							(!/\s/.test(value) && citationPublicationTypes.matches(value, params)))
					);
				},
				expected:
					'a Crossref type or a comma-separated list of documented publication types without spaces',
			},
			venue: textList,
			year_from: publicationDate,
			year_to: publicationDate,
		},
		check: (params) => checkRange(params, 'year_from', 'year_to'),
	},
	'academic.dataset': {
		fields: { year_from: datasetYear, year_to: datasetYear },
		check: (params) => {
			const { year_from: start, year_to: end } = params;
			if (start !== undefined && end !== undefined && BigInt(String(start)) > BigInt(String(end))) {
				return 'year_from must be on or before year_to.';
			}
			return undefined;
		},
	},
	'academic.paper': {
		fields: {
			authors: textList,
			doi,
			language,
			min_citations: citationCount,
			open_access: booleanValue,
			publication_type: commaSeparated(
				choice(
					'journal_article',
					'preprint',
					'book',
					'book_chapter',
					'thesis',
					'dataset',
					'report',
					'review',
					'other',
				),
			),
			sort: choice('relevance', 'date_asc', 'date_desc', 'cited'),
			venue: textList,
			year: format(/^(?:\d{4}(?:-(?:\d{4})?)?|-\d{4})$/, 'YYYY, YYYY-YYYY, YYYY-, or -YYYY'),
		},
		check: (params) => {
			if (typeof params.year !== 'string') return undefined;
			const [start, end] = params.year.split('-');
			if (start && end && start > end) return 'The first year must be on or before the last year.';
			return undefined;
		},
	},
	'academic.person': {
		fields: {
			affiliations: textList,
			orcid: { matches: validOrcid, expected: 'a bare, checksum-valid ORCID' },
			research_areas: textList,
			schools: textList,
		},
	},
	'legal.enforcement': {
		fields: {
			currency,
			decision_date: day,
			decision_type: choice('penalty', 'inspection', 'order', 'other'),
			legal_basis: textList,
			penalty_amount: format(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/, 'a numeric string'),
			penalty_types: textList,
			subject_names: textList,
		},
	},
	'legal.judicial': {
		fields: {
			case_type: choice('civil', 'criminal', 'administrative', 'other', 'enforcement'),
			document_type: choice('judgment', 'ruling', 'decision', 'order'),
			judgment_date: day,
			language,
			legal_basis: textList,
			procedure: choice('first_instance', 'second_instance', 'retrial', 'other'),
		},
	},
	'legal.legislation': {
		fields: {
			congress: positiveInteger,
			date_from: day,
			date_to: day,
			effective_from: publicationDate,
			effective_status: choice('effective', 'not_yet_effective', 'repealed'),
			effective_to: publicationDate,
			historical: booleanValue,
			language,
			legal_level: choice(
				'local_regulation',
				'statute',
				'regulation',
				'judicial_interpretation',
				'ministerial_rule',
				'decision',
				'other',
				'bill',
				'decree',
			),
			resource_kind: choice('rules', 'resources', 'all'),
			title: {
				matches(value, params) {
					const text = typeof value === 'string';
					const numeric = typeof value === 'number' || (text && /^[+-]?\d+$/.test(value.trim()));
					if (params.collection === 'CFR' && numeric) {
						const number = Number(value);
						return Number.isInteger(number) && number >= 1 && number <= 50;
					}
					return text
						? value.trim() !== ''
						: typeof value === 'number' && positiveInteger.matches(value, params);
				},
				expected: 'non-empty text or an integer title number (1 to 50 for CFR)',
			},
		},
		check: (params) => checkRange(params, 'effective_from', 'effective_to'),
	},
};
