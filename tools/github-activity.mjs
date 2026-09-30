#!/usr/bin/env node
/*
	Draws the GitHub contribution graph for the overview page's Activity pane.

	Fetches the last year of contributions from GitHub's official GraphQL API
	and writes:
		images/github-contributions.svg        the graph, in the site's colours
		assets/data/github-contributions.json  total, date range and last update

	Files are only rewritten when the contribution data has changed.

	Environment:
		GITHUB_TOKEN              token for the GraphQL API (the Actions token works)
		GITHUB_USER               account to graph (defaults to GITHUB_REPOSITORY_OWNER)
		GITHUB_ACTIVITY_FIXTURE   path to a saved GraphQL response, used instead of the API
		GITHUB_ACTIVITY_PLACEHOLDER=1  write an empty graph (before the first real sync)

	Run weekly by .github/workflows/github-activity.yml.
*/
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const SVG = 'images/github-contributions.svg';
const DATA = 'assets/data/github-contributions.json';
const USER = process.env.GITHUB_USER || process.env.GITHUB_REPOSITORY_OWNER;

const QUERY = `query($login: String!) {
	user(login: $login) {
		contributionsCollection {
			contributionCalendar {
				totalContributions
				weeks { contributionDays { date contributionCount contributionLevel weekday } }
			}
		}
	}
}`;

async function fetchCalendar() {
	if (process.env.GITHUB_ACTIVITY_FIXTURE) {
		return JSON.parse(readFileSync(process.env.GITHUB_ACTIVITY_FIXTURE, 'utf8')).data.user.contributionsCollection.contributionCalendar;
	}
	if (process.env.GITHUB_ACTIVITY_PLACEHOLDER) return placeholderCalendar();
	if (!process.env.GITHUB_TOKEN || !USER) throw new Error('Set GITHUB_TOKEN and GITHUB_USER.');

	const res = await fetch('https://api.github.com/graphql', {
		method: 'POST',
		headers: { Authorization: `bearer ${process.env.GITHUB_TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'portfolio-github-activity' },
		body: JSON.stringify({ query: QUERY, variables: { login: USER } })
	});
	if (!res.ok) throw new Error(`GitHub GraphQL API returned HTTP ${res.status}.`);
	const body = await res.json();
	if (body.errors) throw new Error(`GitHub GraphQL API error: ${body.errors.map((e) => e.message).join('; ')}`);
	return body.data.user.contributionsCollection.contributionCalendar;
}

// An empty year of weeks ending today, shown until the first real sync.
function placeholderCalendar() {
	const today = new Date();
	const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
	const start = end - (52 * 7 + new Date(end).getUTCDay()) * 864e5;
	const weeks = [];
	for (let t = start; t <= end; t += 864e5) {
		const d = new Date(t);
		if (d.getUTCDay() === 0 || !weeks.length) weeks.push({ contributionDays: [] });
		weeks[weeks.length - 1].contributionDays.push({ date: d.toISOString().slice(0, 10), contributionCount: 0, contributionLevel: 'NONE', weekday: d.getUTCDay() });
	}
	return { totalContributions: null, weeks };
}

// ---------------------------------------------------------------------------
// Drawing

const CELL = 11, STEP = 14, LEFT = 32, TOP = 20;
const COLOURS = { NONE: '#1a212b', FIRST_QUARTILE: '#0e4429', SECOND_QUARTILE: '#006d32', THIRD_QUARTILE: '#26a641', FOURTH_QUARTILE: '#39d353' };
const LEVELS = Object.keys(COLOURS);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function longDate(iso) {
	const [y, m, d] = iso.split('-').map(Number);
	return `${d} ${MONTHS[m - 1]} ${y}`;
}

function drawSvg(calendar) {
	const weeks = calendar.weeks;
	const width = LEFT + weeks.length * STEP;
	const height = TOP + 7 * STEP + 22;
	const out = [];

	out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="GitHub contribution graph for the last year" font-family="JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="10" fill="#8b949e">`);

	// Month labels where a new month starts. A label too close to the next one
	// (a partial month at the start of the year) is dropped, as on GitHub.
	const starts = [];
	weeks.forEach((week, i) => {
		const month = Number(week.contributionDays[0].date.slice(5, 7)) - 1;
		if (!starts.length || starts[starts.length - 1].month !== month) starts.push({ month, x: LEFT + i * STEP });
	});
	starts.forEach((start, i) => {
		const next = starts[i + 1];
		if (!next || next.x - start.x >= 3 * STEP) out.push(`<text x="${start.x}" y="${TOP - 7}">${MONTHS[start.month]}</text>`);
	});

	[['Mon', 1], ['Wed', 3], ['Fri', 5]].forEach(([label, day]) => {
		out.push(`<text x="0" y="${TOP + day * STEP + 9}">${label}</text>`);
	});

	weeks.forEach((week, i) => {
		week.contributionDays.forEach((day) => {
			const n = day.contributionCount;
			const title = `${n === 0 ? 'No' : n} contribution${n === 1 ? '' : 's'} on ${longDate(day.date)}`;
			out.push(`<rect x="${LEFT + i * STEP}" y="${TOP + day.weekday * STEP}" width="${CELL}" height="${CELL}" rx="2" fill="${COLOURS[day.contributionLevel] || COLOURS.NONE}"><title>${title}</title></rect>`);
		});
	});

	// Legend, bottom right.
	const legendY = TOP + 7 * STEP + 8;
	let x = width - LEVELS.length * STEP - 30;
	out.push(`<text x="${x - 32}" y="${legendY + 9}">Less</text>`);
	LEVELS.forEach((level) => {
		out.push(`<rect x="${x}" y="${legendY}" width="${CELL}" height="${CELL}" rx="2" fill="${COLOURS[level]}"/>`);
		x += STEP;
	});
	out.push(`<text x="${x + 3}" y="${legendY + 9}">More</text>`);

	out.push('</svg>\n');
	return out.join('\n');
}

// ---------------------------------------------------------------------------

const calendar = await fetchCalendar();
const days = calendar.weeks.flatMap((w) => w.contributionDays);
const svg = drawSvg(calendar);
const data = { total: calendar.totalContributions, from: days[0].date, to: days[days.length - 1].date };

const previous = existsSync(DATA) ? JSON.parse(readFileSync(DATA, 'utf8')) : null;
const unchanged = previous && existsSync(SVG) && readFileSync(SVG, 'utf8') === svg
	&& previous.total === data.total && previous.from === data.from && previous.to === data.to;

if (unchanged) {
	console.log('Contribution graph unchanged.');
} else {
	mkdirSync('assets/data', { recursive: true });
	writeFileSync(SVG, svg);
	writeFileSync(DATA, JSON.stringify({ ...data, updated: new Date().toISOString().slice(0, 10) }, null, '\t') + '\n');
	console.log(`Contribution graph updated (${data.total ?? 'placeholder'} contributions).`);
}
