/*
	Shared crypto for the private space, used by tools/vault.mjs and
	tools/steam-sync.mjs. Matches the in-browser decryption in assets/js/vault.js:
	PBKDF2-SHA256 (600,000 iterations, 16-byte random salt) derives a 256-bit
	AES-GCM key, and a fresh 12-byte IV is used on every encryption.
*/
import { webcrypto as crypto } from 'node:crypto';

export const PAGE = 'private.html';
const ITERATIONS = 600000;
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

// Locate the JSON payload inside private.html.
function payloadBounds(pageHtml) {
	const start = pageHtml.indexOf(START);
	const end = pageHtml.indexOf(END, start);
	if (start < 0 || end < 0) throw new Error(`No vault-data block found in ${PAGE}`);
	return { start: start + START.length, end };
}

export async function encryptInto(pageHtml, passphrase, text) {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await deriveKey(passphrase, salt, ITERATIONS);
	const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
	const payload = JSON.stringify({ v: 1, iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(ciphertext) });
	const { start, end } = payloadBounds(pageHtml);
	return { html: pageHtml.slice(0, start) + payload + pageHtml.slice(end), bytes: ciphertext.length };
}

// Rejects if the passphrase is wrong or the payload has been altered.
export async function decryptFrom(pageHtml, passphrase) {
	const { start, end } = payloadBounds(pageHtml);
	const payload = JSON.parse(pageHtml.slice(start, end));
	const key = await deriveKey(passphrase, unb64(payload.salt), payload.iterations);
	const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(payload.iv) }, key, unb64(payload.data));
	return new TextDecoder().decode(plaintext);
}
