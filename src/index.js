const API_URL = 'https://rcbscaleapi.ticketgenie.in/ticket/eventlist/O';

// --------------------------------------------------
// Config
// --------------------------------------------------

// One-time Telegram users
const TELEGRAM_USERS_LIMIT = [];

// Premium Telegram users → cooldown based
const TELEGRAM_USERS_PREMIUM = ['gultoo24', 'Pp1234099','janjankumar'];

const TELEGRAM_COOLDOWN_HOURS = 4; // premium only

// SMS once only
const PHONE_NUMBERS_ONCE = ['+918892218173', '+918892218179', '+919353867710', '+919741870488', '+918548864253'];

// Premium SMS → cooldown based
const PHONE_NUMBERS_PREMIUM = [];

const SMS_COOLDOWN_HOURS = 4; // premium only

const SMS_API_URL = 'https://api.sms-gate.app/3rdparty/v1/messages';
const SMS_USERNAME = '_0_O_M';
const SMS_PASSWORD = 'byqyudvbhbrn5g';

// --------------------------------------------------
// Time Helper (IST)
// --------------------------------------------------

function getNowIST() {
	return new Date(
		new Date().toLocaleString('en-US', {
			timeZone: 'Asia/Kolkata',
		}),
	);
}

// --------------------------------------------------
// Fetch Events
// --------------------------------------------------

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

		if (res.ok) {
			const data = await res.json();
			return {
				events: data.result || [],
				finalStatus: res.status,
			};
		}
		// ❌ Primary failed → try proxy
		const proxyUrl = PROXY_BASE + encodeURIComponent(API_URL);

		const proxyRes = await fetch(proxyUrl, {
			headers: {
				...headers,
				'x-api-key': PROXY_API_KEY,
			},
		});

		if (!proxyRes.ok) {
			return {
				events: [],
				finalStatus: proxyRes.status,
			};
		}

		const data = await proxyRes.json();

		return {
			events: data.result || [],
			finalStatus: proxyRes.status,
		};
	} catch (err) {
		console.error('Fetch failed:', err.message);

		return {
			events: [],
			finalStatus: 500,
			error: err.message,
		};
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

// --------------------------------------------------
// Message Builder
// --------------------------------------------------

function buildMessage(event) {
	return `🎟️ Tickets on Sale!\n` + `${event.event_Name}\n` + `${event.event_Display_Date}\n` + `${event.event_Price_Range}`;
}

// --------------------------------------------------
// Telegram
// --------------------------------------------------

async function sendTelegramMessage(users, message) {
	const userString = users.join('|');

	const url = `https://api.callmebot.com/text.php?user=${userString}` + `&text=${encodeURIComponent(message)}`;

	return fetch(url);
}

// --------------------------------------------------
// SMS
// --------------------------------------------------

async function sendSMS(phoneNumbers, message) {
	const payload = {
		textMessage: {
			text: message,
		},
		phoneNumbers,
	};

	const auth = btoa(`${SMS_USERNAME}:${SMS_PASSWORD}`);

	const res = await fetch(SMS_API_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Basic ${auth}`,
		},
		body: JSON.stringify(payload),
	});

	const responseText = await res.text();
	console.log('SMS Response:', responseText);

	return res;
}

// --------------------------------------------------
// D1 Logic
// --------------------------------------------------

async function getLastNotification(db, eventCode, username) {
	return db
		.prepare(
			`
			SELECT notified_at
			FROM notifications
			WHERE event_code = ?
			AND notify_username = ?
			ORDER BY notified_at DESC
			LIMIT 1
		`,
		)
		.bind(eventCode, username)
		.first();
}

// One-time only
async function shouldSendOnce(db, eventCode, username) {
	const result = await getLastNotification(db, eventCode, username);

	return !result;
}

// Fixed cooldown (premium)
async function shouldSendCooldown(db, eventCode, username, hours) {
	const result = await getLastNotification(db, eventCode, username);

	if (!result) return true;

	const lastSent = new Date(result.notified_at);
	const now = getNowIST();

	const diffMs = now - lastSent;
	const diffMinutes = diffMs / (60 * 1000);

	let requiredMinutes = hours * 60;

	// Premium early morning protection (2 AM → 9 AM)
	const hour = now.getHours();

	if (hour >= 2 && hour <= 9) {
		const extraHours = hour + 2;

		requiredMinutes = extraHours * 60;
		requiredMinutes += now.getMinutes();
	}

	console.log(`⏱ Cooldown → ${username} | Required: ${requiredMinutes} mins | Actual: ${Math.floor(diffMinutes)} mins`);

	return diffMinutes >= requiredMinutes;
}

async function saveNotification(db, eventCode, username, channel) {
	const now = getNowIST().toISOString();

	await db
		.prepare(
			`
			INSERT INTO notifications
			(
				event_code,
				notified_at,
				created_at,
				notify_channel,
				notify_username
			)
			VALUES (?, ?, ?, ?, ?)
		`,
		)
		.bind(eventCode, now, now, channel, username)
		.run();
}

// --------------------------------------------------
// Notify Events
// --------------------------------------------------

async function notifyEvents(events, env) {
	let sentCount = 0;

	for (const event of events) {
		const message = buildMessage(event);

		// --------------------------------
		// Telegram Once Only
		// --------------------------------

		for (const user of TELEGRAM_USERS_LIMIT) {
			const shouldSend = await shouldSendOnce(env.DB, event.event_Code, user);

			if (!shouldSend) continue;

			console.log(`📤 Telegram Once → ${event.event_Name} -> ${user}`);

			await sendTelegramMessage([user], message);

			await saveNotification(env.DB, event.event_Code, user, 'telegram');

			sentCount++;
		}

		// --------------------------------
		// Telegram Premium
		// --------------------------------

		for (const user of TELEGRAM_USERS_PREMIUM) {
			const shouldSend = await shouldSendCooldown(env.DB, event.event_Code, user, TELEGRAM_COOLDOWN_HOURS);

			if (!shouldSend) continue;

			console.log(`📤 Telegram Premium → ${event.event_Name} -> ${user}`);

			await sendTelegramMessage([user], message);

			await saveNotification(env.DB, event.event_Code, user, 'telegram');

			sentCount++;
		}

		// --------------------------------
		// SMS Once Only
		// --------------------------------

		if (PHONE_NUMBERS_ONCE.length > 0) {
			const shouldSend = await shouldSendOnce(env.DB, event.event_Code, 'sms_once');

			if (shouldSend) {
				console.log(`📩 SMS Once → ${event.event_Name}`);

				await sendSMS(PHONE_NUMBERS_ONCE, message);

				await saveNotification(env.DB, event.event_Code, 'sms_once', 'sms');

				sentCount++;
			}
		}

		// --------------------------------
		// SMS Premium
		// --------------------------------

		if (PHONE_NUMBERS_PREMIUM.length > 0) {
			const shouldSend = await shouldSendCooldown(env.DB, event.event_Code, 'sms_premium', SMS_COOLDOWN_HOURS);

			if (shouldSend) {
				console.log(`📩 SMS Premium → ${event.event_Name}`);

				await sendSMS(PHONE_NUMBERS_PREMIUM, message);

				await saveNotification(env.DB, event.event_Code, 'sms_premium', 'sms');

				sentCount++;
			}
		}
	}

	return sentCount;
}

// --------------------------------------------------
// Response Helper
// --------------------------------------------------

function jsonResponse(data, status = 200) {
	return new Response(JSON.stringify(data, null, 2), {
		status,
		headers: {
			'Content-Type': 'application/json',
		},
	});
}

// --------------------------------------------------
// Worker
// --------------------------------------------------

export default {
	async fetch(request, env, ctx) {
		try {
			const { events, finalStatus } = await fetchEvents();

			if (finalStatus !== 200) {
				return jsonResponse(
					{
						error: 'Fetch failed',
						finalStatus,
					},
					500,
				);
			}

			if (events.length === 0) {
				return jsonResponse({
					status: 'no tickets',
				});
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

			return jsonResponse(
				{
					error: err.message,
				},
				500,
			);
		}
	},
};
