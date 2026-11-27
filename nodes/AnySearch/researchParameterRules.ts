import type { IDataObject } from 'n8n-workflow';
import type { CapabilityRuleMap, FieldRule } from './parameterRules';
import {
	booleanValue,
	choice,
	commaSeparated,
	currency,
	dateValue,
	format,
	integer,
	language,
	tightList,
	yearRange,
} from './parameterRules';

// DOI Foundation handbook §4.3.1 includes Unicode spacing characters in DOI names.
const doi = format(
	/^10\.\d+(?:\.\d+)*\/[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}]+$/u,
	'a DOI such as 10.1038/s41586-021-03819-2',
);
// "Accept a bare DOI, a doi: prefix, or an http(s)://doi.org/ URL."
const doiLookup: FieldRule = {
	matches: (value) =>
		typeof value === 'string' &&
		doi.matches(value.replace(/^(?:doi:|https?:\/\/doi\.org\/)/i, ''), {}),
	expected:
		'a DOI such as 10.1038/s41586-021-03819-2, with an optional doi: or http(s)://doi.org/ prefix',
};
const textList = commaSeparated(format(/\S/, 'non-empty text'));
const publicationDate = dateValue('YYYY', 'YYYY-MM', 'YYYY-MM-DD');
const day = dateValue('YYYY-MM-DD');
const citationCount = format(/^\d+$/, 'a non-negative integer string');
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

function validIssn(id: string): boolean {
	// The catalog reserves 0000-0000.
	const digits = id.replace('-', '');
	return digits !== '00000000' && /^\d{4}-?\d{3}[\dX]$/i.test(id) && hasModulo11Checksum(digits);
}

const identifierTypes = new Map<string, (id: string) => boolean>([
	['doi', (id) => doi.matches(id, {})],
	['pmid', (id) => /^\d+$/.test(id)],
	['issn', validIssn],
	['isbn', validIsbn],
	['orcid', validOrcid],
	// OpenCitations Meta assigns IDs to these five entity types.
	['omid', (id) => /^(?:br|ra|ar|re|id)\/\d+(?:\/\d+)?$/i.test(id)],
	['oci', (id) => /^\d+-\d+$/.test(id)],
]);

// "Identifier support: metadata = DOI/PMID/ISSN/ISBN/OMID; citations, references, citation-count
// and reference-count = DOI/PMID/OMID (reference-count also ISSN); author and editor = ORCID/OMID;
// venue-citation-count = ISSN; citation = OCI."
const identifierSupport: Record<string, string[]> = {
	metadata: ['doi', 'pmid', 'issn', 'isbn', 'orcid', 'omid'],
	citations: ['doi', 'pmid', 'omid'],
	references: ['doi', 'pmid', 'omid'],
	'citation-count': ['doi', 'pmid', 'omid'],
	'reference-count': ['doi', 'pmid', 'omid', 'issn'],
	author: ['orcid', 'omid'],
	editor: ['orcid', 'omid'],
	'venue-citation-count': ['issn'],
	citation: ['oci'],
};

// A 10- or 13-digit identifier is an ISBN rather than a PMID; the catalog validates its check digit.
function isbnShaped(id: string): boolean {
	return /^(?:\d{13}|\d{9}[\dX])$/i.test(id.replace(/[ -]/g, ''));
}

function validCitationId(value: unknown, params: IDataObject): boolean {
	if (typeof value !== 'string') return false;
	// "Use type and year only for metadata keyword search with id empty."
	if (value === '') return params.op === undefined || params.op === 'metadata';
	const op = typeof params.op === 'string' ? params.op : 'metadata';
	const supported = identifierSupport[op];
	// An unsupported operation is reported by the op rule.
	if (supported === undefined) return true;
	if (isbnShaped(value)) return supported.includes('isbn') && validIsbn(value);
	return supported.some((type) => identifierTypes.get(type)?.(value) === true);
}

const citationFields = [
	'oci',
	'citing',
	'cited',
	'creation',
	'timespan',
	'journal_sc',
	'author_sc',
];
// "Use comma-separated field:value expressions, for example creation:>2020,author_sc:no."
const citationFilter: FieldRule = {
	matches: (value) =>
		typeof value === 'string' &&
		value.split(',').every((entry) => {
			const match = /^([a-z_]+):[^,\s]+$/.exec(entry);
			return match !== null && citationFields.includes(match[1]);
		}),
	expected: `comma-separated field:value expressions using ${citationFields.join(', ')}`,
};
// "Single provider sort expression … Use field:order form, for example creation:desc."
const citationSort: FieldRule = {
	matches(value) {
		const match = typeof value === 'string' ? /^([a-z_]+):(asc|desc)$/.exec(value) : null;
		return match !== null && citationFields.includes(match[1]);
	},
	expected: `field:asc or field:desc using ${citationFields.join(', ')}`,
};

// DataCite resource types. Multi-word values are case-insensitive and also accept kebab-case.
const dataciteTypes = `Audiovisual Book BookChapter Collection ComputationalNotebook ConferencePaper
	ConferenceProceeding DataPaper Dataset Dissertation Event Image InteractiveResource Instrument
	Journal JournalArticle Model OutputManagementPlan PeerReview PhysicalObject Preprint Report Service
	Software Sound Standard StudyRegistration Text Workflow Other`
	.split(/\s+/)
	.map((type) => type.toLowerCase());
const resourceType: FieldRule = {
	matches: (value) =>
		typeof value === 'string' && dataciteTypes.includes(value.toLowerCase().replace(/-/g, '')),
	expected: 'a DataCite resource type such as Dataset or interactive-resource',
};

export const researchParameterRules: CapabilityRuleMap = {
	'academic.citation': {
		fields: {
			filter: citationFilter,
			id: {
				matches: validCitationId,
				expected: 'an identifier supported by op, or empty for metadata keyword search',
			},
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
			sort: citationSort,
			type: tightList(
				choice(
					'journal_article',
					'conference_paper',
					'book',
					'book_chapter',
					'preprint',
					'dataset',
					'report',
					'thesis',
					'monograph',
					'edited_book',
					'standard',
					'component',
					'journal_issue',
				),
			),
			year: yearRange,
		},
		check: ({ id, op, type, year, filter, sort }) => {
			// "Required for exact metadata lookup and all structured operations except metadata
			// keyword search." A keyword search is a metadata query without an identifier.
			const metadata = op === undefined || op === 'metadata';
			const noId = id === undefined || id === '';
			if (!metadata && noId) return `Provide id for op ${op}.`;
			// "Publication type for metadata keyword search only with id empty."
			if (!(metadata && noId) && (type !== undefined || year !== undefined))
				return 'Use type and year only for metadata keyword search with id empty.';
			// "Provider filter expression for citations and references only."
			if ((filter !== undefined || sort !== undefined) && op !== 'citations' && op !== 'references')
				return 'Use filter and sort only with op citations or references.';
			return undefined;
		},
	},
	'academic.dataset': {
		fields: { resource_type: resourceType, year: yearRange },
	},
	'academic.paper': {
		fields: {
			authors: textList,
			doi: doiLookup,
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
			year: yearRange,
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
				matches(value) {
					return typeof value === 'string'
						? value.trim() !== ''
						: typeof value === 'number' && positiveInteger.matches(value, {});
				},
				expected: 'non-empty text or an integer title number',
			},
		},
	},
};
