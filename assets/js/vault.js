/*
	Unlocks the private space on private.html.

	The page ships only an AES-256-GCM encrypted payload (see tools/vault.mjs).
	The passphrase never leaves the browser: it derives the key locally with
	PBKDF2-SHA256, and a wrong passphrase simply fails GCM authentication.
	Nothing is stored, so the space locks again when the page is closed.
*/
(function() {

	var form = document.getElementById('vault-form'),
		input = document.getElementById('vault-pass'),
		button = form.querySelector('input[type="submit"]'),
		status = document.getElementById('vault-status'),
		lock = document.getElementById('vault-lock');

	function bytes(base64) {
		var binary = atob(base64), out = new Uint8Array(binary.length);
		for (var i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
		return out;
	}

	function unlock(passphrase) {
		var payload = JSON.parse(document.getElementById('vault-data').textContent),
			subtle = window.crypto.subtle;

		return subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'])
			.then(function(material) {
				return subtle.deriveKey(
					{ name: 'PBKDF2', hash: 'SHA-256', salt: bytes(payload.salt), iterations: payload.iterations },
					material,
					{ name: 'AES-GCM', length: 256 },
					false,
					['decrypt']
				);
			})
			.then(function(key) {
				return subtle.decrypt({ name: 'AES-GCM', iv: bytes(payload.iv) }, key, bytes(payload.data));
			})
			.then(function(plaintext) {
				return new TextDecoder().decode(plaintext);
			});
	}

	if (!window.crypto || !window.crypto.subtle) {
		status.textContent = 'This browser can\'t unlock the private space. It needs a secure (https) connection and a modern browser.';
		button.disabled = true;
		return;
	}

	form.addEventListener('submit', function(event) {
		event.preventDefault();
		if (!input.value) return;

		button.disabled = true;
		status.textContent = 'Unlocking…';

		unlock(input.value)
			.then(function(html) {
				// The content is authenticated by AES-GCM, so it is exactly what was encrypted.
				// Sections replace the lock pane in place so they pick up the pane styles.
				input.value = '';
				lock.insertAdjacentHTML('afterend', html);
				var first = lock.nextElementSibling;
				lock.parentNode.removeChild(lock);
				if (first) {
					first.setAttribute('tabindex', '-1');
					first.focus();
				}
			})
			.catch(function() {
				status.textContent = 'Incorrect passphrase.';
				button.disabled = false;
				input.select();
			});
	});

})();
