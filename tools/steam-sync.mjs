#!/usr/bin/env node
/*
	Refreshes the Steam stats on the private gaming page (private.html#gaming).

	Decrypts the private payload, rebuilds only the "gaming" page from live
	Steam data, and re-encrypts, leaving the other private pages untouched.
	private.html is only rewritten when the Steam data has changed.

	Environment:
		VAULT_PASS     passphrase for the private space (required)
		STEAM_ID       Steam custom URL name or 17-digit SteamID64 (required)
		STEAM_API_KEY  Steam Web API key (optional): adds hours played, recently
		               played and most-played games, which also need the
		               profile's "Game details" set to Public on Steam

	Run by .github/workflows/steam-sync.yml. The repository is public, so its
	Actions logs are too: this script never prints any of the Steam data.
*/
import { readFileSync, writeFileSync } from 'node:fs';
import { PAGE, encryptInto, decryptFrom } from './vault-lib.mjs';

const { VAULT_PASS, STEAM_ID, STEAM_API_KEY } = process.env;
if (!VAULT_PASS || !STEAM_ID) {
	console.error('Set VAULT_PASS and STEAM_ID.');
	process.exit(1);
}

const PROFILE = /^\d{17}$/.test(STEAM_ID)
	? `https://steamcommunity.com/profiles/${STEAM_ID}`
	: `https://steamcommunity.com/id/${encodeURIComponent(STEAM_ID)}`;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ---------------------------------------------------------------------------
// Fetching

async function get(url, what) {
	const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (portfolio steam-sync)', 'Accept-Language': 'en' } });
	if (!res.ok) throw new Error(`Couldn't fetch ${what} (HTTP ${res.status}).`);
	return res;
}

const text = async (url, what) => (await get(url, what)).text();

async function api(method, params) {
	const query = new URLSearchParams({ key: STEAM_API_KEY, format: 'json', ...params });
	const res = await get(`https://api.steampowered.com/${method}/?${query}`, `Steam Web API ${method.split('/')[1]}`);
	return (await res.json()).response || {};
}

// ---------------------------------------------------------------------------
// Parsing

const decode = (s) => s
	.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
	.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(n));
const strip = (s) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const cdata = (xml, tag) => {
	const m = xml.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
	return m ? m[1].trim() : '';
};
const num = (s) => parseInt(String(s).replace(/[^\d]/g, ''), 10);

function parseProfileXml(xml) {
	if (cdata(xml, 'privacyState') !== 'public') throw new Error('The Steam profile is not public.');
	return {
		steamId64: cdata(xml, 'steamID64'),
		name: cdata(xml, 'steamID'),
		avatarUrl: cdata(xml, 'avatarFull'),
		memberSince: cdata(xml, 'memberSince'),
		summary: strip(cdata(xml, 'summary'))
	};
}

function parseProfilePage(html) {
	const counts = {};
	for (const m of html.matchAll(/<span class="count_link_label">([^<]+)<\/span>[\s\S]*?profile_count_link_total">\s*([^<]*)</g)) {
		counts[m[1].trim().toLowerCase()] = num(m[2]) || 0;
	}
	const level = html.match(/class="friendPlayerLevelNum">(\d+)</);
	const favourite = html.match(/class="favorite_badge_description">([\s\S]*?)<\/div>\s*<\/div>/);
	return {
		level: level ? num(level[1]) : null,
		counts,
		favouriteBadge: favourite ? strip(favourite[1]).replace(/\s*\d[\d,]*\s*XP$/, '') : ''
	};
}

// "Aug 9, 2018 @ 4:21pm" or "Aug 23 @ 10:32am" (this year, or last year if that's still to come).
function parseUnlocked(s, now) {
	const m = s.match(/([A-Z][a-z]{2})\w*\s+(\d{1,2})(?:,\s*(\d{4}))?/);
	if (!m) return null;
	const month = MONTHS.findIndex((name) => name.startsWith(m[1]));
	let year = m[3] ? num(m[3]) : now.getUTCFullYear();
	if (!m[3] && Date.UTC(year, month, num(m[2])) > now.getTime()) year--;
	return new Date(Date.UTC(year, month, num(m[2])));
}

function parseBadgesPage(html, now) {
	const xp = html.match(/class="profile_xp_block_xp">([^<]*)</);
	const badges = html.split('class="badge_row ').slice(1).map((row) => {
		const pick = (cls) => {
			const m = row.match(new RegExp(`class="${cls}">([\\s\\S]*?)</div>`));
			return m ? strip(m[1]) : '';
		};
		const title = pick('badge_title').replace(/\s*View details\s*$/, '');
		const name = pick('badge_info_title');
		// The description block nests the title div, so read up to the "unlocked" line.
		const descMatch = row.match(/class="badge_info_description">([\s\S]*?)<div class="badge_info_unlocked"/);
		const desc = descMatch ? strip(descMatch[1]) : '';
		const level = desc.match(/Level (\d+)/);
		const xpMatch = desc.match(/([\d,]+)\s*XP/);
		return {
			name,
			game: title && title !== name ? title : '',
			level: level ? num(level[1]) : null,
			xp: xpMatch ? num(xpMatch[1]) : 0,
			unlocked: parseUnlocked(pick('badge_info_unlocked').replace(/^Unlocked\s*/, ''), now)
		};
	}).filter((b) => b.name);
	return { xp: xp ? num(xp[1]) : null, badges };
}

// ---------------------------------------------------------------------------
// Steam levels: levels 1-10 need 100 XP each, 11-20 need 200, and so on.

function xpForLevel(level) {
	let total = 0;
	for (let i = 1; i <= level; i++) total += 100 * Math.ceil(i / 10);
	return total;
}

// ---------------------------------------------------------------------------
// Rendering

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (n) => n.toLocaleString('en-GB');
const hours = (minutes) => `${fmt(Math.round(minutes / 6) / 10)} hrs`;
const shortDate = (d) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}`;

function longDate(s) {
	const d = new Date(`${s} UTC`);
	return isNaN(d) ? s : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const UPDATED = /<p>\/\/ Steam profile and stats(?: &middot; updated [^<]*)?\.<\/p>/;

function renderPage(d, updated) {
	const level = d.level;
	const start = xpForLevel(level), next = xpForLevel(level + 1);
	const toNext = Math.max(next - d.xp, 0);
	const pct = Math.min(100, Math.max(0, Math.round(((d.xp - start) / (next - start)) * 1000) / 10));

	const tiles = [['badges', d.counts.badges], ['screenshots', d.counts.screenshots], ['reviews', d.counts.reviews], ['friends', d.counts.friends]]
		.filter(([, n]) => Number.isFinite(n))
		.map(([label, n]) => `\t\t<li><strong>${fmt(n)}</strong><span>${label}</span></li>`).join('\n');

	const badgeGames = [...new Set([...d.badges].sort((a, b) => (a.unlocked || 0) - (b.unlocked || 0)).map((b) => b.game).filter(Boolean))];
	const gameList = (names) => names.map((g) => `<strong>${esc(g)}</strong>`).join(', ').replace(/, ([^,]*)$/, ' and $1');

	let favourites, playtime;
	if (d.games && d.games.length) {
		const played = d.games.filter((g) => g.playtime_forever > 0).sort((a, b) => b.playtime_forever - a.playtime_forever);
		const total = played.reduce((sum, g) => sum + g.playtime_forever, 0);
		const row = (name, meta) => `\t\t\t<li><span class="steam-badge-name">${esc(name)}</span><span class="steam-badge-meta">${meta}</span></li>`;
		favourites = `\t\t<p>Most played:</p>
		<ul class="steam-badges">
${played.slice(0, 5).map((g) => row(g.name, hours(g.playtime_forever))).join('\n')}
		</ul>`;
		const recent = (d.recent || []).filter((g) => g.playtime_2weeks > 0);
		playtime = `\t\t<p><strong>${hours(total)}</strong> across ${fmt(played.length)} of ${fmt(d.games.length)} games.</p>
		<p>Last two weeks:</p>
		${recent.length
		? `<ul class="steam-badges">\n${recent.map((g) => row(g.name, `${hours(g.playtime_2weeks)} &middot; ${hours(g.playtime_forever)} total`)).join('\n')}\n\t\t</ul>`
		: '<p class="steam-pending">// Nothing played in the last two weeks.</p>'}`;
	} else {
		favourites = `\t\t${badgeGames.length ? `<p>Games with badges: ${gameList(badgeGames)}.</p>` : ''}
		<p class="steam-pending">// Most-played games appear here automatically once hours are available (see below).</p>`;
		playtime = STEAM_API_KEY
			? `\t\t<p class="steam-pending">// Hours are hidden because game details are private on Steam. To show them: Steam &rarr; Edit Profile &rarr; Privacy Settings &rarr; set Game details to Public and untick &ldquo;Always keep my total playtime private&rdquo;.</p>`
			: `\t\t<p class="steam-pending">// Hours need a Steam Web API key (the STEAM_API_KEY secret) and Game details set to Public on Steam.</p>`;
	}

	const favouriteBadge = d.badges.find((b) => b.name === d.favouriteBadge);
	const badges = [...d.badges].sort((a, b) => b.xp - a.xp || (a.unlocked || 0) - (b.unlocked || 0)).map((b) => {
		const meta = [b.level ? `Level ${b.level}` : '', `${fmt(b.xp)} XP`, b.unlocked ? shortDate(b.unlocked) : ''].filter(Boolean).join(' &middot; ');
		const game = b.game ? ` <em>&middot; ${esc(b.game)}</em>` : '';
		return `\t\t\t<li><span class="steam-badge-name">${esc(b.name)}${game}</span><span class="steam-badge-meta">${meta}</span></li>`;
	}).join('\n');

	const quote = d.summary ? `&ldquo;${esc(d.summary)}&rdquo; &middot; ` : '';
	const avatar = d.avatar
		? `<img src="${d.avatar}" alt="${esc(d.name)} Steam avatar" width="184" height="184" />`
		: '<span class="icon brands fa-steam" aria-hidden="true"></span>';

	return `<section class="post">
	<header class="major">
		<h1>Gaming</h1>
		<p>// Steam profile and stats${updated ? ` &middot; updated ${updated}` : ''}.</p>
	</header>

	<div class="steam-card">
		<div class="steam-avatar">${avatar}</div>
		<div class="steam-id">
			<h3>${esc(d.name)}</h3>
			<p>// ${quote}member since ${esc(longDate(d.memberSince))}</p>
			<div class="steam-level">
				<span class="steam-level-num">Level ${level}</span>
				<span class="steam-level-bar" role="img" aria-label="${fmt(d.xp)} XP, ${fmt(toNext)} XP to level ${level + 1}"><span style="width: ${pct}%"></span></span>
				<span class="steam-level-xp">${fmt(d.xp)} XP &middot; ${fmt(toNext)} XP to level ${level + 1}</span>
			</div>
			<ul class="actions"><li><a href="${PROFILE}/" target="_blank" rel="noopener noreferrer" class="button">View Steam profile</a></li></ul>
		</div>
	</div>

	<ul class="steam-tiles">
${tiles}
	</ul>

	<div class="steam-stats">
		<h3>Favourite games</h3>
${favourites}

		<h3>Hours played</h3>
${playtime}

		<h3>Badges</h3>
		${favouriteBadge ? `<p>Favourite badge: <strong>${esc(favouriteBadge.name)}</strong>${favouriteBadge.game ? ` &middot; ${esc(favouriteBadge.game)}` : ''}.</p>` : ''}
		<ul class="steam-badges">
${badges}
		</ul>
	</div>
</section>
`;
}

// ---------------------------------------------------------------------------

const now = new Date();

const profile = parseProfileXml(await text(`${PROFILE}/?xml=1`, 'the Steam profile'));
const page = parseProfilePage(await text(`${PROFILE}/`, 'the Steam profile page'));
const badgesPage = parseBadgesPage(await text(`${PROFILE}/badges/`, 'the Steam badges page'), now);

if (page.level === null || badgesPage.xp === null) throw new Error('The Steam profile layout has changed; update the parsers in tools/steam-sync.mjs.');

// A failed avatar download isn't fatal: the avatar already on the page is kept.
let avatar = '';
if (profile.avatarUrl) {
	try {
		const res = await get(profile.avatarUrl, 'the Steam avatar');
		const type = res.headers.get('content-type') || '';
		if (type.startsWith('image/')) avatar = `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
	} catch (e) {
		console.log('Steam avatar unavailable; keeping the current one.');
	}
}

let games = null, recent = null;
if (STEAM_API_KEY) {
	const steamid = profile.steamId64;
	games = (await api('IPlayerService/GetOwnedGames/v1', { steamid, include_appinfo: 1, include_played_free_games: 1 })).games || [];
	recent = (await api('IPlayerService/GetRecentlyPlayedGames/v1', { steamid })).games || [];
}

const data = { ...profile, ...page, xp: badgesPage.xp, badges: badgesPage.badges, avatar, games, recent };

const pageHtml = readFileSync(PAGE, 'utf8');
const bundle = JSON.parse(await decryptFrom(pageHtml, VAULT_PASS).catch(() => {
	throw new Error('VAULT_PASS does not decrypt private.html.');
}));
if (!Array.isArray(bundle.pages)) throw new Error('The private space is not in the multi-page format.');

const current = bundle.pages.find((p) => p.id === 'gaming');
if (!data.avatar && current) {
	const kept = current.html.match(/<img src="(data:image\/[^"]+)"/);
	if (kept) data.avatar = kept[1];
}
const fresh = renderPage(data, '');

if (current && current.html.replace(UPDATED, '<p>// Steam profile and stats.</p>') === fresh) {
	console.log('Steam data unchanged; private.html left as is.');
} else {
	const html = renderPage(data, shortDate(now));
	if (current) current.html = html;
	else bundle.pages.push({ id: 'gaming', html });
	const { html: updatedPage } = await encryptInto(pageHtml, VAULT_PASS, JSON.stringify(bundle));
	writeFileSync(PAGE, updatedPage);
	console.log('Steam data changed; private.html updated.');
}
