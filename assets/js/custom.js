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

	// Hidden terminal -------------------------------------------------------
	// Opened with ~ (or `) on a keyboard, or by tapping the intro heading or
	// the copyright line five times quickly. `cd private` opens the private space.

	var pages = {
			'~': 'index.html', '/': 'index.html', home: 'index.html', overview: 'index.html',
			mai: 'mai.html',
			robotics: 'rbsim.html', rbsim: 'rbsim.html',
			outbreak: 'outbreak.html',
			data: 'dataScience.html', datascience: 'dataScience.html',
			ems: 'ems.html',
			private: 'private.html'
		},
		listed = ['mai', 'robotics', 'outbreak', 'datascience', 'ems', 'contact'],
		term, out, input, lastFocus,
		cmdHistory = [], historyPos = 0;

	function print(text, className) {
		var line = document.createElement('div');
		line.className = 'term-text' + (className ? ' ' + className : '');
		line.textContent = text;
		out.appendChild(line);
		out.scrollTop = out.scrollHeight;
	}

	function go(href) {
		print('opening ' + href.replace('.html', '') + '...', 'term-ok');
		setTimeout(function() { window.location.href = href; }, 250);
	}

	var commands = {
		help: function() {
			print('commands: help, ls, cd <page>, whoami, date, clear, exit');
		},
		ls: function() {
			print(listed.join('  '));
		},
		whoami: function() {
			print('zak rackham: software engineer turning ideas into systems');
		},
		date: function() {
			print(new Date().toString());
		},
		clear: function() {
			out.textContent = '';
		},
		exit: function() {
			closeTerm();
		},
		sudo: function() {
			print('nice try.', 'term-err');
		},
		cd: function(arg) {
			var name = (arg || '~').toLowerCase().replace(/\.html$/, '').replace(/^\.\//, '');

			if (name === 'contact') {
				closeTerm();
				centerContact(true);
				return;
			}

			var href = pages[name];
			if (!href) return print('cd: no such page: ' + arg, 'term-err');

			var here = window.location.pathname.split('/').pop() || 'index.html';
			if (href === here) return print('already here.');

			go(href);
		}
	};

	function run(line) {
		var parts = line.trim().split(/\s+/),
			name = parts[0].toLowerCase();

		print('zak@zgr:~$ ' + line, 'term-echo');
		if (!name) return;

		if (commands.hasOwnProperty(name)) commands[name](parts[1]);
		else print(name + ': command not found. try help', 'term-err');
	}

	function build() {
		term = document.createElement('div');
		term.className = 'term';
		term.setAttribute('role', 'dialog');
		term.setAttribute('aria-label', 'Terminal');
		term.hidden = true;
		term.innerHTML =
			'<div class="term-bar"><span class="term-title">zak@zgr: ~</span>' +
			'<button type="button" class="term-close" aria-label="Close terminal">&times;</button></div>' +
			'<div class="term-out" aria-live="polite"></div>' +
			'<form class="term-line"><label for="term-in">zak@zgr:~$</label>' +
			'<input id="term-in" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" /></form>';
		document.body.appendChild(term);

		out = term.querySelector('.term-out');
		input = term.querySelector('input');

		term.querySelector('.term-close').addEventListener('click', closeTerm);

		term.querySelector('form').addEventListener('submit', function(event) {
			event.preventDefault();
			var line = input.value;
			input.value = '';
			if (line.trim()) cmdHistory.push(line);
			historyPos = cmdHistory.length;
			run(line);
		});

		input.addEventListener('keydown', function(event) {
			if (event.key === 'Escape') {
				closeTerm();
			} else if (event.key === 'ArrowUp' && historyPos > 0) {
				input.value = cmdHistory[--historyPos];
				event.preventDefault();
			} else if (event.key === 'ArrowDown') {
				historyPos = Math.min(historyPos + 1, cmdHistory.length);
				input.value = cmdHistory[historyPos] || '';
				event.preventDefault();
			}
		});

		print('type help for commands.', 'term-dim');
	}

	function openTerm() {
		if (!term) build();
		if (!term.hidden) return input.focus();
		lastFocus = document.activeElement;
		term.hidden = false;
		input.focus();
	}

	function closeTerm() {
		if (!term || term.hidden) return;
		term.hidden = true;
		if (lastFocus && lastFocus.focus) lastFocus.focus();
	}

	// Keyboard: ~ or ` anywhere except while typing in a field.
	document.addEventListener('keydown', function(event) {
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		if (event.key !== '~' && event.key !== '`') return;

		var target = event.target,
			tag = target && target.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target && target.isContentEditable)) return;

		event.preventDefault();
		openTerm();
	});

	// Touch: five quick taps on the intro heading or the copyright line.
	var taps = 0, tapTimer;
	document.addEventListener('click', function(event) {
		if (!event.target.closest || !event.target.closest('#intro h1, #copyright')) return;

		taps++;
		clearTimeout(tapTimer);
		tapTimer = setTimeout(function() { taps = 0; }, 1500);

		if (taps >= 5) {
			taps = 0;
			openTerm();
		}
	});

	// GitHub activity pane --------------------------------------------------
	// Contribution graph (drawn weekly by tools/github-activity.mjs) and a live
	// "git log" of recent commits from GitHub's public API.

	var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

	function shortDate(iso) {
		var p = iso.split('-');
		return +p[2] + ' ' + MONTH_NAMES[+p[1] - 1] + ' ' + p[0];
	}

	function timeAgo(iso) {
		var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000),
			units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
		for (var i = 0; i < units.length; i++) {
			var n = Math.floor(s / units[i][1]);
			if (n >= 1) return n + ' ' + units[i][0] + (n > 1 ? 's' : '') + ' ago';
		}
		return 'just now';
	}

	// Inline the graph SVG so day tooltips and the page font work; keep the <img> if that fails.
	var graph = document.querySelector('.gh-graph');
	if (graph && window.fetch) {
		fetch(graph.getAttribute('data-src'))
			.then(function(r) { if (!r.ok) throw r; return r.text(); })
			.then(function(svg) {
				graph.innerHTML = svg;
				graph.scrollLeft = graph.scrollWidth; // most recent weeks first on narrow screens
			})
			.catch(function() {});
	}

	var caption = document.querySelector('.gh-caption');
	if (caption && window.fetch) {
		fetch(caption.getAttribute('data-src'))
			.then(function(r) { if (!r.ok) throw r; return r.json(); })
			.then(function(d) {
				caption.textContent = d.total === null
					? '// The contribution graph fills in after the first weekly sync.'
					: '// ' + d.total.toLocaleString('en-GB') + ' contributions in the last year · updated ' + shortDate(d.updated);
			})
			.catch(function() {});
	}

	var log = document.querySelector('.gh-log');
	if (log) {
		var list = log.querySelector('.gh-commits'),
			repo = log.getAttribute('data-repo'),
			cacheKey = 'gh-commits:' + repo;

		var showStatus = function(text) {
			list.innerHTML = '';
			var li = document.createElement('li');
			li.className = 'gh-status';
			li.textContent = text;
			list.appendChild(li);
		};

		// Keep only what the panel shows; skip merge commits and automated bot commits.
		var latest = function(commits) {
			return commits.filter(function(c) {
				var login = c.author && c.author.login || '';
				return c.parents.length < 2 && !/\[bot\]$/.test(login) && !/\[bot\]$/.test(c.commit.author.name);
			}).slice(0, 6).map(function(c) {
				return { sha: c.sha.slice(0, 7), url: c.html_url, message: c.commit.message.split('\n')[0], date: c.commit.author.date };
			});
		};

		var render = function(commits) {
			if (!commits.length) return showStatus('// No recent commits.');
			list.innerHTML = '';
			commits.forEach(function(c) {
				var li = document.createElement('li'),
					sha = document.createElement('a'),
					msg = document.createElement('span'),
					when = document.createElement('time');
				sha.className = 'gh-sha';
				sha.href = c.url;
				sha.target = '_blank';
				sha.rel = 'noopener';
				sha.textContent = c.sha;
				msg.className = 'gh-msg';
				msg.textContent = c.message;
				when.className = 'gh-when';
				when.dateTime = c.date;
				when.textContent = timeAgo(c.date);
				li.appendChild(sha);
				li.appendChild(msg);
				li.appendChild(when);
				list.appendChild(li);
			});
		};

		// GitHub allows 60 unauthenticated requests an hour, so reuse a result for 10 minutes.
		var cached = null;
		try { cached = JSON.parse(sessionStorage.getItem(cacheKey)); } catch (e) {}

		if (cached && Date.now() - cached.at < 600000) {
			render(cached.commits);
		} else if (window.fetch) {
			fetch('https://api.github.com/repos/' + repo + '/commits?per_page=30', { headers: { Accept: 'application/vnd.github+json' } })
				.then(function(r) { if (!r.ok) throw r; return r.json(); })
				.then(function(commits) {
					commits = latest(commits);
					render(commits);
					try { sessionStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), commits: commits })); } catch (e) {}
				})
				.catch(function() {
					showStatus('// Couldn’t reach GitHub right now. Use “View full history” below.');
				});
		} else {
			showStatus('// Recent commits need a newer browser.');
		}
	}

})();
