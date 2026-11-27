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
// Fields whose catalog description allows an empty value.
const emptyFields: Record<string, string[]> = {
	// "return date, empty = one-way"
	'travel.flight': ['return_date'],
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

	const params = input ?? {};
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
		if (value === '' && emptyFields[tag]?.includes(field)) continue;
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
