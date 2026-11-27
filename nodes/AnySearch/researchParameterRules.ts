import type { IDataObject } from 'n8n-workflow';
import type { CapabilityRuleMap, FieldRule } from './parameterRules';
import { booleanValue, choice, commaSeparated, dateValue, format, integer } from './parameterRules';

const doi = format(/^10\.\d+(?:\.\d+)*\/\S+$/, 'a DOI such as 10.1038/s41586-021-03819-2');
const textList = commaSeparated(format(/\S/, 'non-empty text'));
const languageNames = new Intl.DisplayNames('en', { type: 'language', fallback: 'none' });
const currencyNames = new Intl.DisplayNames('en', { type: 'currency', fallback: 'none' });
const language: FieldRule = {
	matches: (value) =>
		typeof value === 'string' && /^[a-z]{2}$/i.test(value) && languageNames.of(value) !== undefined,
	expected: 'a two-letter ISO 639-1 language code',
};
const currency: FieldRule = {
	matches: (value) =>
		typeof value === 'string' && /^[A-Z]{3}$/.test(value) && currencyNames.of(value) !== undefined,
	expected: 'a three-letter ISO 4217 currency code',
};
const publicationDate = dateValue('YYYY', 'YYYY-MM', 'YYYY-MM-DD');
const day = dateValue('YYYY-MM-DD');
const citationCount = format(/^\d+$/, 'a non-negative integer string');

function validOrcid(value: unknown): boolean {
	if (typeof value !== 'string' || !/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/i.test(value)) return false;
	const digits = value.replace(/-/g, '');
	let total = 0;
	for (const digit of digits.slice(0, 15)) total = (total + Number(digit)) * 2;
	const checkDigit = (12 - (total % 11)) % 11;
	return digits[15].toUpperCase() === (checkDigit === 10 ? 'X' : String(checkDigit));
}

const identifierTypes = new Map<string, (id: string) => boolean>([
	['doi', (id) => doi.matches(id, {})],
	['pmid', (id) => /^\d+$/.test(id)],
	['issn', (id) => /^\d{4}-?\d{3}[\dX]$/i.test(id)],
	['isbn', (id) => /^(?:\d{9}[\dX]|\d{13})$/i.test(id.replace(/[ -]/g, ''))],
	['orcid', validOrcid],
	['omid', (id) => /^[a-z][a-z\d]*\/\d+$/i.test(id)],
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

const citationPublicationTypes = choice(
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
);

function checkRange(params: IDataObject, lower: string, upper: string): string | undefined {
	const lowerValue = params[lower];
	const upperValue = params[upper];
	if (lowerValue === undefined || upperValue === undefined) return undefined;
	const start = String(lowerValue);
	const end = String(upperValue);
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
			sort: format(/^[^:\s]+:\s*\S/, 'a RAMOSE field:order expression'),
			type: {
				matches: (value) =>
					typeof value === 'string' &&
					(/^[a-z][a-z\d_-]*$/.test(value) ||
						(!/\s/.test(value) &&
							value.split(',').every((part) => citationPublicationTypes.matches(part, {})))),
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
		fields: { year_from: dateValue('YYYY'), year_to: dateValue('YYYY') },
		check: (params) => checkRange(params, 'year_from', 'year_to'),
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
			congress: integer(1),
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
		},
		check: (params) =>
			checkRange(params, 'date_from', 'date_to') ??
			checkRange(params, 'effective_from', 'effective_to'),
	},
};
