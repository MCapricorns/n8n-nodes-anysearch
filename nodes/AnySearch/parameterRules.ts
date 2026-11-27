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

type DateFormat = 'YYYY' | 'YYYY-MM' | 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'YYYYMMDD';

const datePatterns: Record<DateFormat, RegExp> = {
	YYYYMMDD: /^(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})$/,
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

function providerDateKey(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const text = value.trim();
	return yearFirstPattern(text) ? text.replace(/-/g, '') : undefined;
}

export function reversedProviderDates(start: unknown, end: unknown): boolean {
	const lower = providerDateKey(start);
	const upper = providerDateKey(end);
	if (!lower || !upper) return false;
	// A year or month can overlap a more precise date within it.
	const precision = Math.min(lower.length, upper.length);
	return lower.slice(0, precision) > upper.slice(0, precision);
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
