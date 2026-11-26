import type { IDataObject, INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

// The REST API checks for the presence of these keys, even when a value is blank.
const requiredByTag = new Map<string, string[]>([
	['academic.citation', ['id']],
	['code.doc', ['library']],
	['finance.calendar', ['type']],
	['finance.fundamental', ['type', 'symbol', 'cn_code']],
	['finance.macro', ['type']],
	['finance.news', ['type']],
	['finance.quote', ['type']],
	['finance.screen', ['type']],
	['gaming.esports', ['type']],
	['health.drug', ['type']],
	['security.intel', ['ioc']],
	['security.noise', ['ip']],
	['security.scan', ['ioc']],
	['security.vuln', ['type', 'value']],
	['travel.flight', ['departure', 'arrival', 'date']],
	['travel.flight_status', ['flight_number', 'departure']],
]);

// Only render public catalog field names from a recognized validation response.
export function missingParameterMessage(message: unknown): string | undefined {
	if (typeof message !== 'string' || message.length > 512) return undefined;
	const match = /^Missing required params for tag '([a-z_]+\.[a-z_]+)': ([a-z_, ]+)\.$/.exec(
		message,
	);
	if (!match) return undefined;
	const fields = match[2].split(', ');
	const known = requiredByTag.get(match[1]);
	if (!fields.every((field) => known?.includes(field))) return undefined;
	return `Missing required parameters for ${match[1]}: ${fields.join(', ')}.`;
}

const statements = new Set(['income', 'balance', 'cashflow', 'indicator', 'holder']);
const playerTypes = new Set(['player', 'ranked', 'mastery', 'live_game']);

function withDefault(params: IDataObject | undefined, field: string, value: string): IDataObject {
	return params?.[field] === undefined ? { ...params, [field]: value } : params;
}

function validValue(field: string, value: unknown, allowEmpty: string[]): boolean {
	if (typeof value === 'string') {
		return value.trim() !== '' || (value === '' && allowEmpty.includes(field));
	}
	// A PMID or an A-share ticker can also arrive as a numeric n8n expression.
	return (
		(field === 'id' || field === 'cn_code') &&
		typeof value === 'number' &&
		Number.isSafeInteger(value)
	);
}

export function capabilityParameters(
	node: INode,
	tag: string,
	params: IDataObject | undefined,
): IDataObject | undefined {
	const catalogFields = requiredByTag.get(tag) ?? [];
	const type = typeof params?.type === 'string' ? params.type.trim() : '';
	if (catalogFields.includes('type') && typeof params?.type === 'string' && type !== params.type) {
		params = { ...params, type };
	}
	let allowEmpty: string[] = [];
	let conditional: string[] = [];
	if (tag === 'travel.flight_status') {
		params = withDefault(params, 'departure', '');
		allowEmpty = ['departure'];
	} else if (tag === 'finance.fundamental') {
		allowEmpty = ['symbol', 'cn_code'];
		if (type === 'overview') {
			// An empty symbol lets the service read the ticker from the query.
			params = withDefault(params, 'symbol', '');
			params = withDefault(params, 'cn_code', '');
		} else if (statements.has(type)) {
			params = withDefault(params, 'symbol', '');
			allowEmpty = ['symbol'];
		}
	} else if (tag === 'gaming.esports') {
		if (playerTypes.has(type)) conditional = ['region', 'game_name'];
		if (type === 'match_detail') conditional = ['match_id'];
		if (type === 'leaderboard') {
			conditional = ['region'];
			if (params?.division) {
				conditional.push('tier');
				if (
					typeof params.tier === 'string' &&
					['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(params.tier)
				) {
					throw new NodeOperationError(
						node,
						'Omit division for Master, Grandmaster or Challenger leaderboards.',
					);
				}
			}
		}
	} else if (tag === 'finance.quote' && type === 'crypto') {
		conditional = ['symbol'];
	} else if (tag === 'finance.calendar' && type === 'earnings') {
		params = withDefault(params, 'period', '90d');
	} else if (tag === 'academic.citation' && params?.op === 'citation' && params.id !== undefined) {
		if (typeof params.id !== 'string' || !/^\d+-\d+$/.test(params.id)) {
			throw new NodeOperationError(
				node,
				'For a single citation, provide an OCI in id (two digit groups separated by a hyphen).',
			);
		}
	}

	// Let the service report absent unconditional keys with a request ID. Check supplied
	// values and conditional requirements locally, since they can otherwise yield HTTP 200.
	const supplied = catalogFields.filter((field) => params?.[field] !== undefined);
	const invalid = [...supplied, ...conditional].filter(
		(field) => !validValue(field, params?.[field], allowEmpty),
	);
	if (invalid.length) {
		throw new NodeOperationError(
			node,
			`Provide a valid value for ${invalid.join(', ')} in ${tag}.`,
		);
	}
	return params;
}
