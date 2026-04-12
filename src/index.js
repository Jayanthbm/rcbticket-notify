const API_URL = 'https://rcbscaleapi.ticketgenie.in/ticket/eventlist/O';

// ---- Config ----
const TELEGRAM_USERS = ['gultoo24', 'Pp1234099', 'janjankumar'];

// ---- Time Helper (IST) ----
function getNowIST() {
	return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
}

// ---- Helpers ----

// Fetch events
const PROXY_BASE = 'https://cf-cors-proxy.jayanthbharadwajm.workers.dev/?url=';

const PROXY_API_KEY = 'vx5TKJtywTt8l3Y7tO90FD4RS5KnrPQ';

async function fetchEvents() {
	const headers = {
		accept: 'application/json, text/plain, */*',
		'accept-language': 'en-IN,en;q=0.9',
		'cache-control': 'no-cache',
		pragma: 'no-cache',

		origin: 'https://shop.royalchallengers.com',
		referer: 'https://shop.royalchallengers.com/',

		'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',

		'sec-ch-ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
		'sec-ch-ua-mobile': '?0',
		'sec-ch-ua-platform': '"macOS"',

		'sec-fetch-dest': 'empty',
		'sec-fetch-mode': 'cors',
		'sec-fetch-site': 'cross-site',
	};

	try {
		// 🔵 Primary request (direct)
		const res = await fetch(API_URL, {
			method: 'GET',
			headers,
		});

		if (!res.ok) {
			throw new Error(`Primary failed: ${res.status}`);
		}

		const data = await res.json();
		return data.result || [];
	} catch (err) {
		console.warn('Primary failed, switching to proxy:', err.message);

		try {
			// 🟡 Fallback via proxy
			const proxyUrl = PROXY_BASE + encodeURIComponent(API_URL);

			const res = await fetch(proxyUrl, {
				headers: {
					...headers,
					'x-api-key': PROXY_API_KEY,
				},
			});

			if (!res.ok) {
				throw new Error(`Proxy failed: ${res.status}`);
			}

			const data = await res.json();
			return data.result || [];
		} catch (proxyErr) {
			console.error('Proxy also failed:', proxyErr.message);
			return []; // or throw if you want strict failure
		}
	}
}

// Filter valid events (BUY TICKETS only)
function getValidEvents(events) {
	const now = getNowIST();

	return events.filter((event) => {
		const eventDate = new Date(event.event_Date);

		return eventDate >= now && event.event_Button_Text === 'BUY TICKETS';
	});
}

// Available events (for response only)
function getAvailableEvents(events) {
	const now = getNowIST();

	return events.filter((event) => {
		const eventDate = new Date(event.event_Date);

		return eventDate >= now && event.event_Button_Text === 'BUY TICKETS';
	});
}

// Build message
function buildMessage(event) {
	return `🎟️ Tickets on Sale!\n` + `${event.event_Name}\n` + `${event.event_Display_Date}\n` + `${event.event_Price_Range}`;
}

// Send Telegram
async function sendTelegramMessage(users, message) {
	const userString = users.join('|');

	const url = `https://api.callmebot.com/text.php?user=${userString}` + `&text=${encodeURIComponent(message)}`;

	return fetch(url);
}

// ---- D1 Logic ----

// Check last notification
async function shouldSendNotification(db, eventCode, username) {
	const result = await db
		.prepare(
			`
      SELECT notified_at
      FROM notifications
      WHERE event_code = ? AND notify_username = ?
      ORDER BY notified_at DESC
      LIMIT 1
    `,
		)
		.bind(eventCode, username)
		.first();

	if (!result) return true;

	const lastSent = new Date(result.notified_at);
	const now = getNowIST();

	const diffMs = now - lastSent;

	const ONE_HOUR = 60 * 60 * 1000;

	return diffMs >= ONE_HOUR;
}

// Save notification
async function saveNotification(db, eventCode, username) {
	const now = getNowIST().toISOString();

	await db
		.prepare(
			`
      INSERT INTO notifications
      (event_code, notified_at, created_at, notify_channel, notify_username)
      VALUES (?, ?, ?, ?, ?)
    `,
		)
		.bind(eventCode, now, now, 'telegram', username)
		.run();
}

// Notify with DB control
async function notifyEvents(events, env) {
	let sentCount = 0;

	for (const event of events) {
		for (const user of TELEGRAM_USERS) {
			const shouldSend = await shouldSendNotification(env.DB, event.event_Code, user);

			if (!shouldSend) {
				console.log(`⏭️ Skipped (rate limit): ${event.event_Name} -> ${user}`);
				continue;
			}

			const message = buildMessage(event);

			console.log(`📤 Sending: ${event.event_Name} -> ${user}`);

			await sendTelegramMessage([user], message);

			await saveNotification(env.DB, event.event_Code, user);

			sentCount++;
		}
	}

	return sentCount;
}

// JSON response
function jsonResponse(data, status = 200) {
	return new Response(JSON.stringify(data, null, 2), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

// ---- Worker ----
export default {
	async fetch(request, env, ctx) {
		try {
			console.log('Date', getNowIST(), getNowIST().toISOString());
			const events = await fetchEvents();

			if (events.length === 0) {
				return jsonResponse({ status: 'no tickets' });
			}

			const validEvents = getValidEvents(events);
			const availableEvents = getAvailableEvents(events);

			let sentCount = 0;

			if (validEvents.length > 0) {
				sentCount = await notifyEvents(validEvents, env);
			}

			return jsonResponse({
				status: sentCount > 0 ? 'sent' : 'no tickets',
				sentCount,
				availableCount: availableEvents.length,
				availableTickets: availableEvents.map((event) => ({
					event_Code: event.event_Code,
					event_Name: event.event_Name,
					date: event.event_Display_Date,
					price: event.event_Price_Range,
					status: event.event_Button_Text,
				})),
			});
		} catch (err) {
			console.error(err);

			return jsonResponse({ error: err.message }, 500);
		}
	},
};
