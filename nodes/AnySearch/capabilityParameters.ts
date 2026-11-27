import type { IDataObject, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import catalog from './catalog.json';
import { domainParameterRules } from './domainParameterRules';
import { marketParameterRules } from './marketParameterRules';
import { researchParameterRules } from './researchParameterRules';
import { technicalParameterRules } from './technicalParameterRules';

interface ParameterDefinition {
	required: boolean;
}

const definitions = new Map<string, Record<string, ParameterDefinition>>(
	Object.entries(catalog.tags),
);
const rules = new Map(
	Object.entries({
		...domainParameterRules,
		...marketParameterRules,
		...researchParameterRules,
		...technicalParameterRules,
	}),
);
const statementTypes = new Set(['income', 'balance', 'cashflow', 'indicator', 'holder']);
const emptyFields: Record<string, string[]> = {
	'academic.citation': ['id_type'],
	'finance.calendar': ['cn_code', 'symbol'],
	'finance.news': ['cn_code', 'symbol'],
	'travel.flight': ['return_date'],
	'travel.flight_status': ['departure'],
};

// Only render public catalog field names from a recognized validation response.
export function missingParameterMessage(message: unknown): string | undefined {
	if (typeof message !== 'string' || message.length > 512) return undefined;
	const match = /^Missing required params for tag '([a-z_]+\.[a-z_]+)': ([a-z_, ]+)\.$/.exec(
		message,
	);
	if (!match) return undefined;
	const fields = definitions.get(match[1]);
	return match[2].split(', ').every((field) => fields?.[field]?.required) ? message : undefined;
}

function normalizeParameters(tag: string, input: IDataObject): IDataObject {
	const type = typeof input.type === 'string' ? input.type.trim() : input.type;
	const params = type === input.type ? input : { ...input, type };
	if (tag === 'travel.flight_status' && params.departure === undefined) {
		return { ...params, departure: '' };
	}
	if (tag === 'finance.fundamental') {
		if (type === 'overview') {
			return { ...params, symbol: params.symbol === undefined ? '' : params.symbol, cn_code: '' };
		}
		if (typeof type === 'string' && statementTypes.has(type)) return { ...params, symbol: '' };
	}
	if (tag === 'finance.calendar' && type === 'earnings' && params.period === undefined) {
		return { ...params, period: '90d' };
	}
	return params;
}

function allowsEmpty(tag: string, field: string, type: unknown): boolean {
	if (tag === 'finance.fundamental')
		return field === 'symbol' || (field === 'cn_code' && type === 'overview');
	if (tag === 'finance.quote') {
		return field === 'cn_code' || (field === 'symbol' && type !== 'crypto');
	}
	return emptyFields[tag]?.includes(field) ?? false;
}

export function capabilityParameters(
	node: INode,
	tag: string,
	input: IDataObject | undefined,
	query: string,
): IDataObject | undefined {
	if (!tag) {
		if (input && Object.keys(input).length) {
			throw new NodeOperationError(
				node,
				'Choose a Capability Tag before providing Tag Parameters.',
			);
		}
		return undefined;
	}
	const fields = definitions.get(tag);
	if (!fields) {
		throw new NodeOperationError(
			node,
			'Unknown Capability Tag. Use Get Sub-Domains to find supported tags.',
		);
	}

	const params = normalizeParameters(tag, input ?? {});
	if (Object.keys(params).some((field) => !Object.prototype.hasOwnProperty.call(fields, field))) {
		throw new NodeOperationError(
			node,
			`Unsupported parameters for ${tag}. Use Get Sub-Domains to find supported fields.`,
		);
	}
	const fieldNames = Object.keys(fields);
	const missing = fieldNames.filter((name) => fields[name].required && params[name] === undefined);
	if (missing.length) {
		throw new NodeOperationError(
			node,
			`Provide required parameters for ${tag}: ${missing.join(', ')}.`,
		);
	}

	const capability = rules.get(tag);
	// Selectors determine the rules for dependent values and are checked first.
	const validationOrder = fields.type
		? ['type', ...fieldNames.filter((name) => name !== 'type')]
		: fieldNames;
	for (const field of validationOrder) {
		const value = params[field];
		if (value === undefined) continue;
		if (value === '' && allowsEmpty(tag, field, params.type)) {
			const submitted = input?.[field];
			if (submitted !== undefined && typeof submitted !== 'string') {
				throw new NodeOperationError(node, `For ${tag}, ${field} must be a string.`);
			}
			continue;
		}
		const configuredRule = capability?.fields?.[field];
		const rule =
			configuredRule?.applies && !configuredRule.applies(params) ? undefined : configuredRule;
		const valid = rule
			? rule.matches(value, params)
			: typeof value === 'string' && value.trim() !== '';
		if (!valid) {
			throw new NodeOperationError(
				node,
				`For ${tag}, ${field} must be ${rule?.expected ?? 'non-empty text'}.`,
			);
		}
	}
	const error = capability?.check?.(params, query);
	if (error) throw new NodeOperationError(node, `For ${tag}, ${error}`);
	return Object.keys(params).length ? params : undefined;
}
