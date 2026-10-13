const TIME_ZONE = "Asia/Kolkata";
const CALENDAR_PROPERTY = "TEST_CALENDAR_ID";
const SECRET_PROPERTY = "GOOGLE_APPS_SCRIPT_SECRET";
const SLOT_MINUTES = 30;

function doGet() {
  return jsonOutput({ ok: true, environment: "staging", service: "The Unsaid test calendar" });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e && e.postData && e.postData.contents ? e.postData.contents : "{}");
  } catch (_) {
    return jsonOutput({ ok: false, error: "Invalid JSON." });
  }

  const configuredSecret = PropertiesService.getScriptProperties().getProperty(SECRET_PROPERTY);
  if (!configuredSecret || body.secret !== configuredSecret) {
    return jsonOutput({ ok: false, error: "Unauthorized." });
  }

  try {
    if (body.action === "getBusySlots") {
      return jsonOutput({ ok: true, blockedSlots: getBusySlots(body) });
    }
    return jsonOutput(createStagingMeetEvent(body));
  } catch (error) {
    console.error("Staging calendar error:", error && error.message ? error.message : "Unknown error");
    return jsonOutput({ ok: false, error: "Staging calendar request failed." });
  }
}

function setupStagingCalendar() {
  const properties = PropertiesService.getScriptProperties();
  const existingId = properties.getProperty(CALENDAR_PROPERTY);
  const existing = existingId ? CalendarApp.getCalendarById(existingId) : null;
  if (existing) {
    return { ok: true, created: false, calendarName: existing.getName(), calendarId: existing.getId() };
  }

  const calendar = CalendarApp.createCalendar("The Unsaid Staging Test Calendar", {
    summary: "Isolated calendar for The Unsaid Cloudflare Preview testing. No customer appointments.",
    timeZone: TIME_ZONE
  });
  properties.setProperty(CALENDAR_PROPERTY, calendar.getId());
  return { ok: true, created: true, calendarName: calendar.getName(), calendarId: calendar.getId() };
}

function getStagingCalendar() {
  const id = PropertiesService.getScriptProperties().getProperty(CALENDAR_PROPERTY);
  if (!id) throw new Error("Run setupStagingCalendar() once before use.");
  const calendar = CalendarApp.getCalendarById(id);
  if (!calendar) throw new Error("Staging test calendar is missing or inaccessible.");
  return calendar;
}

function getBusySlots(body) {
  const date = String(body.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date.");
  const workStart = Number(body.workStart);
  const workEnd = Number(body.workEnd);
  if (!Number.isInteger(workStart) || !Number.isInteger(workEnd) ||
      workStart < 0 || workEnd > 24 || workEnd <= workStart) {
    throw new Error("Invalid working hours.");
  }

  const dayStart = new Date(date + "T" + pad2(workStart) + ":00:00+05:30");
  const dayEnd = new Date(date + "T" + pad2(workEnd) + ":00:00+05:30");
  if (!Number.isFinite(dayStart.getTime()) || !Number.isFinite(dayEnd.getTime())) {
    throw new Error("Invalid date.");
  }

  const events = getStagingCalendar().getEvents(dayStart, dayEnd);
  const blocked = new Set();
  const dayEpoch = new Date(date + "T00:00:00+05:30").getTime();

  for (const event of events) {
    const eventStart = event.getStartTime().getTime();
    const eventEnd = event.getEndTime().getTime();
    for (let minutes = workStart * 60; minutes < workEnd * 60; minutes += SLOT_MINUTES) {
      const slotStart = dayEpoch + minutes * 60 * 1000;
      const slotEnd = slotStart + SLOT_MINUTES * 60 * 1000;
      if (eventStart < slotEnd && eventEnd > slotStart) {
        blocked.add(pad2(Math.floor(minutes / 60)) + ":" + pad2(minutes % 60));
      }
    }
  }
  return Array.from(blocked).sort();
}

function createStagingMeetEvent(body) {
  const bookingId = String(body.bookingId || "").slice(0, 120);
  const sessionName = String(body.sessionName || "Staging test session").slice(0, 150);
  const date = String(body.startDate || "");
  const time = String(body.startTime || "");
  const duration = Number(body.durationMinutes);
  if (!bookingId || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ||
      !Number.isInteger(duration) || duration < 1 || duration > 180) {
    throw new Error("Invalid staging booking details.");
  }

  const calendarId = PropertiesService.getScriptProperties().getProperty(CALENDAR_PROPERTY);
  if (!calendarId) throw new Error("Run setupStagingCalendar() once before use.");

  const start = new Date(date + "T" + time + ":00+05:30");
  const end = new Date(start.getTime() + duration * 60 * 1000);
  const created = Calendar.Events.insert({
    summary: "[STAGING TEST] " + sessionName,
    description: "The Unsaid Cloudflare Preview test event. No customer emails are sent.\nTest booking reference: " + bookingId,
    start: { dateTime: start.toISOString(), timeZone: TIME_ZONE },
    end: { dateTime: end.toISOString(), timeZone: TIME_ZONE },
    conferenceData: {
      createRequest: {
        requestId: Utilities.getUuid(),
        conferenceSolutionKey: { type: "hangoutsMeet" }
      }
    }
  }, calendarId, {
    conferenceDataVersion: 1,
    sendUpdates: "none"
  });

  const meetLink = created.hangoutLink ||
    (created.conferenceData && created.conferenceData.entryPoints
      ? (created.conferenceData.entryPoints.find((entry) => entry.entryPointType === "video") || {}).uri
      : null);

  if (!meetLink) {
    try { Calendar.Events.remove(calendarId, created.id); } catch (_) {}
    throw new Error("Google Meet link was not created for the staging test event.");
  }

  return {
    ok: true,
    eventId: created.id,
    meetLink: meetLink,
    customerEmailSent: false,
    adminEmailSent: false,
    emailError: null
  };
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function jsonOutput(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
