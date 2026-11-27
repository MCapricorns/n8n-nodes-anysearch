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
// These operations document the quote time-range format. Earnings has its own fixed
// period and macro indicators have additional ranges (for example 2y for GDP).
const quoteRangeTypes = new Map<string, string[]>([
	['finance.quote', ['stock', 'forex', 'crypto', 'commodity', 'index', 'etf']],
	['finance.calendar', ['dividends', 'ipos', 'economic']],
	['finance.news', ['general', 'stock', 'flash', 'announcement']],
]);
const playerTypes = new Set(['player', 'ranked', 'mastery', 'live_game']);
// Match IDs carry a platform ID. Riot's Match-V5 reference includes ME1, and its
// platform table also lists the legacy PH2/TH2 routes. Keep beta IDs recognizable.
// https://developer.riotgames.com/docs/lol#routing-values_platform-routing-values
// https://developer.riotgames.com/api-details/match-v5
const matchPlatforms = new Set([
	'BR1',
	'EUN1',
	'EUW1',
	'JP1',
	'KR',
	'LA1',
	'LA2',
	'ME1',
	'NA1',
	'OC1',
	'PH2',
	'RU',
	'SG2',
	'TH2',
	'TR1',
	'TW2',
	'VN2',
	'PBE1',
]);
const undividedTiers = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
const esportsChoices: Record<string, string[]> = {
	type: [...playerTypes, 'match_detail', 'leaderboard', 'champion', 'item', 'champion_rotation'],
	region: ['kr', 'na', 'euw', 'eune', 'jp', 'br', 'la1', 'la2', 'oc', 'tr', 'ru', 'sg', 'sea'],
	queue: ['RANKED_SOLO_5x5', 'RANKED_FLEX_SR'],
	tier: [...undividedTiers, 'DIAMOND', 'EMERALD', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE', 'IRON'],
	division: ['I', 'II', 'III', 'IV'],
};

const flashSources = [
	'sina',
	'wallstreetcn',
	'10jqka',
	'eastmoney',
	'cls',
	'yicai',
	'yuncaijing',
	'fenghuang',
	'jinrongjie',
];
const socialTypes = [
	'weibo',
	'weibo_hot',
	'zhihu',
	'zhihu_hot',
	'x_top',
	'x_latest',
	'x_media',
	'x_people',
	'x_lists',
	'reddit_post',
	'reddit_community',
	'reddit_comment',
	'reddit_media',
	'reddit_people',
	'linkedin_people',
	'linkedin_jobs',
	'linkedin_company',
	'linkedin_posts',
	'wechatmp',
];

function checkChoice(
	node: INode,
	tag: string,
	field: string,
	value: unknown,
	choices: string[],
): void {
	if (value !== undefined && (typeof value !== 'string' || !choices.includes(value))) {
		throw new NodeOperationError(
			node,
			`For ${tag}, ${field} must be one of: ${choices.join(', ')}.`,
		);
	}
}

function esportsRequirements(node: INode, params: IDataObject, type: string): string[] {
	for (const [field, choices] of Object.entries(esportsChoices)) {
		checkChoice(node, 'gaming.esports', field, params[field], choices);
	}
	if (playerTypes.has(type)) {
		if (typeof params.game_name === 'string') {
			const parts = params.game_name.split('#');
			if (parts.length > 2 || parts.some((part) => !part.trim())) {
				throw new NodeOperationError(node, 'Provide game_name as a player name or name#tag.');
			}
		}
		const required = ['region', 'game_name'];
		if (type === 'mastery' && params.champion !== undefined) required.push('champion');
		return required;
	}
	if (type === 'match_detail') {
		const match = typeof params.match_id === 'string' && /^([A-Z0-9]+)_\d+$/.exec(params.match_id);
		if (!match || !matchPlatforms.has(match[1])) {
			throw new NodeOperationError(
				node,
				'Provide match_id as a Riot platform ID and numeric match number (for example, KR_7482819248).',
			);
		}
	}
	if (type === 'leaderboard') {
		if (params.division === undefined) return ['region'];
		if (undividedTiers.includes(String(params.tier))) {
			throw new NodeOperationError(
				node,
				'Omit division for Master, Grandmaster or Challenger leaderboards.',
			);
		}
		return ['region', 'tier'];
	}
	return [];
}

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
	const period = params?.period;
	if (
		period !== undefined &&
		quoteRangeTypes.get(tag)?.includes(type) &&
		(typeof period !== 'string' || !/^(?:0*[1-9]\d*d|[15]y)$/.test(period))
	) {
		throw new NodeOperationError(
			node,
			`For ${tag}, period must be a positive day range such as 7d, or 1y or 5y.`,
		);
	}
	let allowEmpty: string[] = [];
	let conditional: string[] = [];
	if (tag === 'travel.flight_status') {
		params = withDefault(params, 'departure', '');
		allowEmpty = ['departure'];
	} else if (tag === 'finance.fundamental') {
		allowEmpty = ['symbol', 'cn_code'];
		if (type === 'overview') {
			checkChoice(node, tag, 'period', params?.period, ['annual', 'quarter']);
			// An empty symbol lets the service read the ticker from the query.
			params = { ...withDefault(params, 'symbol', ''), cn_code: '' };
		} else if (statements.has(type)) {
			params = { ...params, symbol: '' };
			allowEmpty = ['symbol'];
		}
	} else if (tag === 'gaming.esports') {
		conditional = esportsRequirements(node, params ?? {}, type);
	} else if (tag === 'finance.news' && type === 'flash') {
		checkChoice(node, tag, 'news_src', params?.news_src, flashSources);
	} else if (tag === 'social_media.social_media') {
		checkChoice(node, tag, 'type', params?.type, socialTypes);
	} else if (tag === 'finance.quote' && type === 'crypto') {
		conditional = ['symbol'];
	} else if (tag === 'finance.calendar' && type === 'earnings') {
		params = { ...params, period: '90d' };
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
