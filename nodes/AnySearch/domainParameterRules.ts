import type { CapabilityRuleMap, FieldRule } from './parameterRules';
import { booleanValue, choice, dateValue, format, providerDate } from './parameterRules';

const annualSalary: FieldRule = {
	expected: 'a numeric annual salary in USD',
	matches(value) {
		if (typeof value === 'number') return Number.isFinite(value);
		return typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value);
	},
};

// 'One place name or "lat,lng" (e.g. "Beijing", "38.9,-77.0"); up to 3 locations, separated by
// comma, semicolon, Chinese comma, or "and". Invalid coordinates (out of range, elevation, single
// number, numeric-only lists) return PARAM_INVALID; a numeric token mixed with a name is ignored.'
const aqiLocation: FieldRule = {
	matches(value) {
		if (typeof value !== 'string') return false;
		const groups = value
			.split(/;|；|\s+and\s+/i)
			.map((part) => part.trim())
			.filter(Boolean);
		// The provider resolves names itself.
		if (groups.some((part) => !/^[\d\s,.+-]+$/.test(part))) return true;
		if (groups.length === 0 || groups.length > 3) return false;
		return groups.every((part) => {
			const [lat, lng, extra] = part.split(/\s*,\s*/).map(Number);
			return extra === undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
		});
	},
	expected: 'a place name or up to 3 "lat,lng" pairs',
};

export const domainParameterRules: CapabilityRuleMap = {
	'agriculture.stats': {
		fields: {
			domain: choice(
				'production',
				'trade',
				'prices',
				'inputs',
				'land',
				'emissions',
				'food_security',
				'population',
				'investment',
				'forestry',
				'census',
				'other',
			),
			// "Year or comma-separated years."
			year: format(/^\d{4}(?:,\d{4})*$/, 'a four-digit year or comma-separated years'),
		},
	},
	'business.company': {
		fields: { type: choice('ChineseEnterprise', 'GlobalLEI', 'USFilings') },
	},
	'business.jobs': {
		fields: {
			salary_min: annualSalary,
			type: choice('GeneralJobs', 'RemoteJobs', 'USFederalJobs'),
		},
	},
	'business.people': {
		fields: { type: choice('PeopleSearch', 'EmailLookup') },
	},
	'business.trade': {
		fields: {
			date_start: dateValue('YYYY'),
			flow: choice('export', 'import', 'both'),
			hs_code: format(/^(?:\d{2}|\d{4}|\d{6}|\d{10})$/, 'an HS code with 2, 4, 6, or 10 digits'),
			type: choice('GlobalBilateralTrade', 'USImportExport'),
		},
	},
	'code.snippet': {
		fields: { regex: booleanValue },
	},
	'energy.electricity': {
		fields: {
			date_start: providerDate,
			date_end: providerDate,
			metric: choice('price', 'generation', 'emissions', 'demand', 'capacity'),
			type: choice('EUElectricity', 'AustralianElectricity', 'USEnergyData', 'GlobalElectricity'),
		},
	},
	'energy.production': {
		fields: {
			date_start: providerDate,
			frequency: choice('monthly', 'annual', 'quarterly'),
			type: choice('USEnergyData'),
		},
	},
	'environment.aqi': { fields: { location: aqiLocation } },
	// "Enum values: asset, discover."
	'resource.image': { fields: { type: choice('asset', 'discover') } },
	'health.drug': {
		fields: { type: choice('name', 'ndc', 'upc') },
	},
	'ip.global': {
		fields: { date_start: providerDate, type: choice('GlobalPatent') },
	},
};
