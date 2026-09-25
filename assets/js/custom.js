/*
	Site-specific behaviour loaded after the HTML5 UP template scripts.
*/
(function() {

	var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	// Where to scroll so the contact/footer pane sits in the middle of the screen.
	// If it's taller than the screen, line its top up near the top instead.
	function contactTarget() {
		var rect = document.getElementById('footer').getBoundingClientRect(),
			gap = Math.max((window.innerHeight - rect.height) / 2, 16);

		return window.pageYOffset + rect.top - gap;
	}

	// Lazy-loaded images above the footer can grow the page mid-scroll, so
	// once scrolling settles, re-check and correct (a few times at most).
	function centerContact(smooth) {
		if (!document.getElementById('footer')) return;

		var behavior = smooth && !reduceMotion ? 'smooth' : 'auto',
			attempts = 0,
			timer;

		function settle() {
			clearTimeout(timer);
			timer = setTimeout(function() {
				var target = contactTarget();
				if (Math.abs(window.pageYOffset - target) > 4 && ++attempts < 5)
					window.scrollTo({ top: target, behavior: behavior });
				else
					window.removeEventListener('scroll', settle);
			}, 150);
		}

		window.addEventListener('scroll', settle);
		window.scrollTo({ top: contactTarget(), behavior: behavior });
		settle();
	}

	// Drop the #con hash so tapping Contact again still triggers a scroll.
	function clearHash() {
		if (window.location.hash === '#con' && window.history.replaceState)
			window.history.replaceState(null, '', window.location.pathname + window.location.search);
	}

	// Desktop nav and any in-page link to #con.
	document.addEventListener('click', function(event) {
		var link = event.target.closest && event.target.closest('a[href="#con"]');
		if (!link) return;
		event.preventDefault();
		centerContact(true);
	});

	// The mobile menu panel navigates by setting location.href after it closes.
	window.addEventListener('hashchange', function() {
		if (window.location.hash !== '#con') return;
		centerContact(true);
		clearHash();
	});

	// Arriving with #con in the URL.
	window.addEventListener('load', function() {
		if (window.location.hash !== '#con') return;
		centerContact(false);
		clearHash();
	});

})();
