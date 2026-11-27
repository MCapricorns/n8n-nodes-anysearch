import type { CapabilityRuleMap, FieldRule } from './parameterRules';
import { choice, dateValue, format } from './parameterRules';

const annualSalary: FieldRule = {
	expected: 'a numeric annual salary in USD',
	matches(value) {
		if (typeof value === 'number') return Number.isFinite(value);
		return typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value);
	},
};

export const domainParameterRules: CapabilityRuleMap = {
	'agriculture.fao': {
		fields: {
			date_start: dateValue('YYYY'),
			domain: choice('production', 'trade', 'prices'),
			type: choice('GlobalAgriculture'),
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
	'energy.electricity': {
		fields: {
			metric: choice('price', 'generation', 'emissions', 'demand', 'capacity'),
			type: choice('EUElectricity', 'AustralianElectricity', 'USEnergyData', 'GlobalElectricity'),
		},
	},
	'energy.production': {
		fields: {
			frequency: choice('monthly', 'annual', 'quarterly'),
			type: choice('USEnergyData'),
		},
	},
	'environment.aqi': {
		fields: { type: choice('GlobalAirQuality') },
	},
	'health.drug': {
		fields: { type: choice('name', 'ndc', 'upc') },
	},
	'ip.global': {
		fields: { type: choice('GlobalPatent') },
	},
};
