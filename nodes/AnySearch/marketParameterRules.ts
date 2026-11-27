import type { IDataObject } from 'n8n-workflow';
import type { CapabilityRuleMap, FieldRule } from './parameterRules';
import { choice, format } from './parameterRules';

const quotePeriod = format(
	/^(?:0*[1-9]\d*d|[15]y)$/,
	'a positive day range such as 7d, or 1y or 5y',
);
const macroPeriod = format(
	/^(?:0*[1-9]\d*d|[125]y)$/,
	'a positive day range such as 7d, or 1y, 2y or 5y',
);

function forTypes(rule: FieldRule, ...types: string[]): FieldRule {
	return {
		...rule,
		applies: (params) => typeof params.type === 'string' && types.includes(params.type),
	};
}

// ISO 3166-1 assigned alpha-2 codes, including territories.
const countryCodes = new Set(
	`AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN
	BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
	DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL
	GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM
	JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME
	MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP
	NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD
	SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO
	TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(/\s+/),
);
const countryCode: FieldRule = {
	expected: 'an ISO 3166-1 alpha-2 country code such as US',
	matches: (value) =>
		typeof value === 'string' &&
		/^[A-Za-z]{2}$/.test(value) &&
		countryCodes.has(value.toUpperCase()),
};

const playerTypes = ['player', 'ranked', 'mastery', 'live_game'];
const undividedTiers = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
const matchId = format(
	/^[a-z\d]+_\d+$/i,
	'a platform-prefixed numeric match ID such as KR_7482819248',
);
const playerName: FieldRule = {
	expected: 'a player name or name#tag',
	matches: (value) => {
		if (typeof value !== 'string') return false;
		const parts = value.split('#');
		return parts.length <= 2 && parts.every((part) => part.trim() !== '');
	},
};

function hasText(value: unknown): value is string {
	return typeof value === 'string' && value.trim() !== '';
}

function validateEsports(params: IDataObject): string | undefined {
	const { type, game_name, match_id, region, tier, division } = params;
	if (typeof type !== 'string') return undefined;
	const player = playerTypes.includes(type);
	if ((player || type === 'leaderboard') && !hasText(region)) {
		return `Provide region for gaming.esports type ${type}.`;
	}
	if (player && !hasText(game_name)) return `Provide game_name for gaming.esports type ${type}.`;
	if (type === 'match_detail' && !hasText(match_id)) {
		return 'Provide match_id for gaming.esports match_detail.';
	}
	if (type === 'leaderboard' && division !== undefined) {
		if (!hasText(tier)) return 'Provide tier when using division for gaming.esports leaderboard.';
		if (undividedTiers.includes(tier)) {
			return 'Omit division for Master, Grandmaster or Challenger leaderboards.';
		}
	}
	return undefined;
}

export const marketParameterRules: CapabilityRuleMap = {
	'finance.calendar': {
		fields: {
			type: choice('earnings', 'dividends', 'ipos', 'economic'),
			period: forTypes(quotePeriod, 'dividends', 'ipos', 'economic'),
		},
	},
	'finance.fundamental': {
		fields: {
			type: choice('overview', 'income', 'balance', 'cashflow', 'indicator', 'holder'),
			period: forTypes(choice('annual', 'quarter'), 'overview'),
		},
	},
	'finance.macro': {
		fields: {
			type: choice(
				'gdp',
				'cpi',
				'fed_funds',
				'treasury',
				'unemployment',
				'nonfarm',
				'shibor',
				'lpr',
				'money_supply',
				'social_finance',
			),
			period: macroPeriod,
		},
	},
	'finance.news': {
		fields: {
			type: choice('general', 'stock', 'flash', 'announcement'),
			period: quotePeriod,
			news_src: forTypes(
				choice(
					'sina',
					'wallstreetcn',
					'10jqka',
					'eastmoney',
					'cls',
					'yicai',
					'yuncaijing',
					'fenghuang',
					'jinrongjie',
				),
				'flash',
			),
		},
	},
	'finance.quote': {
		fields: {
			type: choice('stock', 'forex', 'crypto', 'commodity', 'index', 'etf'),
			period: quotePeriod,
			symbol: forTypes(
				format(/^[A-Za-z]{6}$/, 'a six-letter currency pair such as EURUSD'),
				'forex',
			),
		},
		check: (params) =>
			params.type === 'crypto' && !hasText(params.symbol)
				? 'Provide symbol for finance.quote type crypto.'
				: undefined,
	},
	'finance.screen': {
		fields: {
			type: choice('stock', 'etf'),
			country: forTypes(countryCode, 'stock'),
			sector: forTypes(
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
				),
				'stock',
			),
		},
	},
	'gaming.esports': {
		fields: {
			type: choice(
				...playerTypes,
				'match_detail',
				'leaderboard',
				'champion',
				'item',
				'champion_rotation',
			),
			region: choice(
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
			),
			queue: choice('RANKED_SOLO_5x5', 'RANKED_FLEX_SR'),
			tier: choice(
				...undividedTiers,
				'DIAMOND',
				'EMERALD',
				'PLATINUM',
				'GOLD',
				'SILVER',
				'BRONZE',
				'IRON',
			),
			division: choice('I', 'II', 'III', 'IV'),
			match_id: forTypes(matchId, 'match_detail'),
			game_name: forTypes(playerName, ...playerTypes),
		},
		check: validateEsports,
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
