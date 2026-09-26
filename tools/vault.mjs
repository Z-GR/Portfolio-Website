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

	The crypto lives in tools/vault-lib.mjs; assets/js/vault.js performs the
	matching decryption in the browser.
*/
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { PAGE, encryptInto, decryptFrom } from './vault-lib.mjs';

const SOURCE = 'private-src/content.html';
const PAGES = 'private-src/pages';

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

const passphrase = process.env.VAULT_PASS;
if (!passphrase) {
	console.error('Set the passphrase in the VAULT_PASS environment variable.');
	process.exit(1);
}

const mode = process.argv[2];
const page = readFileSync(PAGE, 'utf8');

if (mode === 'encrypt') {
	const { html, bytes } = await encryptInto(page, passphrase, readSource());
	writeFileSync(PAGE, html);
	console.log(`Encrypted ${existsSync(PAGES) ? PAGES + '/' : SOURCE} into ${PAGE} (${bytes} bytes).`);
} else if (mode === 'decrypt') {
	const text = await decryptFrom(page, passphrase)
		.catch(() => { console.error('Wrong passphrase, or the payload has been altered.'); process.exit(1); });
	console.log(`Decrypted ${PAGE} into ${writeSource(text)}.`);
} else {
	console.error('Usage: node tools/vault.mjs encrypt|decrypt');
	process.exit(1);
}
