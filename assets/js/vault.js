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

	// Insert HTML as direct children of #main, just after `anchor`, so the
	// sections pick up the pane styles. Returns the inserted elements.
	function insertAfter(anchor, html) {
		var marker = anchor.nextSibling;
		anchor.insertAdjacentHTML('afterend', html);
		var nodes = [], node = anchor.nextSibling;
		while (node && node !== marker) {
			nodes.push(node);
			node = node.nextSibling;
		}
		return nodes;
	}

	function focusFirst(nodes) {
		for (var i = 0; i < nodes.length; i++) {
			if (nodes[i].nodeType === 1) {
				nodes[i].setAttribute('tabindex', '-1');
				nodes[i].focus({ preventScroll: true });
				return;
			}
		}
	}

	// Several private pages: build the private nav and show one page at a time,
	// chosen by the URL hash (e.g. private.html#gaming).
	function showPages(pages) {
		var nav = document.createElement('nav');
		nav.className = 'private-nav';
		nav.setAttribute('aria-label', 'Private pages');

		var links = pages.map(function(page) {
			return '<li><a href="#' + page.id + '" data-page="' + page.id + '">' + page.id + '</a></li>';
		}).join('');

		nav.innerHTML =
			'<span class="private-nav-path">~/private</span>' +
			'<ul>' + links + '</ul>' +
			'<button type="button" class="private-lock">lock</button>';

		lock.parentNode.replaceChild(nav, lock);

		var current = [];

		function render(focus) {
			var id = window.location.hash.slice(1),
				page = pages.filter(function(p) { return p.id === id; })[0] || pages[0];

			current.forEach(function(node) { node.parentNode && node.parentNode.removeChild(node); });
			current = insertAfter(nav, page.html);

			Array.prototype.forEach.call(nav.querySelectorAll('a[data-page]'), function(a) {
				var active = a.getAttribute('data-page') === page.id;
				a.parentNode.classList.toggle('active', active);
				if (active) a.setAttribute('aria-current', 'page');
				else a.removeAttribute('aria-current');
			});

			if (focus) focusFirst(current);
		}

		// Bring the nav into view with room above it for the floating mobile menu button.
		window.addEventListener('hashchange', function() {
			render(true);
			window.scrollTo(0, nav.getBoundingClientRect().top + window.pageYOffset - 72);
		});

		// Locking reloads the page without the hash, discarding everything decrypted.
		nav.querySelector('.private-lock').addEventListener('click', function() {
			window.location.replace(window.location.pathname);
		});

		render(true);
	}

	form.addEventListener('submit', function(event) {
		event.preventDefault();
		if (!input.value) return;

		button.disabled = true;
		status.textContent = 'Unlocking…';

		unlock(input.value)
			.then(function(text) {
				// The content is authenticated by AES-GCM, so it is exactly what was encrypted.
				input.value = '';

				var bundle = null;
				try { bundle = JSON.parse(text); } catch (e) { /* single-page payload */ }

				if (bundle && Array.isArray(bundle.pages) && bundle.pages.length) {
					showPages(bundle.pages);
				} else {
					var nodes = insertAfter(lock, text);
					lock.parentNode.removeChild(lock);
					focusFirst(nodes);
				}
			}, function() {
				// Only a failed decryption (wrong passphrase) lands here.
				status.textContent = 'Incorrect passphrase.';
				button.disabled = false;
				input.select();
			});
	});

})();
