const API_URL = 'https://rcbscaleapi.ticketgenie.in/ticket/eventlist/0';

// ---- Config ----
const TELEGRAM_USERS = ['gultoo24'];

// 👉 Add event codes here after first alert to avoid duplicates
const SKIP_EVENT_CODES = [1];

// ---- Helpers ----

// Fetch events from API
async function fetchEvents() {
	const res = await fetch(API_URL);
	const data = await res.json();
	return data.result || [];
}

// Filter valid events
function getValidEvents(events) {
	const now = new Date();

	return events.filter((event) => {
		const eventDate = new Date(event.event_Date);

		return (
			eventDate >= now && // future events
			event.event_Button_Text !== 'SOLD OUT' && // not sold out
			!SKIP_EVENT_CODES.includes(event.event_Code) // skip handled events
		);
	});
}

// Build message
function buildMessage(event) {
	return `🎟️ Tickets on Sale!\n` + `${event.event_Name}\n` + `${event.event_Display_Date}\n` + `${event.event_Price_Range}`;
}

// Send message via CallMeBot
async function sendTelegramMessage(users, message) {
	const userString = users.join('|');

	const url = `https://api.callmebot.com/text.php?user=${userString}` + `&text=${encodeURIComponent(message)}`;

	return fetch(url);
}

// Notify all events
async function notifyEvents(events) {
	for (const event of events) {
		const message = buildMessage(event);

		console.log('Sending alert for:', event.event_Name);
		console.log('👉 Add this to SKIP_EVENT_CODES:', event.event_Code);

		await sendTelegramMessage(TELEGRAM_USERS, message);
	}
}

// JSON response helper
function jsonResponse(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

// ---- Worker ----
export default {
	async fetch(request, env, ctx) {
		try {
			const events = await fetchEvents();

			const validEvents = getValidEvents(events);

			console.log('Valid events:', validEvents.length);

			if (validEvents.length > 0) {
				await notifyEvents(validEvents);

				return jsonResponse({
					status: 'sent',
					count: validEvents.length,
					skipped: SKIP_EVENT_CODES,
				});
			}

			return jsonResponse({
				status: 'no tickets',
				skipped: SKIP_EVENT_CODES,
			});
		} catch (err) {
			console.error(err);

			return jsonResponse({ error: err.message }, 500);
		}
	},
};
