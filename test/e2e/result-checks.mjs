import assert from 'node:assert/strict';

// These checks qualify hits in the acceptance suite. The search node preserves API results.
class MissingEvidence extends Error {}

function requireEvidence(condition, reason) {
	if (!condition) throw new MissingEvidence(reason);
}

// Display names that long-form snippets carry in their src= line.
const newsSourceNames = { sina: '新浪财经' };

const reddit = ['reddit.com'];
const linkedin = ['linkedin.com'];
const x = ['x.com', 'twitter.com'];
const statusPath = /^\/[^/]+\/status\/\d+(?:\/(?:photo|video)\/\d+)?\/?$/i;
const weiboPost = /^\/(?:(?:detail|status)\/[A-Za-z0-9]+|\d+\/[A-Za-z0-9]+)\/?$/;
const zhihuPost = /^\/(?:question\/\d+(?:\/answer\/\d+)?|p\/\d+|zvideo\/\d+)\/?$/;
const socialSources = {
	weibo: [['weibo.com', 'weibo.cn'], weiboPost],
	weibo_hot: [['weibo.com', 'weibo.cn']],
	zhihu: [['zhihu.com'], zhihuPost],
	zhihu_hot: [['zhihu.com']],
	x_top: [x, statusPath],
	x_latest: [x, statusPath],
	x_media: [[...x, 'pbs.twimg.com', 'video.twimg.com']],
	x_people: [
		x,
		/^\/(?!(?:home|explore|search|settings|i|notifications|messages|compose|login|logout|signup|tos|terms|privacy|about|help|share|intent|hashtag)\/?$)[\w]{1,15}\/?$/i,
	],
	x_lists: [x, /^\/(?:i\/lists\/\d+|(?!i\/)\w{1,15}\/lists\/[\w-]+)\/?$/i],
	reddit_post: [reddit, /^\/(?:r\/[\w]+\/)?comments\/[a-z0-9]+(?:\/[^/]+)?\/?$/i],
	reddit_community: [reddit, /^\/r\/[\w]+\/?$/i],
	reddit_comment: [reddit, /^\/(?:r\/[\w]+\/)?comments\/[a-z0-9]+\/[^/]+\/[a-z0-9]+\/?$/i],
	reddit_media: [['reddit.com', 'i.redd.it', 'v.redd.it']],
	reddit_people: [reddit, /^\/(?:u|user)\/[\w-]+\/?$/i],
	linkedin_people: [linkedin, /^\/in\/[^/]+\/?$/i],
	linkedin_jobs: [linkedin, /^\/jobs\/view\/(?:[^/]+-)?\d+\/?$/i],
	linkedin_company: [linkedin, /^\/company\/[^/]+\/?$/i],
	linkedin_posts: [
		linkedin,
		/^\/(?:posts\/[^/]*[-_]activity-\d+(?:-[^/]+)?|feed\/update\/urn:li:(?:activity|share|ugcPost):\d+)\/?$/i,
	],
	wechatmp: [['mp.weixin.qq.com'], /^\/s(?:\/[^/]+)?\/?$/],
};

function fromHost(url, hosts) {
	return hosts.some((host) => url?.hostname === host || url?.hostname.endsWith('.' + host));
}

function sourceUrl(value) {
	if (!value) return undefined;
	const url = new URL(value);
	assert(['https:', 'http:'].includes(url.protocol), 'Expected an HTTP source URL');
	return url;
}

function matchesCollection(url, collection) {
	if (!url) return false;
	const path = url.pathname;
	if (fromHost(url, ['govinfo.gov'])) {
		const code =
			/^\/(?:app\/details|content\/pkg)\/([A-Z]+)-[^/]+/i.exec(path)?.[1] ??
			/^\/link\/([a-z]+)\/\d+/i.exec(path)?.[1];
		if (code) return code.toUpperCase() === collection;
	}
	switch (collection) {
		case 'FR':
			return (
				fromHost(url, ['federalregister.gov']) &&
				/^\/(?:documents\/\d{4}\/\d\d\/\d\d\/|d\/)(?:[a-z\d]+-)*\d+-\d+(?:\/|$)/i.test(path)
			);
		case 'CFR':
			return (
				(fromHost(url, ['ecfr.gov']) && /^\/(?:current|on\/[\d-]+)\/title-\d+/.test(path)) ||
				(fromHost(url, ['law.cornell.edu']) && /^\/cfr\/text\/\d+/.test(path))
			);
		case 'USCODE':
			return (
				(fromHost(url, ['uscode.house.gov']) &&
					path === '/view.xhtml' &&
					/(?:\bgranuleid:USC-|title[: -]?\d+)/i.test(
						url.searchParams.get('req') || url.searchParams.get('path'),
					)) ||
				(fromHost(url, ['law.cornell.edu']) && /^\/uscode\/text\/\d+/.test(path))
			);
		case 'BILLS':
			return (
				fromHost(url, ['congress.gov']) &&
				/^\/bill\/\d+[a-z]+-congress\/[\w-]+\/\d+(?:\/|$)/.test(path)
			);
		default:
			return undefined;
	}
}

// A publisher URL can expose the record DOI even when the API omits a DOI field.
function doiFromUrl(url) {
	if (!url) return undefined;
	const path = decodeURIComponent(url.pathname).toLowerCase().replace(/\/$/, '');
	if (fromHost(url, ['doi.org'])) return path.slice(1);
	if (fromHost(url, ['arxiv.org'])) {
		const id = /^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?$/.exec(path)?.[1];
		if (id) return '10.48550/arxiv.' + id;
	}
	if (fromHost(url, ['nature.com']) && path.startsWith('/articles/')) {
		return '10.1038/' + path.slice('/articles/'.length);
	}
	if (fromHost(url, ['plos.org']) && /\/article(?:\/file)?$/.test(path)) {
		return url.searchParams.get('id')?.toLowerCase();
	}
	if (fromHost(url, ['springer.com']) && path.startsWith('/content/pdf/'))
		return /^\/content\/pdf\/(10\.\d{4,9}\/.+)\.pdf$/.exec(path)?.[1];
	if (
		fromHost(url, [
			'springer.com',
			'wiley.com',
			'tandfonline.com',
			'acm.org',
			'plos.org',
			'crossref.org',
			'science.org',
			'nejm.org',
		])
	) {
		return /\/(10\.\d{4,9}\/.+)$/.exec(path)?.[1];
	}
}

function paperHeader(content) {
	const fields = {};
	if (typeof content !== 'string') return fields;
	// The provider renders this header on a single line before the abstract.
	const head = content.split(/\bAbstract:\s*/i, 1)[0];
	const labels = [
		...head.matchAll(
			/\b(OpenAlex ID|DOI|Authors?|Publication type|Type|Venue|Journal|Publication date|Publication year|Citation count|Open access|Language):\s*/gi,
		),
	];
	if (!labels.length || head.slice(0, labels[0].index).trim()) return fields;
	for (const [i, label] of labels.entries()) {
		fields[label[1].toLowerCase()] = head
			.slice(label.index + label[0].length, labels[i + 1]?.index)
			.replace(/[|;•]\s*$/, '')
			.trim();
	}
	return fields;
}

function matchesDoi(result, url, id) {
	const identifiers = [
		doiFromUrl(url),
		result.doi,
		contentRecord(result.content)?.doi,
		paperHeader(result.content).doi,
	].filter((value) => typeof value === 'string' && value.trim());
	if (!identifiers.length) return undefined;
	return identifiers.every(
		(value) =>
			value
				.trim()
				.replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i, '')
				.toLowerCase() === id.toLowerCase(),
	);
}

const platforms = {
	na: 'NA1',
	euw: 'EUW1',
	eune: 'EUN1',
	oc: 'OC1',
	sea: 'SG2',
	sg: 'SG2',
	jp: 'JP1',
	br: 'BR1',
	tr: 'TR1',
};

function matchIdFromUrl(url) {
	const match =
		fromHost(url, ['leagueofgraphs.com']) && /^\/match\/([a-z]+\d*)\/(\d+)/i.exec(url.pathname);
	if (match) return (platforms[match[1].toLowerCase()] ?? match[1].toUpperCase()) + '_' + match[2];
	if (fromHost(url, ['riotgames.com']))
		return /^\/lol\/match\/v5\/matches\/([A-Z]+\d*_\d+)\/?$/.exec(url.pathname)?.[1];
}

function contentRecord(content) {
	try {
		const parsed = JSON.parse(content);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

// The service answers an unknown match ID or item name with a no_data record for it.
function noDataFor(result, kind, subject) {
	const record = contentRecord(result.content);
	return record?.status === 'no_data' && record.kind === kind && record.subject === subject;
}

// A match page links the ID; a participant row names it.
function matchesGame(result, url, id) {
	if (noDataFor(result, 'match', id)) return true;
	const record = contentRecord(result.content);
	const linkId = matchIdFromUrl(url);
	if ((linkId && linkId !== id) || (record?.matchId !== undefined && record.matchId !== id))
		return false;
	return linkId === id || record?.matchId === id;
}

function checkRankedQueue(result, row, url, expected) {
	const namedQueues = { 420: 'RANKED_SOLO_5X5', 440: 'RANKED_FLEX_SR' };
	const queueInPath = /\/(RANKED_SOLO_5x5|RANKED_FLEX_SR)(?:\/|$)/i.exec(url?.pathname ?? '')?.[1];
	const queues = [
		...[result, row].flatMap((source) => [source.queueType, source.queueId, source.queue]),
		queueInPath,
		url?.searchParams.get('queue'),
		url?.searchParams.get('queueType'),
		url?.searchParams.get('queueId'),
	].filter((value) => value !== undefined && value !== null && value !== '');
	requireEvidence(queues.length, 'Missing leaderboard queue ' + expected);
	assert(
		queues.every(
			(value) =>
				(typeof value === 'string' || typeof value === 'number') &&
				(namedQueues[value] ?? String(value).toUpperCase()) === expected.toUpperCase(),
		),
		'Unexpected leaderboard queue',
	);
}

function checkLeaderboard(result, url, params) {
	const row = contentRecord(result.content) ?? result;
	// The live service links an individual leaderboard entry to the player's OP.GG profile.
	const region =
		fromHost(url, ['op.gg', 'u.gg', 'leagueofgraphs.com']) &&
		/\/(?:summoners?|rankings)\/([^/]+)\//i.exec(url.pathname)?.[1].toLowerCase();
	const expectedRegion = params.region.toLowerCase();
	const recordRegion = typeof row.region === 'string' ? row.region.toLowerCase() : row.region;
	assert(
		(region === expectedRegion || (!url && recordRegion === expectedRegion)) &&
			(recordRegion == null || recordRegion === expectedRegion),
		'Expected a leaderboard entry for region ' + params.region,
	);
	assert(
		Number.isFinite(row.leaguePoints) &&
			(typeof row.puuid === 'string' || Number.isFinite(row.wins)),
		'Expected a ranked player entry with league points',
	);
	const puuid = /\/by-puuid\/([^/]+)\/?$/.exec(url?.pathname ?? '')?.[1];
	if (puuid && row.puuid)
		assert.equal(decodeURIComponent(puuid), row.puuid, 'Unexpected leaderboard player ID');
	if (params.tier) {
		const titleTier =
			/\b(CHALLENGER|GRANDMASTER|MASTER|DIAMOND|EMERALD|PLATINUM|GOLD|SILVER|BRONZE|IRON)\b/i
				.exec(result.title ?? '')?.[1]
				.toUpperCase();
		const tiers = [row.tier, titleTier].filter(Boolean);
		assert(
			tiers.length && tiers.every((tier) => tier === params.tier),
			'Expected leaderboard tier ' + params.tier,
		);
	}
	if (params.division) {
		const divisions = [row.rank, row.division].filter((value) => value != null);
		assert(
			divisions.length && divisions.every((value) => value === params.division),
			'Expected leaderboard division ' + params.division,
		);
	}
	if (params.queue) checkRankedQueue(result, row, url, params.queue);
}

// Profile and mastery records carry the Riot ID of the requested player.
function namesPlayer(result, gameName) {
	const record = contentRecord(result.content) ?? {};
	const [name, tagline] = String(gameName ?? '')
		.toLowerCase()
		.split('#');
	return (
		typeof record.gameName === 'string' &&
		record.gameName.toLowerCase() === name &&
		(typeof record.tagLine !== 'string' || !tagline || record.tagLine.toLowerCase() === tagline)
	);
}

// A profile link names the player and its region.
function isProfileLink(url, params) {
	if (!fromHost(url, ['op.gg', 'leagueofgraphs.com', 'masterychart.com', 'u.gg'])) return false;
	const [name, tagline] = params.game_name.toLowerCase().split('#');
	const path = decodeURIComponent(url.pathname).replaceAll('+', ' ').toLowerCase();
	const profile = /\/(?:summoners?|profile)\/([^/]+)\/([^/]+)\/?$/.exec(path);
	return (
		profile?.[1] === params.region.toLowerCase() &&
		(tagline
			? profile[2] === name + '-' + tagline
			: profile[2] === name || profile[2].startsWith(name + '-'))
	);
}

// A recent-match row names a match of the player's region.
function isMatchRow(result, url, params) {
	const matchId = matchIdFromUrl(url);
	const record = contentRecord(result.content);
	return (
		Boolean(matchId) &&
		matchId.split('_')[0] === (platforms[params.region] ?? params.region.toUpperCase()) &&
		record?.matchId === matchId &&
		typeof record.championName === 'string'
	);
}

function matchesJudgment(result, url, params) {
	if (!fromHost(url, ['hudoc.echr.coe.int'])) return false;
	const itemId = url.searchParams.get('i') ?? url.searchParams.get('id');
	if (
		!/^001-\d+$/.test(itemId) &&
		!/"itemid"\s*:\s*\[\s*"001-\d+"/i.test(decodeURIComponent(url.hash))
	)
		return false;
	const record = contentRecord(result.content) ?? {};
	const kind = result.doc_type ?? result.document_type ?? record.doc_type ?? record.document_type;
	if (kind && !/^(?:judgment|arrêt)$/iu.test(kind)) return false;
	const headings = [result.title, result.snippet, result.content]
		.join('\n')
		.split(/\n|\||•|\s+[—–-]\s+/);
	if (
		!kind &&
		!headings.some((s) => /^\s*(?:(?:document type|doctype):\s*)?(?:judgment|arrêt)\b/iu.test(s))
	)
		return false;
	if (/\b(?:decision|press release)\b|décision/iu.test(result.title)) return false;
	if (!params.respondent) return true;
	const country = {
		FRA: /\bFrance\b/i,
		RUS: /\bRussia(?:n Federation)?\b|\bRussie\b/i,
		TUR: /\bTurkey\b|Türkiye|\bTurquie\b/i,
	}[params.respondent];
	const respondent = result.respondent ?? record.respondent;
	if (respondent && respondent !== params.respondent && !country?.test(respondent)) return false;
	const caption = /\s(?:v(?:s)?\.?|c\.|contre)\s+(.+)/i.exec(result.title ?? '')?.[1];
	if (caption && country) return country.test(caption);
	return Boolean(respondent);
}

function checkCanadianCase(result, url, params) {
	assert(
		fromHost(url, ['canlii.org', 'canlii.ca', 'scc-csc.ca']),
		'Expected a Canadian judgment record',
	);
	const path = decodeURIComponent(url.pathname);
	const canliiId = /\/(?:en|fr)\/[a-z]+\/[\w-]+\/doc\/\d{4}\/([\w-]+)\/\1\.html$/i.exec(path)?.[1];
	const courtRecord = fromHost(url, ['scc-csc.ca']) && /\/item\/\d+\/index\.do$/i.test(path);
	const shortLink = fromHost(url, ['canlii.ca']) && /^\/t\/[\w]+\/?$/i.test(path);
	assert(canliiId || courtRecord || shortLink, 'Expected a Canadian case document link');
	const record = contentRecord(result.content) ?? {};
	const normalize = (value) => String(value).toLowerCase().replace(/[\s.]/g, '');
	const citation =
		result.case_number ??
		record.case_number ??
		record.citation ??
		/\b\d{4}\s+[A-Z]{2,5}\s+\d+\b/.exec(result.title ?? '')?.[0];
	if (params.case_id) {
		const id = result.case_id ?? record.case_id ?? canliiId ?? citation;
		assert.equal(normalize(id), normalize(params.case_id), 'Unexpected Canadian case_id');
		if (canliiId)
			assert.equal(normalize(canliiId), normalize(params.case_id), 'Unexpected Canadian case link');
	}
	if (params.case_number) {
		assert.equal(
			normalize(citation ?? canliiId),
			normalize(params.case_number),
			'Unexpected Canadian case_number',
		);
	}
}

function matchesCanadianRegulation(url) {
	return (
		(fromHost(url, ['canlii.org']) &&
			/^\/(?:en\/ca\/laws\/regu|fr\/ca\/legis\/regl)\/[^/]+\/(?:latest|derniere|\d[^/]*)\/[^/]+\.html$/i.test(
				url.pathname,
			)) ||
		(fromHost(url, ['laws-lois.justice.gc.ca', 'laws.justice.gc.ca']) &&
			/^\/(?:eng\/regulations|fra\/reglements)\/(?:SOR|DORS|CRC|C\.R\.C\.|SI|TR)[^/]*\d/i.test(
				decodeURIComponent(url.pathname),
			))
	);
}

function paperDetails(result, url) {
	const structured = contentRecord(result.content) ?? {};
	const record = { ...result, ...structured };
	const snippet = (result.snippet ?? '').replace(/\s*\[Open Access\]\s*$/i, '');
	// AnySearch can return a compact bibliographic line instead of a JSON record.
	const citation =
		/^(.*?)\s+\((\d{4})\)\s+[—–-]\s+(.*?)(?:\s+[—–-]\s+cited\s+([\d,]+)\s+times?)?$/i.exec(
			snippet.trim(),
		);
	const headers = [paperHeader(result.snippet), paperHeader(result.content)];
	const metadata = { ...headers[0], ...headers[1] };
	const authors =
		record.authors ??
		record.authorships?.map((row) => row.author?.display_name) ??
		metadata.authors ??
		metadata.author ??
		citation?.[1];
	const names = Array.isArray(authors)
		? authors.map((author) =>
				typeof author === 'string' ? author : (author?.name ?? author?.display_name),
			)
		: String(authors ?? '').split(/[,;]/);
	const date = record.publication_date ?? record.publicationDate ?? metadata['publication date'];
	const years = [
		...[result, structured].flatMap((source) => [
			source.publication_year,
			source.year,
			...[source.publication_date, source.publicationDate].map(publicationDateYear),
		]),
		...headers.flatMap((header) => [
			header['publication year'],
			publicationDateYear(header['publication date']),
		]),
		citation?.[2],
	]
		.filter((v) => (typeof v === 'number' || typeof v === 'string') && /^\d{4}$/.test(v))
		.map(Number);
	const count =
		record.cited_by_count ??
		record.citationCount ??
		record.citation_count ??
		metadata['citation count'] ??
		citation?.[4] ??
		/\bcited\s+([\d,]+)\s+times?\b/i.exec(snippet)?.[1];
	const access =
		record.isOpenAccess ??
		record.is_oa ??
		record.open_access?.is_oa ??
		(typeof record.open_access !== 'object' ? record.open_access : undefined) ??
		metadata['open access'];
	return {
		years,
		date,
		authors: names.filter(Boolean),
		venue:
			record.venue ??
			record.primary_location?.source?.display_name ??
			metadata.venue ??
			metadata.journal ??
			citation?.[3],
		languages: [result.language, structured.language, ...headers.map((header) => header.language)]
			.filter((value) => typeof value === 'string' && value.trim())
			.map((value) => value.trim().toLowerCase()),
		citations: /^[\d,]+$/.test(count) ? Number(String(count).replaceAll(',', '')) : undefined,
		openAccess: access,
		type:
			record.publication_type ??
			record.type ??
			metadata['publication type'] ??
			metadata.type ??
			(fromHost(url, ['arxiv.org']) && /^\/(?:abs|pdf)\//.test(url.pathname)
				? 'preprint'
				: undefined),
	};
}

function publicationDateYear(value) {
	return typeof value === 'string' ? /^(\d{4})(?:-|$)/.exec(value)?.[1] : undefined;
}

function checkPaper(result, url, params) {
	const filters = Object.keys(params).filter((key) => key !== 'sort');
	const missing = new Set(filters);
	if (params.doi) {
		// A DOI lookup accepts a bare DOI, a doi: prefix, or an http(s)://doi.org/ URL.
		const requested = params.doi.replace(/^(?:doi:|https?:\/\/doi\.org\/)/i, '');
		const match = matchesDoi(result, url, requested);
		if (match !== undefined) {
			assert(match, 'Expected paper DOI ' + params.doi);
			missing.delete('doi');
		}
	}
	const paper = paperDetails(result, url);
	if (params.year && paper.years.length) {
		const [start, end] = String(params.year).split('-');
		const max = end === undefined ? start : end;
		assert(
			paper.years.every(
				(year) => (!start || year >= Number(start)) && (!max || year <= Number(max)),
			),
			'Expected publication year ' +
				params.year +
				', received ' +
				[...new Set(paper.years)].join(', '),
		);
		missing.delete('year');
	}
	if (params.language && paper.languages.length) {
		const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(params.language);
		assert(
			paper.languages.every(
				(observed) =>
					observed.split('-')[0] === params.language.toLowerCase() ||
					observed === name?.toLowerCase(),
			),
			'Unexpected paper language ' + [...new Set(paper.languages)].join(', '),
		);
		missing.delete('language');
	}
	if (params.min_citations !== undefined && paper.citations !== undefined) {
		assert(
			paper.citations >= Number(params.min_citations),
			'Paper has fewer than ' + params.min_citations + ' citations',
		);
		missing.delete('min_citations');
	}
	if (
		params.open_access !== undefined &&
		/^(?:true|false|yes|no|open|closed)$/i.test(paper.openAccess)
	) {
		assert.equal(
			/^(?:true|yes|open)$/i.test(paper.openAccess),
			String(params.open_access) === 'true',
			'Unexpected paper open-access status',
		);
		missing.delete('open_access');
	}
	const normalized = (value) => String(value).trim().toLowerCase();
	function matchesAny(requested, actual) {
		const choices = requested.split(',').map(normalized);
		return actual.some((v) => choices.includes(normalized(v)));
	}
	if (params.authors && paper.authors.length) {
		assert(matchesAny(params.authors, paper.authors), 'Unexpected paper authors');
		missing.delete('authors');
	}
	if (params.venue && typeof paper.venue === 'string') {
		const venueNames = [paper.venue];
		if (normalized(paper.venue) === 'neural information processing systems')
			venueNames.push('Advances in Neural Information Processing Systems');
		assert(matchesAny(params.venue, venueNames), 'Unexpected paper venue ' + paper.venue);
		missing.delete('venue');
	}
	if (params.publication_type && typeof paper.type === 'string') {
		const type = normalized(paper.type).replace(/[\s-]+/g, '_');
		const aliases = {
			article: 'journal_article',
			review_article: 'review',
			chapter: 'book_chapter',
			book_section: 'book_chapter',
			dissertation: 'thesis',
			posted_content: 'preprint',
		};
		assert(
			matchesAny(params.publication_type, [aliases[type] ?? type]),
			'Unexpected paper publication type ' + type,
		);
		missing.delete('publication_type');
	}
	// Test every identifiable field before reporting the missing ones.
	requireEvidence(!missing.has('doi'), 'No record DOI available to verify ' + params.doi);
	return filters.length ? missing.size === 0 : undefined;
}

function checkPaperOrder(sort, results) {
	if (results.length < 2 || !['cited', 'date_asc', 'date_desc'].includes(sort)) return false;
	const papers = results.map((result) => paperDetails(result, sourceUrl(result.url)));
	const values = papers.map((paper) => {
		if (sort === 'cited') return paper.citations;
		if (new Set(paper.years).size > 1) return undefined;
		if (typeof paper.date === 'string' && /^\d{4}(?:-\d{2}){0,2}$/.test(paper.date))
			return paper.date;
		return paper.years.length ? String(paper.years[0]) : undefined;
	});
	const observed = values.filter((value) => value !== undefined);
	let distinct = false;
	let sufficient = observed.length === values.length;
	for (const [index, earlier] of observed.entries()) {
		for (const later of observed.slice(index + 1)) {
			const precision = Math.min(String(earlier).length, String(later).length);
			const left = typeof earlier === 'string' ? earlier.slice(0, precision) : earlier;
			const right = typeof later === 'string' ? later.slice(0, precision) : later;
			assert(
				sort === 'date_asc' ? left <= right : left >= right,
				'Unexpected paper order for sort=' + sort,
			);
			distinct ||= left !== right;
			if (left === right && sort !== 'cited' && precision < 10) sufficient = false;
		}
	}
	return sufficient && distinct;
}

function checkDividend(result) {
	const record = contentRecord(result.content) ?? result;
	const titleSymbol = /^([A-Z0-9][A-Z0-9.-]{0,15})\s+(?:[Dd]ividend|分红)/.exec(
		result.title ?? '',
	)?.[1];
	const symbols = [record.ts_code, record.symbol, titleSymbol].filter(Boolean);
	assert(
		!symbols.some((s) => /^\d{6}\.(?:SH|SS|SZ|BJ)$/i.test(s)),
		'International dividend calendar returned an A-share ticker',
	);
	// An unlabeled calendar entry does not establish the market or event type.
	const dividend =
		/\bdividends?\b|分红|股息/i.test(result.title ?? '') || record.cash_div !== undefined;
	return dividend && symbols.some((s) => /^[A-Z][A-Z0-9.-]*$/.test(s));
}

// Security code suffixes identify the CN and HK markets; an unsuffixed ticker is a US symbol.
function impliedMarket(symbol) {
	if (/^\d{6}\.(?:SH|SZ|BJ)$/i.test(symbol)) return 'CN';
	if (/^\d{4,5}\.HK$/i.test(symbol)) return 'HK';
	return /^[A-Z][A-Z\d.-]*$/.test(symbol) ? 'US' : undefined;
}

// Calendar parameters that the tickers of a record demonstrate.
function calendarCheckedParameters(params, symbols) {
	const checked = ['type'];
	if (params.symbol) checked.push('symbol');
	if (
		params.market &&
		symbols.length &&
		symbols.every((value) => impliedMarket(value) === params.market)
	)
		checked.push('market');
	return checked;
}

// Tickers that a calendar record exposes for the security it describes.
function calendarSymbols(result, kind) {
	const record = contentRecord(result.content) ?? {};
	const title = String(result.title ?? '').trim();
	const header = String(result.content ?? '').split(/\s*\|\s*/);
	// The subject of an "AAPL earnings (2026-01-29)" title.
	const caption = new RegExp(`\\(([A-Z][A-Z0-9.-]*)\\)\\s+${kind}\\b`, 'i').exec(title)?.[1];
	return {
		caption,
		symbols: [
			result.symbol,
			result.cn_code,
			result.ts_code,
			record.symbol,
			record.cn_code,
			record.ts_code,
			/^([A-Z0-9][A-Z0-9.-]*)\s+(?:earnings\b|财报披露|业绩日历)/i.exec(title)?.[1],
			caption,
			...header.map((s) => /^Symbol:\s*([A-Z0-9.-]+)$/i.exec(s)?.[1]),
		].filter(Boolean),
	};
}

function checkEarnings(result, params) {
	const record = contentRecord(result.content) ?? {};
	const title = String(result.title ?? '').trim();
	const header = String(result.content ?? '').split(/\s*\|\s*/);
	const { symbols, caption } = calendarSymbols(result, 'earnings');
	const titleSubject =
		/^([A-Z0-9][A-Z0-9.-]*)\s+(?:earnings\b|财报披露|业绩日历)/i.exec(title)?.[1] ?? caption;
	const date = header.some((s) => /^Date:\s*\d{4}-\d{2}-\d{2}$/i.test(s));
	const calendar =
		/\bearnings calendar\b|财报披露|业绩日历/i.test(title) ||
		(titleSubject && /\bearnings\s*\(\d{4}-\d{2}-\d{2}\)/i.test(title)) ||
		(date && header.some((s) => /^CalendarSource:\s*market-calendar$/i.test(s))) ||
		(record.ts_code && record.end_date && (record.actual_date || record.pre_date)) ||
		(record.symbol &&
			record.date &&
			(record.epsEstimated !== undefined || record.eps_estimated !== undefined));
	assert(calendar, 'Expected an earnings calendar record');
	const ticker = params.symbol;
	if (ticker)
		assert(
			symbols.length &&
				symbols.every((value) => String(value).toUpperCase() === String(ticker).toUpperCase()),
			'Expected calendar ticker ' + ticker,
		);
	return true;
}

// Long-form articles carry no URL. The snippet is a metadata block whose lines name the
// source, publication time and text length; a source without rows returns a coverage status.
function checkLongFormNews(result, source) {
	const snippet = String(result.snippet ?? '');
	const coverage = /\bcoverage_status:\s*(\S+)/.exec(snippet)?.[1];
	if (coverage)
		throw new MissingEvidence('news_src ' + source + ' returned coverage_status ' + coverage);
	const name = /(?:^|\|)\s*src=([^|]+)/.exec(snippet)?.[1]?.trim();
	if (newsSourceNames[source]) {
		assert(name === newsSourceNames[source], 'Expected a long_form article from ' + source);
		return true;
	}
	requireEvidence(name, 'The long_form record for news_src ' + source + ' names no source');
	return false;
}

// The domain selects the FAOSTAT table; the record spells out the other filters.
function checkAgricultureStats(result, url, params) {
	requireEvidence(fromHost(url, ['fao.org']), 'Not a FAOSTAT record for ' + params.item);
	const text = [result.title, result.snippet, result.content].join('\n');
	for (const field of ['item', 'area', 'partner', 'element', 'year']) {
		if (params[field] !== undefined)
			assert(text.includes(params[field]), 'Expected ' + field + ' ' + params[field]);
	}
	return true;
}

function checkPatentApplicant(result, requested) {
	const record = contentRecord(result.content) ?? result;
	const text = String(result.content ?? '');
	const bibliography = text.split('=== Bibliographic Data ===')[1];
	const applicants =
		record.applicants ??
		record.applicant ??
		/\bapplicants:\s*(.+?)\s+inventors:/i.exec(bibliography ?? '')?.[1] ??
		record.assignees ??
		record.assignee ??
		/^Assignee:\s*([^|]+)/i.exec(result.snippet ?? '')?.[1] ??
		/\bAssignee:\s*(.+?)\s+Inventor:/i.exec(text.split('===')[0])?.[1];
	if (!applicants) return false;
	const names = Array.isArray(applicants) ? applicants : String(applicants).split(/[|;]/);
	const suffixes = new Set([
		'inc',
		'incorporated',
		'ltd',
		'limited',
		'co',
		'company',
		'corp',
		'corporation',
		'llc',
		'plc',
		'ag',
	]);
	const words = (name) =>
		(
			String(name)
				.normalize('NFKD')
				.toLowerCase()
				.match(/[\p{L}\p{N}]+/gu) ?? []
		).filter((w) => !suffixes.has(w));
	const expected = words(requested);
	const observed = names
		.map((name) => words(typeof name === 'string' ? name : (name?.name ?? '')))
		.filter((v) => v.length);
	if (!expected.length || !observed.length) return false;
	const initials = (parts) => parts.map((part) => part[0]).join('');
	if (
		observed.some(
			(parts) =>
				expected.every((w) => parts.includes(w)) ||
				(expected.length === 1 && expected[0] === initials(parts)) ||
				(parts.length === 1 && parts[0] === initials(expected)),
		)
	)
		return true;
	// Partial names and unexpanded acronyms cannot establish a distinct company.
	const uncertain =
		observed.some(
			(parts) =>
				parts.some((w) => expected.includes(w)) || (parts.length === 1 && parts[0].length <= 3),
		) ||
		(expected.length === 1 && expected[0].length <= 3);
	assert(uncertain, 'Patent applicant/assignee does not match ' + requested);
	return false;
}

function redditMediaPost(url, result) {
	if (!fromHost(url, reddit) || !socialSources.reddit_post[1].test(url.pathname)) return false;
	const header = String(result.content ?? '').split('--- Comments ---')[0];
	if (!/^Subreddit:\s*r\/\w+\s+Author:/i.test(header)) return false;
	return /\|\s*Comments:\s*\d+\s+(?:Type:\s*IMAGE\s+Domain:\s*i\.redd\.it|Type:\s*(?:HOSTED_)?VIDEO\s+Domain:\s*v\.redd\.it)(?:\s|\||$)/i.test(
		header,
	);
}

function matchesMedia(url, result, type) {
	const path = url.pathname;
	if (type === 'reddit_media') {
		if (url.hostname === 'i.redd.it') return /^\/[\w-]+\.(?:jpe?g|png|gif|webp)$/i.test(path);
		if (url.hostname === 'v.redd.it')
			return /^\/[a-z0-9]{6,}(?:\/(?:DASH_[^/]+\.mp4|HLSPlaylist\.m3u8))?\/?$/i.test(path);
		if (/^\/gallery\/[a-z0-9]+\/?$/i.test(path) || redditMediaPost(url, result)) return true;
		if (!socialSources.reddit_post[1].test(path)) return false;
	} else {
		if (url.hostname === 'pbs.twimg.com')
			return /^\/media\/[\w-]+(?:\.(?:jpe?g|png|gif|webp))?$/i.test(path);
		if (url.hostname === 'video.twimg.com')
			return /^\/(?:ext_tw_video|amplify_video|tweet_video)\/.+\.(?:mp4|m3u8)$/i.test(path);
		if (!statusPath.test(path)) return false;
		if (/\/(?:photo|video)\/\d+\/?$/i.test(path)) return true;
	}
	const media = Array.isArray(result.media) ? result.media : [result.media];
	return (
		media.some((item) => /^(?:image|photo|video|animated_gif)$/i.test(item?.type)) ||
		/^https?:\/\/\S+$/i.test(result.media_url ?? '')
	);
}

function matchesHotList(url, result, type) {
	const isWeibo = type === 'weibo_hot';
	const path = url.pathname;
	const row = contentRecord(result.content) ?? result;
	const labels = [row.type, row.source, row.list_type].filter((v) =>
		['weibo_hot', 'zhihu_hot'].includes(v),
	);
	if (labels.some((v) => v !== type)) return false;
	if (isWeibo && /^\/(?:top\/summary|hot\/(?:search|weibo))\/?$/i.test(path)) return true;
	if (!isWeibo && /^\/(?:hot|api\/v3\/feed\/topstory\/hot-lists\/total)\/?$/i.test(path))
		return true;
	const searchEntry = isWeibo && /^\/weibo\/?$/i.test(path) && Boolean(url.searchParams.get('q'));
	if (searchEntry && /^[1-9]\d*$/.test(url.searchParams.get('band_rank'))) return true;
	if (!searchEntry && !(isWeibo ? weiboPost : zhihuPost).test(path)) return false;
	const fromList = row.type === type || row.source === type || row.list_type === 'hot';
	const rank = row.hot_rank ?? row.hotRank ?? (fromList ? (row.rank ?? row.position) : undefined);
	requireEvidence(rank !== undefined, 'No hot-list rank or list attribution for ' + type);
	return (
		(typeof rank === 'number' && Number.isSafeInteger(rank) && rank > 0) ||
		(typeof rank === 'string' && /^[1-9]\d*$/.test(rank))
	);
}

function matchesOrcid(result, url, expected) {
	const record = contentRecord(result.content) ?? {};
	const status = [
		result.status,
		record.status,
		/^status:\s*([\w-]+)/i.exec(result.content ?? '')?.[1],
	].find(
		(value) =>
			typeof value === 'string' && /ambiguous|unresolved|not[_ -]found|multiple/i.test(value),
	);
	requireEvidence(!status, 'ORCID resolution returned ' + status + ' without selecting an author');
	const normalize = (id) =>
		id
			.trim()
			.replace(/^https?:\/\/(?:www\.)?orcid\.org\//i, '')
			.replace(/\/$/, '')
			.toUpperCase();
	const ids = [result.orcid, record.orcid]
		.filter((id) => typeof id === 'string' && id.trim())
		.map(normalize);
	if (fromHost(url, ['orcid.org'])) {
		const id = /^\/(\d{4}-\d{4}-\d{4}-\d{3}[\dx])\/?$/i.exec(url.pathname)?.[1];
		if (!id) return false;
		ids.push(normalize(id));
	}
	requireEvidence(ids.length, 'No resolved author ORCID available to verify ' + expected);
	return ids.every((id) => id === normalize(expected));
}

const datasetSources = {
	'cern.zenodo': ['zenodo.org', /^\/records?\/\d+\/?$/i, /^10\.5281\/zenodo\.\d+$/i],
	'figshare.ars': [
		'figshare.com',
		/^\/articles\/(?:[a-z_]+\/)?[^/]+\/\d+(?:\/\d+)?\/?$/i,
		/^10\.6084\/m9\.figshare\.\d+(?:\.v\d+)?$/i,
	],
	'dryad.dryad': [
		'datadryad.org',
		/^\/(?:stash\/)?dataset\/doi:10\.5061\/dryad\.[\w.-]+\/?$/i,
		/^10\.5061\/dryad\.[\w.-]+$/i,
	],
};

function checkedAllParameters(params, checked) {
	return Object.keys(params).every((field) => checked.includes(field));
}

function checkInternationalFundamental(params, query, result) {
	const symbol = params.symbol || /\(([A-Z][A-Z\d.-]{0,14})\)/.exec(query ?? '')?.[1];
	requireEvidence(symbol, 'The request does not identify an explicit ticker to verify');
	const title = /^([\w.-]+)\s+[—–-]\s+(Annual|Quarterly) Fundamental$/i.exec(result.title ?? '');
	const content = result.content ?? '';
	const record = contentRecord(content);
	const symbols = [
		result.symbol,
		record?.symbol,
		title?.[1],
		/(?:^|\|)\s*Symbol:\s*([^\s|]+)/i.exec(content)?.[1],
	].filter((value) => typeof value === 'string' && value.trim());
	requireEvidence(symbols.length, 'The fundamental result does not identify its ticker');
	assert(
		symbols.every((value) => value.trim().toUpperCase() === symbol.toUpperCase()),
		'Expected fundamentals for ' + symbol,
	);

	// "Overview/estimates: annual or single_quarter."
	const period = params.report_basis === 'single_quarter' ? 'quarter' : 'annual';
	const periods = [
		result.report_period,
		record?.report_period,
		title && (title[2].toLowerCase() === 'annual' ? 'annual' : 'quarter'),
		/(?:^|\|)\s*ReportPeriod:\s*(annual|quarter)\b/i.exec(content)?.[1]?.toLowerCase(),
		...[...content.matchAll(/\b(?:Income|Segments)\(\d{4}\s+(FY|Q[1-4])\b/gi)].map((match) =>
			match[1].toUpperCase() === 'FY' ? 'annual' : 'quarter',
		),
	].filter((value) => typeof value === 'string' && value.trim());
	requireEvidence(periods.length, 'The fundamental result does not identify its fiscal period');
	assert(
		periods.every(
			(value) =>
				value
					.trim()
					.toLowerCase()
					.replace(/^quarterly$/, 'quarter') === period,
		),
		'Expected ' + period + ' fundamentals for ' + symbol,
	);
	return true;
}

function checkSelectedResult(tag, params, result, query) {
	const url = sourceUrl(result.url);
	if (tag === 'finance.fundamental' && params.type === 'overview')
		return checkInternationalFundamental(params, query, result);
	if (tag === 'finance.calendar' && params.type === 'dividends') {
		const dividend = checkDividend(result);
		const { symbols } = calendarSymbols(result, 'dividend');
		if (!params.symbol)
			return dividend && checkedAllParameters(params, calendarCheckedParameters(params, symbols));
		requireEvidence(symbols.length, 'The dividend record does not identify its ticker');
		assert(
			symbols.every((value) => String(value).toUpperCase() === String(params.symbol).toUpperCase()),
			'Expected dividend calendar ticker ' + params.symbol,
		);
		return dividend && checkedAllParameters(params, calendarCheckedParameters(params, symbols));
	}
	if (tag === 'ip.global' && params.type === 'GlobalPatent' && params.applicant)
		return (
			checkPatentApplicant(result, params.applicant) &&
			checkedAllParameters(params, ['type', 'applicant'])
		);
	if (tag === 'finance.calendar' && params.type === 'earnings')
		return (
			checkEarnings(result, params) &&
			checkedAllParameters(
				params,
				calendarCheckedParameters(params, calendarSymbols(result, 'earnings').symbols),
			)
		);
	if (tag === 'finance.news' && params.type === 'long_form' && params.news_src)
		return checkLongFormNews(result, params.news_src);
	if (tag === 'gaming.store') {
		requireEvidence(url, 'No Steam Store link for ' + query);
		assert(fromHost(url, ['store.steampowered.com']), 'Expected a Steam Store page');
		return true;
	}
	if (tag === 'agriculture.stats') {
		checkAgricultureStats(result, url, params);
		return true;
	}
	if (tag === 'social_media.social_media' && params.type) {
		if (!Object.hasOwn(socialSources, params.type)) return undefined;
		const [hosts, path] = socialSources[params.type];
		if (
			params.type === 'reddit_comment' &&
			fromHost(url, hosts) &&
			socialSources.reddit_post[1].test(url.pathname) &&
			/^Re:\s/i.test(result.title ?? '')
		) {
			throw new MissingEvidence(
				'reddit_comment returned a parent thread without a comment permalink',
			);
		}
		assert(
			fromHost(url, hosts) && url.pathname !== '/' && (!path || path.test(url.pathname)),
			'Expected a ' + params.type + ' result link',
		);
		if (params.type === 'reddit_media' || params.type === 'x_media') {
			assert(
				matchesMedia(url, result, params.type),
				'Expected evidence of media for ' + params.type,
			);
		}
		if (params.type === 'wechatmp' && /^\/s\/?$/.test(url.pathname)) {
			assert(
				url.searchParams.get('__biz') && url.searchParams.get('mid'),
				'Expected a WeChat article ID',
			);
		}
		if (params.type === 'weibo_hot' || params.type === 'zhihu_hot')
			assert(
				matchesHotList(url, result, params.type),
				'Expected a ' + params.type + ' hot-list record',
			);
		// A status permalink alone cannot distinguish X Top from Latest.
		if (params.type === 'x_top' || params.type === 'x_latest') return false;
		return checkedAllParameters(params, ['type']);
	}
	if (tag === 'legal.legislation' && params.jurisdiction === 'US' && params.collection) {
		const matches = matchesCollection(url, params.collection);
		if (matches === undefined) return undefined;
		assert(matches, 'Expected a document from ' + params.collection);
		const checked = ['jurisdiction', 'collection'];
		if (params.collection === 'BILLS' && params.congress) {
			const congress = /\/bill\/(\d+)[a-z]+-congress\/|\/BILLS-(\d+)[a-z]/i.exec(url.pathname);
			if (congress) {
				assert.equal(
					BigInt(congress[1] ?? congress[2]),
					BigInt(params.congress),
					'Unexpected US Congress session',
				);
				checked.push('congress');
			}
		}
		if (params.collection === 'CFR' && /^[+-]?\d+$/.test(String(params.title).trim())) {
			const title = /(?:title-|cfr\/text\/|link\/cfr\/|CFR-\d{4}-title)(\d+)/i.exec(
				url.pathname,
			)?.[1];
			if (title) {
				assert.equal(BigInt(title), BigInt(params.title), 'Unexpected CFR title');
				checked.push('title');
			}
		}
		return checkedAllParameters(params, checked);
	}
	if (
		tag === 'legal.judicial' &&
		params.jurisdiction === 'ECHR' &&
		(params.doc_type === 'JUDGMENT' || params.document_type === 'judgment')
	) {
		assert(
			matchesJudgment(result, url, params),
			'Expected a HUDOC judgment for the requested respondent',
		);
		const checked = ['jurisdiction', 'respondent'];
		if (params.doc_type === 'JUDGMENT') checked.push('doc_type');
		if (params.document_type === 'judgment') checked.push('document_type');
		return checkedAllParameters(params, checked);
	}
	if (
		tag === 'legal.judicial' &&
		params.jurisdiction === 'CA' &&
		(params.case_id || params.case_number)
	) {
		checkCanadianCase(result, url, params);
		return checkedAllParameters(params, ['jurisdiction', 'case_id', 'case_number']);
	}
	if (
		tag === 'legal.legislation' &&
		params.jurisdiction === 'CA' &&
		params.database_id === 'car' &&
		params.resource_kind === 'rules'
	) {
		assert(matchesCanadianRegulation(url), 'Expected a Canadian federal regulation');
		return checkedAllParameters(params, ['jurisdiction', 'database_id', 'resource_kind']);
	}
	if (tag === 'academic.paper') return checkPaper(result, url, params);
	if (
		tag === 'academic.citation' &&
		(params.op ?? 'metadata') === 'metadata' &&
		/^10\.\d+(?:\.\d+)*\//.test(params.id)
	) {
		const match = matchesDoi(result, url, params.id);
		requireEvidence(match !== undefined, 'No record DOI available to verify ' + params.id);
		assert(match, 'Expected metadata for DOI ' + params.id);
		return checkedAllParameters(params, ['op', 'id']);
	}
	if (tag === 'academic.person' && params.orcid) {
		assert(matchesOrcid(result, url, params.orcid), 'Expected author ORCID ' + params.orcid);
		return checkedAllParameters(params, ['orcid']);
	}
	if (tag === 'academic.dataset' && params.client_id) {
		if (!Object.hasOwn(datasetSources, params.client_id)) return undefined;
		const source = datasetSources[params.client_id];
		assert(
			(fromHost(url, [source[0]]) && source[1].test(decodeURIComponent(url.pathname))) ||
				(fromHost(url, ['doi.org']) && source[2].test(decodeURIComponent(url.pathname).slice(1))),
			'Expected dataset repository ' + params.client_id,
		);
		const records = [result, contentRecord(result.content)].filter(Boolean);
		const checked = ['client_id'];
		if (params.resource_type) {
			const figshareType =
				fromHost(url, ['figshare.com']) &&
				/^\/articles\/([a-z_]+)\/[^/]+\/\d+(?:\/\d+)?\/?$/i.exec(url.pathname)?.[1];
			const types = records
				.flatMap((row) => [
					row.resource_type,
					row.resourceTypeGeneral,
					row.types?.resourceTypeGeneral,
				])
				.concat(figshareType)
				.filter((type) => typeof type === 'string' && type.trim());
			if (types.length) {
				assert(
					types.every((value) => value.toLowerCase() === params.resource_type.toLowerCase()),
					'Unexpected dataset resource type',
				);
			}
			const inferredDataset =
				params.resource_type.toLowerCase() === 'dataset' &&
				(params.client_id === 'dryad.dryad' ||
					/^(?:the|this)\s+dataset\s+(?:contains|includes|provides|comprises|consists)\b/i.test(
						String(result.snippet ?? '').trim(),
					));
			if (types.length || inferredDataset) checked.push('resource_type');
		}
		if (params.year !== undefined) {
			// YYYY, YYYY-YYYY, YYYY- (lower bound) or -YYYY (upper bound).
			const [start, end] = String(params.year).split('-');
			const years = records
				.flatMap((row) => [row.publicationYear, row.publication_year])
				.filter(
					(year) =>
						Number.isSafeInteger(year) || (typeof year === 'string' && /^-?\d+$/.test(year)),
				)
				.map(BigInt);
			if (years.length) {
				assert(
					years.every((year) => (!start || year >= BigInt(start)) && (!end || year <= BigInt(end))),
					'Dataset publication year is outside the requested range',
				);
				checked.push('year');
			}
		}
		return checkedAllParameters(params, checked);
	}
	if (tag === 'gaming.esports') {
		const type = params.type;
		if (type === 'match_detail') {
			assert(matchesGame(result, url, params.match_id), 'Expected match ' + params.match_id);
			return true;
		}
		if (type === 'leaderboard') {
			checkLeaderboard(result, url, params);
			return true;
		}
		// The query is the champion name.
		if (type === 'champion') {
			const record = contentRecord(result.content);
			requireEvidence(record, 'No champion record for ' + query);
			const key = (value) =>
				String(value)
					.toLowerCase()
					.replace(/[^a-z]/g, '');
			requireEvidence(
				[record.name, record.id].some((value) => key(value) === key(query)),
				'The champion record does not confirm ' + query,
			);
			return true;
		}
		// The query is the item name.
		if (type === 'item') {
			if (noDataFor(result, 'item', query)) return true;
			const record = contentRecord(result.content);
			requireEvidence(record, 'No item record for ' + query);
			assert(
				String(record.name).toLowerCase() ===
					String(query ?? '')
						.trim()
						.toLowerCase(),
				'Expected item ' + query,
			);
			return true;
		}
		if (type === 'champion_rotation' && params.region) {
			requireEvidence(url, 'No champion rotation link for region ' + params.region);
			assert.equal(
				url.searchParams.get('region'),
				params.region.toLowerCase(),
				'Expected the champion rotation of region ' + params.region,
			);
			return true;
		}
		// A recent-match row names its match and region but not the player.
		if (type === 'player') {
			const profile = isProfileLink(url, params);
			assert(
				profile || isMatchRow(result, url, params),
				'Expected a profile or match record for ' + params.game_name,
			);
			requireEvidence(profile, 'Recent match rows do not identify the player');
			return true;
		}
		if (['ranked', 'mastery', 'live_game'].includes(type)) {
			const record = contentRecord(result.content) ?? {};
			// A record that names a player must name the requested one, and so must its link.
			assert(
				(typeof record.gameName !== 'string' || namesPlayer(result, params.game_name)) &&
					(!url || isProfileLink(url, params)),
				'Expected a profile record for ' + params.game_name,
			);
			if (type === 'ranked')
				return typeof record.tier === 'string' && Number.isFinite(record.leaguePoints);
			// Only the answer for a player who is not in a game has been observed.
			if (type === 'live_game') {
				if (record.inGame === false) return true;
				throw new MissingEvidence('No live-game details for ' + params.game_name);
			}
			requireEvidence(
				typeof record.championName === 'string' && Number.isFinite(record.points),
				'No mastery record for ' + params.game_name,
			);
			if (params.champion)
				assert(
					record.championName.toLowerCase() === params.champion.toLowerCase(),
					'Expected mastery filtered to champion ' + params.champion,
				);
			return true;
		}
	}
	// No operation-specific assertion covers this request.
	return undefined;
}

function evaluateResults({ tag, params = {}, max_results, query }, results, strict) {
	const limit = max_results ?? 10;
	assert(Array.isArray(results) && results.length > 0, 'Expected a non-empty result set');
	assert(results.length <= limit, 'More results than max_results');
	let status = 'verified';
	let reason;
	for (const result of results) {
		assert(
			result &&
				[result.title, result.url, result.snippet, result.content].some(
					(v) => typeof v === 'string' && v.trim(),
				),
			'Expected a populated result record',
		);
		try {
			const checked = checkSelectedResult(tag, params, result, query);
			if (checked === undefined && status === 'verified') status = 'nonemptyOnly';
			if (checked === false) {
				status = 'unverified';
				reason ??= 'Result lacks evidence for the requested operation or filters';
			}
		} catch (error) {
			if (strict || !(error instanceof MissingEvidence)) throw error;
			status = 'unverified';
			reason ??= error.message;
		}
	}
	if (tag === 'academic.paper' && params.sort) {
		const ordered = checkPaperOrder(params.sort, results);
		if (!ordered) {
			status = 'unverified';
			reason ??= 'Insufficient evidence of paper ordering';
		} else if (status === 'nonemptyOnly') {
			// A sort-only request can be verified from the order of multiple records.
			status = 'verified';
		}
	}
	return reason ? { status, reason } : { status };
}

// Strict assertion used by focused tests. Catalog reports also retain inconclusive observations.
export function checkSearchResults(input, results) {
	return evaluateResults(input, results, true).status === 'verified';
}

export function assessSearchResults(input, results) {
	try {
		return evaluateResults(input, results, false);
	} catch (error) {
		return { status: 'mismatch', reason: error.message };
	}
}
