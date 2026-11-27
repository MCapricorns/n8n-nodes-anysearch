import type { IDataObject } from 'n8n-workflow';
import type { CapabilityRuleMap, FieldRule } from './parameterRules';
import {
	choice,
	countryCode,
	currency,
	dateRange,
	dateValue,
	dayRange,
	format,
	integer,
	lookback,
	numberRange,
	quarter,
	tightList,
} from './parameterRules';

// Apply a rule only when a selector parameter has one of the listed values.
function scoped(key: string, rule: FieldRule, ...values: string[]): FieldRule {
	return {
		...rule,
		applies: (params) => {
			const selected = params[key];
			return typeof selected === 'string' && values.includes(selected);
		},
	};
}

// Validate with the rule of the group that contains the selector value.
function bySelector(key: string, groups: [values: string[], rule: FieldRule][]): FieldRule {
	return {
		matches(value, params) {
			const group = groups.find(([values]) => values.includes(params[key] as string));
			return group === undefined || group[1].matches(value, params);
		},
		expected: groups.map(([values, rule]) => `${rule.expected} (${values.join('/')})`).join('; '),
	};
}

// The catalog lists the markets that support each restricted type.
function typeMarkets(supported: Record<string, string[]>) {
	return ({ type, market }: IDataObject) => {
		const markets = typeof type === 'string' ? supported[type] : undefined;
		if (markets === undefined || typeof market !== 'string' || markets.includes(market))
			return undefined;
		return `type ${type} supports market ${markets.join(', ')} only.`;
	};
}

// "Required when …" conditions stated in the field descriptions.
function requiredWhen(field: string, key: string, value: string) {
	return (params: IDataObject) =>
		params[key] === value && params[field] === undefined
			? `Provide ${field} when ${key} is ${value}.`
			: undefined;
}

function checks(...rules: Array<(params: IDataObject) => string | undefined>) {
	return (params: IDataObject) =>
		rules.map((rule) => rule(params)).find((error) => error !== undefined);
}

// "US indicators: level. CN GDP: level/yoy/cumulative/period; CPI: level/yoy/mom/cumulative;
// PMI/SHIBOR/LPR: level; money_supply: level/yoy/mom; social_finance: level/cumulative/period."
const cnMeasures: Record<string, string[]> = {
	gdp: ['level', 'yoy', 'cumulative', 'period'],
	cpi: ['level', 'yoy', 'mom', 'cumulative'],
	money_supply: ['level', 'yoy', 'mom'],
	social_finance: ['level', 'cumulative', 'period'],
};
const measure: FieldRule = {
	matches(value, params) {
		if (typeof value !== 'string') return false;
		if (params.market !== 'CN') return value === 'level';
		return (cnMeasures[String(params.type)] ?? ['level']).includes(value);
	},
	expected: 'level, or for CN also yoy, mom, cumulative or period',
};

const playerTypes = ['player', 'ranked', 'mastery', 'live_game'];
const regions = [
	'kr',
	'na',
	'euw',
	'eune',
	'jp',
	'br',
	'la1',
	'la2',
	'oc',
	'tr',
	'ru',
	'sg',
	'sea',
];
// "Leaderboard only: CHALLENGER | GRANDMASTER | MASTER | DIAMOND | EMERALD | PLATINUM | GOLD
// | SILVER | BRONZE | IRON. Apex tiers ignore division."
const apexTiers = ['CHALLENGER', 'GRANDMASTER', 'MASTER'];
const dividedTiers = ['DIAMOND', 'EMERALD', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE', 'IRON'];
const matchId = format(
	/^[a-z\d]+_\d+$/i,
	'a platform-prefixed numeric match ID such as KR_7482819248',
);
// "Riot ID with tag line, e.g. Hide on bush#KR1. The tag is required"
const riotId: FieldRule = {
	expected: 'a Riot ID with a tag line such as Hide on bush#KR1',
	matches: (value) => {
		if (typeof value !== 'string') return false;
		const [name, tag, extra] = value.split('#');
		return extra === undefined && name.trim() !== '' && /^[^\s#]+$/.test(tag ?? '');
	},
};

function hasText(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '';
}

function validateEsports(params: IDataObject): string | undefined {
	const { type, region, tier, division } = params;
	if (typeof type !== 'string') return undefined;
	// "Required for player/ranked/mastery/live_game/leaderboard"
	if ((playerTypes.includes(type) || type === 'leaderboard') && !hasText(region)) {
		return `Provide region for gaming.esports type ${type}.`;
	}
	// "division: Only with DIAMOND-IRON tier" and "tier: Leaderboard only"
	const divided = type === 'leaderboard' && typeof tier === 'string' && dividedTiers.includes(tier);
	if (division !== undefined && !divided) {
		return 'Use division only with a leaderboard tier from DIAMOND to IRON.';
	}
	return undefined;
}

export const marketParameterRules: CapabilityRuleMap = {
	'finance.calendar': {
		fields: {
			currency: scoped('type', currency, 'economic'),
			date_range: dateRange(),
			date_type: bySelector('type', [
				[['earnings'], choice('announcement', 'pre', 'actual')],
				[['dividends'], choice('announcement', 'implementation', 'record', 'ex', 'payment')],
				[['ipos'], choice('subscription', 'listing')],
				[['corporate_action'], choice('announcement', 'float')],
			]),
			event_type: scoped(
				'type',
				choice('repurchase', 'holder_trade', 'pledge', 'unlock'),
				'corporate_action',
			),
			exchange: scoped(
				'type',
				choice('SSE', 'SZSE', 'CFFEX', 'SHFE', 'CZCE', 'DCE', 'INE'),
				'trade_cal',
			),
			market: choice('CN', 'HK', 'US', 'GLOBAL'),
			// "US calendar paths allow up to 90 inclusive days."
			period: {
				matches(value, params) {
					return (
						dayRange.matches(value, params) &&
						(params.market !== 'US' || Number.parseInt(String(value), 10) <= 90)
					);
				},
				expected: 'a positive day range such as 7d, 30d or 90d, up to 90d for US',
			},
			report_period: scoped('type', quarter(true), 'earnings', 'forecast', 'express'),
			type: choice(
				'earnings',
				'dividends',
				'ipos',
				'economic',
				'forecast',
				'express',
				'trade_cal',
				'corporate_action',
			),
		},
		check: checks(
			typeMarkets({
				forecast: ['CN'],
				express: ['CN'],
				trade_cal: ['CN'],
				corporate_action: ['CN'],
			}),
			requiredWhen('event_type', 'type', 'corporate_action'),
			requiredWhen('exchange', 'type', 'trade_cal'),
		),
	},
	'finance.fundamental': {
		fields: {
			aggregation: bySelector('type', [
				[['ratings'], choice('consensus', 'individual')],
				[['estimates'], choice('consensus')],
			]),
			date_range: dateRange(),
			market: choice('CN', 'HK', 'US'),
			metric_ids: scoped('type', tightList(format(/^\w+$/, 'an ID such as pe_ttm')), 'metrics'),
			report_basis: bySelector('type', [
				[['overview', 'estimates', 'balance'], choice('annual', 'single_quarter')],
				[['income', 'cashflow'], choice('single_quarter', 'cumulative', 'annual', 'ttm')],
			]),
			report_period: quarter(),
			selection: choice('latest', 'report_end_date'),
			type: choice(
				'overview',
				'income',
				'balance',
				'cashflow',
				'metrics',
				'ratings',
				'estimates',
				'holder',
				'fund_holding',
				'regulatory_filing',
			),
		},
		check: checks(
			typeMarkets({ ratings: ['HK', 'US'], regulatory_filing: ['US'] }),
			requiredWhen('report_period', 'selection', 'report_end_date'),
		),
	},
	'finance.macro': {
		fields: {
			date_range: dateRange(),
			market: choice('CN', 'US'),
			measure,
			period: choice('7d', '14d', '30d', '45d', '90d', '180d', '365d'),
			tenor: bySelector('type', [
				[['shibor'], choice('overnight', 'on', '1w', '2w', '1m', '3m', '6m', '9m', '1y')],
				[['lpr'], choice('1y', '5y')],
			]),
			type: choice(
				'gdp',
				'cpi',
				'pmi',
				'fed_funds',
				'unemployment',
				'nonfarm',
				'shibor',
				'lpr',
				'money_supply',
				'social_finance',
			),
		},
		check: typeMarkets({
			pmi: ['CN'],
			shibor: ['CN'],
			lpr: ['CN'],
			money_supply: ['CN'],
			social_finance: ['CN'],
			fed_funds: ['US'],
			unemployment: ['US'],
			nonfarm: ['US'],
		}),
	},
	'finance.news': {
		fields: {
			content_scope: choice('summary', 'full_text'),
			// "News window YYYY-MM-DD..YYYY-MM-DD; datetime values are normalized where supported."
			date_range: dateRange(true),
			market: choice('CN', 'HK', 'US', 'GLOBAL'),
			news_src: scoped(
				'type',
				choice(
					'sina',
					'cls',
					'10jqka',
					'wallstreetcn',
					'xinhua',
					'fenghuang',
					'cs',
					'caixin',
					'yicai',
				),
				'long_form',
			),
			period: dayRange,
			report_period: format(/^\d{4}Q[1-4]$/, 'a fiscal period such as 2026Q3'),
			type: choice('general', 'stock', 'transcript', 'long_form'),
		},
		check: checks(
			typeMarkets({
				general: ['US', 'GLOBAL'],
				stock: ['US', 'GLOBAL'],
				transcript: ['US', 'GLOBAL'],
				long_form: ['CN', 'GLOBAL'],
			}),
			requiredWhen('symbol', 'type', 'stock'),
			requiredWhen('symbol', 'type', 'transcript'),
			requiredWhen('report_period', 'type', 'transcript'),
		),
	},
	'finance.quote': {
		fields: {
			adjustment: choice('none', 'qfq', 'hfq'),
			date_range: dateRange(),
			frequency: bySelector('operation', [
				[['minute'], choice('1m')],
				[['history'], choice('1d', '1w', '1mo')],
			]),
			market: choice('CN', 'HK', 'US', 'GLOBAL'),
			nav_type: scoped('operation', choice('unit', 'adjusted'), 'nav'),
			operation: choice(
				'latest_available',
				'history',
				'minute',
				'nav',
				'fund_profile',
				'group_performance',
				'moneyflow',
				'margin',
				'trading_activity',
			),
			period: lookback,
			type: choice(
				'stock',
				'etf',
				'fund',
				'index',
				'forex',
				'crypto',
				'commodity',
				'futures',
				'convertible_bond',
			),
		},
		check: checks(
			typeMarkets({
				stock: ['CN', 'HK', 'US'],
				etf: ['CN', 'HK', 'US'],
				index: ['CN', 'US'],
				fund: ['CN', 'US'],
				forex: ['GLOBAL'],
				crypto: ['GLOBAL'],
				commodity: ['GLOBAL'],
				futures: ['CN'],
				convertible_bond: ['CN'],
			}),
			// "Required for security-level quote operations.
			// US sector snapshots and commodity-wide snapshots omit it."
			(params) =>
				params.symbol === undefined &&
				params.type !== 'commodity' &&
				!(params.operation === 'group_performance' && params.market === 'US')
					? 'Provide symbol for security-level quote operations.'
					: undefined,
		),
	},
	'finance.screen': {
		fields: {
			dividend_yield: scoped('type', numberRange(0, 100), 'stock'),
			market: choice('CN', 'HK', 'US', 'GLOBAL'),
			market_cap: scoped('type', numberRange(), 'stock'),
			page: integer(1),
			pe: scoped('type', numberRange(), 'stock'),
			registration_country: scoped('type', countryCode, 'stock'),
			roe: scoped('type', numberRange(), 'stock'),
			// Accepted sector names and the GICS aliases listed in the catalog.
			sector: scoped(
				'type',
				choice(
					'Technology',
					'Healthcare',
					'Financial Services',
					'Consumer Cyclical',
					'Consumer Defensive',
					'Industrials',
					'Energy',
					'Basic Materials',
					'Communication Services',
					'Real Estate',
					'Utilities',
					'Health Care',
					'Information Technology',
					'Financials',
					'Materials',
					'Consumer Discretionary',
					'Consumer Staples',
				),
				'stock',
			),
			snapshot_date: scoped('type', dateValue('YYYY-MM-DD'), 'stock'),
			sort: scoped(
				'type',
				format(
					/^-?(?:market_cap|pe_ttm|dividend_yield|roe)$/,
					'market_cap, pe_ttm, dividend_yield or roe, with an optional - prefix',
				),
				'stock',
			),
			type: choice('stock', 'etf', 'index_weight'),
		},
		check: checks(
			typeMarkets({ index_weight: ['CN'] }),
			requiredWhen('symbol', 'type', 'index_weight'),
		),
	},
	'gaming.esports': {
		fields: {
			// "Mastery only: result count, default max_results"
			count: scoped('type', integer(1), 'mastery'),
			division: scoped('type', choice('I', 'II', 'III', 'IV'), 'leaderboard'),
			game_name: scoped('type', riotId, ...playerTypes),
			match_id: scoped('type', matchId, 'match_detail'),
			queue: scoped('type', choice('RANKED_SOLO_5x5', 'RANKED_FLEX_SR'), 'leaderboard'),
			region: scoped(
				'type',
				choice(...regions),
				...playerTypes,
				'leaderboard',
				'champion_rotation',
			),
			tier: scoped('type', choice(...apexTiers, ...dividedTiers), 'leaderboard'),
			type: choice(
				...playerTypes,
				'match_detail',
				'leaderboard',
				'champion',
				'item',
				'champion_rotation',
			),
		},
		check: validateEsports,
	},
	// "Optional result language: en | zh | ja | ko." and
	// "Optional 2-letter Steam country code for pricing, e.g. us, cn, jp."
	'gaming.store': {
		fields: { language: choice('en', 'zh', 'ja', 'ko'), region: countryCode },
	},
	'social_media.social_media': {
		fields: {
			type: choice(
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
			),
		},
	},
};
