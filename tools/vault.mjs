#!/usr/bin/env node
/*
	Encrypts the private space for private.html, or decrypts it for editing.

	The readable source lives in private-src/ (git-ignored, never committed).
	Only the encrypted payload is written into private.html.

	Private pages: each file in private-src/pages/ is one page, shown as a tab
	in the private nav. Files are named <order>-<id>.html (e.g. 1-home.html);
	the id is the tab name and URL hash. All pages share one payload, so one
	passphrase unlocks them all. Without a pages folder, the single legacy
	file private-src/content.html is used instead.

	Usage (passphrase is read from the VAULT_PASS environment variable):
		VAULT_PASS='...' node tools/vault.mjs encrypt   # private-src/pages/ (or content.html) -> private.html
		VAULT_PASS='...' node tools/vault.mjs decrypt   # private.html -> private-src/pages/ (or content.html)

	Crypto: PBKDF2-SHA256 (600,000 iterations, 16-byte random salt) derives a
	256-bit AES-GCM key; a fresh 12-byte IV is used on every encryption.
	assets/js/vault.js performs the matching decryption in the browser.
*/
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';

const ITERATIONS = 600000;
const SOURCE = 'private-src/content.html';
const PAGES = 'private-src/pages';
const PAGE = 'private.html';
const START = '<script id="vault-data" type="application/json">';
const END = '</script>';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const unb64 = (text) => new Uint8Array(Buffer.from(text, 'base64'));

async function deriveKey(passphrase, salt, iterations) {
	const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
	return crypto.subtle.deriveKey(
		{ name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
		material,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

// Pages bundle as JSON { pages: [{ id, html }] }; the legacy format is plain HTML.
function readSource() {
	if (!existsSync(PAGES)) return readFileSync(SOURCE, 'utf8');
	const files = readdirSync(PAGES).filter((f) => /^\d+-[a-z0-9-]+\.html$/.test(f))
		.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
	if (!files.length) throw new Error(`No <order>-<id>.html files in ${PAGES}`);
	return JSON.stringify({
		pages: files.map((f) => ({ id: f.replace(/^\d+-/, '').replace(/\.html$/, ''), html: readFileSync(`${PAGES}/${f}`, 'utf8') }))
	});
}

function writeSource(text) {
	let bundle = null;
	try { bundle = JSON.parse(text); } catch (e) { /* legacy single page */ }
	if (bundle && Array.isArray(bundle.pages)) {
		mkdirSync(PAGES, { recursive: true });
		bundle.pages.forEach((p, i) => writeFileSync(`${PAGES}/${i + 1}-${p.id}.html`, p.html));
		return `${bundle.pages.length} pages in ${PAGES}/`;
	}
	mkdirSync('private-src', { recursive: true });
	writeFileSync(SOURCE, text);
	return SOURCE;
}

function readPayload(page) {
	const start = page.indexOf(START);
	const end = page.indexOf(END, start);
	if (start < 0 || end < 0) throw new Error(`No vault-data block found in ${PAGE}`);
	return { start: start + START.length, end };
}

const passphrase = process.env.VAULT_PASS;
if (!passphrase) {
	console.error('Set the passphrase in the VAULT_PASS environment variable.');
	process.exit(1);
}

const mode = process.argv[2];
const page = readFileSync(PAGE, 'utf8');
const { start, end } = readPayload(page);

if (mode === 'encrypt') {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await deriveKey(passphrase, salt, ITERATIONS);
	const plaintext = new TextEncoder().encode(readSource());
	const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
	const payload = JSON.stringify({ v: 1, iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(ciphertext) });
	writeFileSync(PAGE, page.slice(0, start) + payload + page.slice(end));
	console.log(`Encrypted ${existsSync(PAGES) ? PAGES + '/' : SOURCE} into ${PAGE} (${ciphertext.length} bytes).`);
} else if (mode === 'decrypt') {
	const payload = JSON.parse(page.slice(start, end));
	const key = await deriveKey(passphrase, unb64(payload.salt), payload.iterations);
	const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(payload.iv) }, key, unb64(payload.data))
		.catch(() => { console.error('Wrong passphrase, or the payload has been altered.'); process.exit(1); });
	console.log(`Decrypted ${PAGE} into ${writeSource(new TextDecoder().decode(plaintext))}.`);
} else {
	console.error('Usage: node tools/vault.mjs encrypt|decrypt');
	process.exit(1);
}
