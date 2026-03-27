const API_URL = 'https://rcbscaleapi.ticketgenie.in/ticket/eventlist/0';

// ---- Config ----
const TELEGRAM_USERS = ['gultoo24'];

const SKIP_EVENT_CODES = [1];

// ---- Helpers ----

// Fetch events from API
async function fetchEvents() {
	const res = await fetch(API_URL);
	const data = await res.json();
	return data.result || [];
}

// Filter valid events (used for alerts)
function getValidEvents(events) {
	const now = new Date();

	return events.filter((event) => {
		const eventDate = new Date(event.event_Date);

		return eventDate >= now && event.event_Button_Text !== 'SOLD OUT' && !SKIP_EVENT_CODES.includes(event.event_Code);
	});
}

// 🆕 Get all available tickets (NO skip logic)
function getAvailableEvents(events) {
	const now = new Date();

	return events.filter((event) => {
		const eventDate = new Date(event.event_Date);

		return eventDate >= now && event.event_Button_Text !== 'SOLD OUT';
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
	return new Response(JSON.stringify(data, null, 2), {
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
			const availableEvents = getAvailableEvents(events); // 🆕

			console.log('Valid events (alerts):', validEvents.length);
			console.log('Available events (all):', availableEvents.length);

			// Send alerts
			if (validEvents.length > 0) {
				await notifyEvents(validEvents);
			}

			return jsonResponse({
				status: validEvents.length > 0 ? 'sent' : 'no tickets',
				alertCount: validEvents.length,
				availableCount: availableEvents.length,
				skipped: SKIP_EVENT_CODES,

				// 🆕 New section
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
