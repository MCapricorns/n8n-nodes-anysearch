import assert from 'node:assert/strict';

// These checks qualify hits in the acceptance suite. The search node preserves API results.
const flashSources = {
	sina: ['sina.com.cn', 'sina.cn'],
	wallstreetcn: ['wallstreetcn.com'],
	'10jqka': ['10jqka.com.cn'],
	eastmoney: ['eastmoney.com'],
	cls: ['cls.cn'],
	yicai: ['yicai.com'],
	yuncaijing: ['yuncaijing.com'],
	fenghuang: ['ifeng.com'],
	jinrongjie: ['jrj.com.cn'],
};

const reddit = ['reddit.com'];
const linkedin = ['linkedin.com'];
const x = ['x.com', 'twitter.com'];
const statusPath = /^\/[^/]+\/status\/\d+(?:\/(?:photo|video)\/\d+)?\/?$/i;
const socialSources = {
	weibo: [['weibo.com', 'weibo.cn']],
	weibo_hot: [
		['weibo.com', 'weibo.cn'],
		/^\/(?:top\/summary|hot\/(?:search|weibo)|weibo|p\/index)\/?$/i,
	],
	zhihu: [['zhihu.com']],
	zhihu_hot: [['zhihu.com']],
	x_top: [x, statusPath],
	x_latest: [x, statusPath],
	x_media: [[...x, 'pbs.twimg.com', 'video.twimg.com']],
	x_people: [
		x,
		/^\/(?!(?:home|explore|search|settings|i|notifications|messages|compose|login|logout|signup|tos|privacy|share|intent|hashtag)\/?$)[\w]{1,15}\/?$/i,
	],
	x_lists: [x, /^\/(?:i\/lists\/\d+|[^/]+\/lists\/[^/]+)\/?$/i],
	reddit_post: [reddit, /^\/(?:r\/[\w]+\/)?comments\/[a-z0-9]+(?:\/[^/]+)?\/?$/i],
	reddit_community: [reddit, /^\/r\/[\w]+\/?$/i],
	reddit_comment: [reddit, /^\/(?:r\/[\w]+\/)?comments\/[a-z0-9]+\/[^/]+\/[a-z0-9]+\/?$/i],
	reddit_media: [['reddit.com', 'i.redd.it', 'v.redd.it']],
	reddit_people: [reddit, /^\/(?:u|user)\/[\w-]+\/?$/i],
	linkedin_people: [linkedin, /^\/in\/[^/]+\/?$/i],
	linkedin_jobs: [linkedin, /^\/jobs\/view\/(?:[^/]+-)?\d+\/?$/i],
	linkedin_company: [linkedin, /^\/company\/[^/]+\/?$/i],
	linkedin_posts: [linkedin, /^\/(?:posts\/[^/]+|feed\/update\/urn:li:[^/]+)\/?$/i],
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
			return false;
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
	return (
		identifiers.length > 0 &&
		identifiers.every(
			(value) =>
				value
					.trim()
					.replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i, '')
					.toLowerCase() === id.toLowerCase(),
		)
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
		fromHost(url, ['leagueofgraphs.com']) && /^\/match\/([a-z]+\d*)\/(\d+)\/?$/i.exec(url.pathname);
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

function matchesGame(result, url, id) {
	const record = contentRecord(result.content);
	const linkId = matchIdFromUrl(url);
	if (url && linkId !== id) return false;
	if (record?.metadata?.matchId !== undefined && record.metadata.matchId !== id) return false;
	if (record?.info?.gameId !== undefined && String(record.info.gameId) !== id.split('_')[1])
		return false;
	return (
		linkId === id || (record?.metadata?.matchId === id && record.info?.participants?.length > 0)
	);
}

function checkLeaderboard(result, url, params) {
	const row = contentRecord(result.content) ?? result;
	// The live service links an individual leaderboard entry to the player's OP.GG profile.
	const region =
		fromHost(url, ['op.gg', 'u.gg', 'leagueofgraphs.com']) &&
		/\/(?:summoners?|rankings)\/([^/]+)\//i.exec(url.pathname)?.[1].toLowerCase();
	assert(
		region === params.region || (!url && row.region?.toLowerCase() === params.region),
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
	if (params.division)
		assert.equal(
			row.rank ?? row.division,
			params.division,
			'Expected leaderboard division ' + params.division,
		);
	if (params.queue && row.queueType)
		assert.equal(row.queueType, params.queue, 'Unexpected leaderboard queue');
}

function matchesPlayer(result, url, params) {
	const [name, tagline] = params.game_name.toLowerCase().split('#');
	const region = params.region.toLowerCase();
	const matchId = matchIdFromUrl(url);
	if (matchId) {
		const record = contentRecord(result.content);
		const participants = record?.info?.participants;
		const platform = platforms[region] ?? region.toUpperCase();
		return (
			matchId.split('_')[0] === platform &&
			record?.metadata?.matchId === matchId &&
			Array.isArray(participants) &&
			participants.some(
				(p) =>
					p.riotIdGameName?.toLowerCase() === name &&
					(!tagline || p.riotIdTagline?.toLowerCase() === tagline),
			)
		);
	}
	if (!fromHost(url, ['op.gg', 'leagueofgraphs.com', 'masterychart.com', 'u.gg'])) return false;
	const path = decodeURIComponent(url.pathname).replaceAll('+', ' ').toLowerCase();
	const profile = /\/(?:summoners?|profile)\/([^/]+)\/([^/]+)\/?$/.exec(path);
	return (
		profile?.[1] === region &&
		(tagline
			? profile[2] === name + '-' + tagline
			: profile[2] === name || profile[2].startsWith(name + '-'))
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
	const record = { ...result, ...contentRecord(result.content) };
	const snippet = (result.snippet ?? '').replace(/\s*\[Open Access\]\s*$/i, '');
	// AnySearch can return a compact bibliographic line instead of a JSON record.
	const citation =
		/^(.*?)\s+\((\d{4})\)\s+[—–-]\s+(.*?)(?:\s+[—–-]\s+cited\s+([\d,]+)\s+times?)?$/i.exec(
			snippet.trim(),
		);
	const metadata = { ...paperHeader(result.snippet), ...paperHeader(result.content) };
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
	const years = [record.publication_year, record.year, metadata['publication year'], citation?.[2]]
		.filter((v) => /^\d{4}$/.test(v))
		.map(Number);
	if (!years.length && /^\d{4}/.test(date)) years.push(Number(date.slice(0, 4)));
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
		language: record.language ?? metadata.language,
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

function checkPaper(result, url, params) {
	let checked = false;
	if (params.doi) {
		assert(matchesDoi(result, url, params.doi), 'Expected paper DOI ' + params.doi);
		checked = true;
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
		checked = true;
	}
	if (params.language && typeof paper.language === 'string') {
		const observed = paper.language.toLowerCase();
		const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(params.language);
		assert(
			observed.split('-')[0] === params.language || observed === name.toLowerCase(),
			'Unexpected paper language ' + observed,
		);
		checked = true;
	}
	if (params.min_citations !== undefined && paper.citations !== undefined) {
		assert(
			paper.citations >= Number(params.min_citations),
			'Paper has fewer than ' + params.min_citations + ' citations',
		);
		checked = true;
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
		checked = true;
	}
	const normalized = (value) => String(value).trim().toLowerCase();
	function matchesAny(requested, actual) {
		const choices = requested.split(',').map(normalized);
		return actual.some((v) => choices.includes(normalized(v)));
	}
	if (params.authors && paper.authors.length) {
		assert(matchesAny(params.authors, paper.authors), 'Unexpected paper authors');
		checked = true;
	}
	if (params.venue && typeof paper.venue === 'string') {
		const venueNames = [paper.venue];
		if (normalized(paper.venue) === 'neural information processing systems')
			venueNames.push('Advances in Neural Information Processing Systems');
		assert(matchesAny(params.venue, venueNames), 'Unexpected paper venue ' + paper.venue);
		checked = true;
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
		checked = true;
	}
	return checked;
}

function checkPaperOrder(sort, results) {
	if (results.length < 2 || !['cited', 'date_asc', 'date_desc'].includes(sort)) return false;
	const papers = results.map((result) => paperDetails(result, sourceUrl(result.url)));
	let values;
	if (sort === 'cited') values = papers.map((paper) => paper.citations);
	else if (papers.every((paper) => /^\d{4}-\d{2}-\d{2}$/.test(paper.date)))
		values = papers.map((paper) => paper.date);
	else values = papers.map((paper) => paper.years[0]);
	if (values.some((value) => value === undefined)) return false;
	for (let i = 1; i < values.length; i++) {
		assert(
			sort === 'date_asc' ? values[i - 1] <= values[i] : values[i - 1] >= values[i],
			'Unexpected paper order for sort=' + sort,
		);
	}
	return new Set(values).size > 1;
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
	return /\|\s*Comments:\s*\d+\s+(?:Type:\s*IMAGE\s+Domain:\s*i\.redd\.it|Type:\s*VIDEO\s+Domain:\s*v\.redd\.it)(?:\s|\||$)/i.test(
		header,
	);
}

function checkSelectedResult(tag, params, result) {
	const url = sourceUrl(result.url);
	if (tag === 'finance.calendar' && params.type === 'dividends') return checkDividend(result);
	if (tag === 'ip.global' && params.type === 'GlobalPatent' && params.applicant)
		return checkPatentApplicant(result, params.applicant);
	if (tag === 'finance.calendar' && params.type === 'earnings') {
		const text = [result.title, result.snippet, result.content].join(' ');
		assert(
			/CalendarSource:|earnings calendar|EPS[_ ]Est|财报披露|业绩日历/i.test(text),
			'Expected an earnings calendar record',
		);
		const ticker = params.symbol || params.cn_code;
		if (ticker)
			assert(
				text
					.toUpperCase()
					.split(/[^A-Z0-9.-]+/)
					.includes(String(ticker).toUpperCase()),
				'Expected calendar ticker ' + ticker,
			);
		return true;
	}
	if (tag === 'finance.news' && params.type === 'flash') {
		const source = params.news_src ?? 'sina';
		assert(Object.hasOwn(flashSources, source), 'Missing acceptance rule for news_src=' + source);
		assert(
			fromHost(url, flashSources[source]) && url.pathname !== '/',
			'Expected a financial flash from ' + source,
		);
		return true;
	}
	if (tag === 'social_media.social_media' && params.type) {
		assert(
			Object.hasOwn(socialSources, params.type),
			'Missing acceptance rule for social type=' + params.type,
		);
		const [hosts, path] = socialSources[params.type];
		assert(
			fromHost(url, hosts) && url.pathname !== '/' && (!path || path.test(url.pathname)),
			'Expected a ' + params.type + ' result link',
		);
		if (params.type === 'reddit_media' || params.type === 'x_media') {
			const hasMedia =
				fromHost(url, ['i.redd.it', 'v.redd.it', 'pbs.twimg.com', 'video.twimg.com']) ||
				/\/gallery\/\w+|\/(?:photo|video)\/\d+\/?$/.test(url.pathname) ||
				(params.type === 'reddit_media' && redditMediaPost(url, result)) ||
				Boolean(result.media || result.media_url);
			assert(hasMedia, 'Expected evidence of media for ' + params.type);
		}
		if (params.type === 'wechatmp' && url.pathname === '/s') {
			assert(
				url.searchParams.get('__biz') && url.searchParams.get('mid'),
				'Expected a WeChat article ID',
			);
		}
		if (params.type === 'weibo_hot' && url.pathname === '/weibo')
			assert(url.searchParams.get('q'), 'Expected a Weibo hot topic');
		return true;
	}
	if (tag === 'legal.legislation' && params.jurisdiction === 'US' && params.collection) {
		assert(
			matchesCollection(url, params.collection),
			'Expected a document from ' + params.collection,
		);
		if (params.collection === 'BILLS' && params.congress) {
			const congress = /\/bill\/(\d+)[a-z]+-congress\/|\/BILLS-(\d+)[a-z]/i.exec(url.pathname);
			if (congress)
				assert.equal(
					congress[1] ?? congress[2],
					String(params.congress),
					'Unexpected US Congress session',
				);
		}
		if (params.collection === 'CFR' && params.title) {
			const title = /(?:title-|cfr\/text\/|CFR-\d{4}-title)(\d+)/i.exec(url.pathname)?.[1];
			if (title) assert.equal(title, String(params.title), 'Unexpected CFR title');
		}
		return true;
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
		return true;
	}
	if (
		tag === 'legal.judicial' &&
		params.jurisdiction === 'CA' &&
		(params.case_id || params.case_number)
	) {
		checkCanadianCase(result, url, params);
		return true;
	}
	if (
		tag === 'legal.legislation' &&
		params.jurisdiction === 'CA' &&
		params.database_id === 'car' &&
		params.resource_kind === 'rules'
	) {
		assert(matchesCanadianRegulation(url), 'Expected a Canadian federal regulation');
		return true;
	}
	if (tag === 'academic.paper') return checkPaper(result, url, params);
	if (tag === 'academic.citation' && (params.op ?? 'metadata') === 'metadata') {
		const doi = params.id_type === 'doi' || /^10\.\d+\//.test(params.id) ? params.id : params.doi;
		if (doi) {
			assert(matchesDoi(result, url, doi), 'Expected metadata for DOI ' + doi);
			return true;
		}
	}
	if (tag === 'academic.person' && params.orcid) {
		assert(
			(fromHost(url, ['orcid.org']) && url.pathname === '/' + params.orcid) ||
				result.orcid === params.orcid,
			'Expected author ORCID ' + params.orcid,
		);
		return true;
	}
	if (tag === 'academic.dataset' && params.client_id) {
		const sources = {
			'cern.zenodo': ['zenodo.org', '10.5281/zenodo.'],
			'figshare.ars': ['figshare.com', '10.6084/m9.figshare.'],
			'bl.dryad': ['datadryad.org', '10.5061/dryad.'],
		};
		const source = sources[params.client_id];
		assert(source, 'Missing dataset source rule for ' + params.client_id);
		assert(
			(fromHost(url, [source[0]]) && url.pathname !== '/') ||
				(fromHost(url, ['doi.org']) && url.pathname.toLowerCase().startsWith('/' + source[1])),
			'Expected dataset repository ' + params.client_id,
		);
		return true;
	}
	if (tag === 'gaming.esports' && params.type === 'match_detail') {
		assert(matchesGame(result, url, params.match_id), 'Expected match ' + params.match_id);
		return true;
	}
	if (tag === 'gaming.esports' && params.type === 'leaderboard') {
		checkLeaderboard(result, url, params);
		return true;
	}
	if (
		tag === 'gaming.esports' &&
		['player', 'ranked', 'mastery', 'live_game'].includes(params.type)
	) {
		assert(
			matchesPlayer(result, url, params),
			'Expected a profile or match record for ' + params.game_name,
		);
		if (params.type === 'mastery' && params.champion) {
			const text = [result.title, result.snippet, result.content].join(' ').toLowerCase();
			assert(
				text.includes(params.champion.toLowerCase()),
				'Expected mastery for champion ' + params.champion,
			);
		}
		return true;
	}
	return false;
}

export function checkSearchResults({ tag, params = {}, max_results = 10 }, results) {
	assert(Array.isArray(results) && results.length > 0, 'Expected a non-empty result set');
	assert(results.length <= max_results, 'More results than max_results');
	let semantic = true;
	for (const result of results) {
		assert(
			result &&
				[result.title, result.url, result.snippet, result.content].some(
					(v) => typeof v === 'string' && v.trim(),
				),
			'Expected a populated result record',
		);
		if (!checkSelectedResult(tag, params, result)) semantic = false;
	}
	const ordered = tag === 'academic.paper' && checkPaperOrder(params.sort, results);
	return semantic || ordered;
}
