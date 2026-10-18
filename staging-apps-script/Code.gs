const TIME_ZONE = "Asia/Kolkata";
const CALENDAR_PROPERTY = "TEST_CALENDAR_ID";
const SECRET_PROPERTY = "GOOGLE_APPS_SCRIPT_SECRET";
const SLOT_MINUTES = 20;

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
  // Older preview callers may omit the interval; new code sends it explicitly.
  const slotMinutes = Number(body.slotIntervalMinutes || 30);
  if (!Number.isInteger(slotMinutes) || slotMinutes < 1 || 60 % slotMinutes !== 0) {
    throw new Error("Invalid slot interval.");
  }
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
    for (let minutes = workStart * 60; minutes < workEnd * 60; minutes += slotMinutes) {
      const slotStart = dayEpoch + minutes * 60 * 1000;
      const slotEnd = slotStart + slotMinutes * 60 * 1000;
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
    description: "The Unsaid Cloudflare Preview test event. Emails, if enabled, are sent only to STAGING_TEST_EMAIL.\nTest booking reference: " + bookingId,
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

  // Staging email sends are hard-routed to one configured test inbox.
  // The booking customer's real email is shown only inside the test message;
  // it is never used as an email recipient by this staging script.
  const emailStatus = sendStagingEmails({
    bookingId,
    sessionName,
    date,
    time,
    duration,
    customerName: String(body.customerName || "Test customer").slice(0, 200),
    customerEmail: String(body.customerEmail || "").slice(0, 320),
    amount: Number(body.amount || 0),
    meetLink
  });

  return {
    ok: true,
    eventId: created.id,
    meetLink: meetLink,
    customerEmailSent: emailStatus.customerEmailSent,
    adminEmailSent: emailStatus.adminEmailSent,
    emailError: emailStatus.emailError
  };
}

function sendStagingEmails(booking) {
  const testRecipient = String(
    PropertiesService.getScriptProperties().getProperty("STAGING_TEST_EMAIL") || ""
  ).trim();

  if (!isValidEmail(testRecipient)) {
    return {
      customerEmailSent: false,
      adminEmailSent: false,
      emailError: "Add a valid STAGING_TEST_EMAIL script property to enable safe staging email tests."
    };
  }

  const safe = {
    bookingId: String(booking.bookingId || "").slice(0, 120),
    sessionName: String(booking.sessionName || "Staging test session").slice(0, 150),
    date: String(booking.date || ""),
    time: String(booking.time || ""),
    duration: Number(booking.duration || 0),
    customerName: String(booking.customerName || "Test customer").slice(0, 200),
    customerEmail: String(booking.customerEmail || "Not supplied").slice(0, 320),
    amount: Number(booking.amount || 0),
    meetLink: String(booking.meetLink || "")
  };

  const dateTime = safe.date + " at " + safe.time + " (Asia/Kolkata)";
  const amountText = safe.amount > 0 ? "₹" + safe.amount : "Test booking";
  const escaped = {
    bookingId: htmlEscape(safe.bookingId),
    sessionName: htmlEscape(safe.sessionName),
    dateTime: htmlEscape(dateTime),
    customerName: htmlEscape(safe.customerName),
    customerEmail: htmlEscape(safe.customerEmail),
    amountText: htmlEscape(amountText),
    meetLink: htmlEscape(safe.meetLink)
  };

  let customerEmailSent = false;
  let adminEmailSent = false;
  const errors = [];

  const customerSubject = "[STAGING TEST] Customer booking confirmation — " + safe.bookingId;
  const customerBody =
    "THE UNSAID — STAGING TEST EMAIL\n\n" +
    "This is a test copy of the customer confirmation email. It was sent only to the configured staging test inbox; no email was sent to the actual customer.\n\n" +
    "Hi " + safe.customerName + ",\n\n" +
    "Your test booking is confirmed.\n\n" +
    "Session: " + safe.sessionName + "\n" +
    "Date and time: " + dateTime + "\n" +
    "Duration: " + safe.duration + " minutes\n" +
    "Amount: " + amountText + "\n" +
    "Booking reference: " + safe.bookingId + "\n" +
    "Google Meet: " + safe.meetLink + "\n\n" +
    "This is a staging test. No real appointment/customer notification has been sent.";
  const customerHtml =
    '<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#27312b;line-height:1.6">' +
    '<p style="font-size:11px;letter-spacing:2px;color:#68736b">THE UNSAID · STAGING TEST</p>' +
    '<h2 style="font-weight:600">Your test booking is confirmed</h2>' +
    '<p>This is a test copy of the customer confirmation email. It was sent only to the configured staging test inbox; no email was sent to the actual customer.</p>' +
    '<p>Hi ' + escaped.customerName + ',</p>' +
    '<table style="border-collapse:collapse;width:100%">' +
    '<tr><td style="padding:8px;border-bottom:1px solid #ddd6ca">Session</td><td style="padding:8px;border-bottom:1px solid #ddd6ca">' + escaped.sessionName + '</td></tr>' +
    '<tr><td style="padding:8px;border-bottom:1px solid #ddd6ca">Date and time</td><td style="padding:8px;border-bottom:1px solid #ddd6ca">' + escaped.dateTime + '</td></tr>' +
    '<tr><td style="padding:8px;border-bottom:1px solid #ddd6ca">Duration</td><td style="padding:8px;border-bottom:1px solid #ddd6ca">' + safe.duration + ' minutes</td></tr>' +
    '<tr><td style="padding:8px;border-bottom:1px solid #ddd6ca">Amount</td><td style="padding:8px;border-bottom:1px solid #ddd6ca">' + escaped.amountText + '</td></tr>' +
    '<tr><td style="padding:8px;border-bottom:1px solid #ddd6ca">Booking reference</td><td style="padding:8px;border-bottom:1px solid #ddd6ca">' + escaped.bookingId + '</td></tr>' +
    '</table>' +
    '<p><a href="' + escaped.meetLink + '" style="display:inline-block;padding:12px 18px;background:#27312b;color:#fff;text-decoration:none;border-radius:24px">Open Google Meet</a></p>' +
    '<p style="font-size:12px;color:#68736b">Staging test only. No real customer notification has been sent.</p></div>';

  try {
    MailApp.sendEmail({ to: testRecipient, subject: customerSubject, body: customerBody, htmlBody: customerHtml, name: "The Unsaid — Staging Test" });
    customerEmailSent = true;
  } catch (error) {
    errors.push("Customer-template test email failed.");
    console.error("Staging customer email failed: " + (error && error.message ? error.message : "Unknown error"));
  }

  const adminSubject = "[STAGING TEST] New paid booking — " + safe.bookingId;
  const adminBody =
    "THE UNSAID — STAGING ADMIN TEST EMAIL\n\n" +
    "This is a test copy of the admin notification. It was sent only to the configured staging test inbox.\n\n" +
    "Booking reference: " + safe.bookingId + "\n" +
    "Session: " + safe.sessionName + "\n" +
    "Date and time: " + dateTime + "\n" +
    "Duration: " + safe.duration + " minutes\n" +
    "Amount: " + amountText + "\n" +
    "Test customer name: " + safe.customerName + "\n" +
    "Test customer email entered on form: " + safe.customerEmail + "\n" +
    "Google Meet: " + safe.meetLink + "\n\n" +
    "Staging test only — do not treat this as a real customer appointment.";
  const adminHtml =
    '<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#27312b;line-height:1.6">' +
    '<p style="font-size:11px;letter-spacing:2px;color:#68736b">THE UNSAID · STAGING TEST</p>' +
    '<h2 style="font-weight:600">New paid booking — test notification</h2>' +
    '<p>This is a test copy of the admin notification. It was sent only to the configured staging test inbox.</p>' +
    '<table style="border-collapse:collapse;width:100%">' +
    '<tr><td style="padding:8px;border-bottom:1px solid #ddd6ca">Booking reference</td><td style="padding:8px;border-bottom:1px solid #ddd6ca">' + escaped.bookingId + '</td></tr>' +
    '<tr><td style="padding:8px;border-bottom:1px solid #ddd6ca">Session</td><td style="padding:8px;border-bottom:1px solid #ddd6ca">' + escaped.sessionName + '</td></tr>' +
    '<tr><td style="padding:8px;border-bottom:1px solid #ddd6ca">Date and time</td><td style="padding:8px;border-bottom:1px solid #ddd6ca">' + escaped.dateTime + '</td></tr>' +
    '<tr><td style="padding:8px;border-bottom:1px solid #ddd6ca">Duration</td><td style="padding:8px;border-bottom:1px solid #ddd6ca">' + safe.duration + ' minutes</td></tr>' +
    '<tr><td style="padding:8px;border-bottom:1px solid #ddd6ca">Amount</td><td style="padding:8px;border-bottom:1px solid #ddd6ca">' + escaped.amountText + '</td></tr>' +
    '<tr><td style="padding:8px;border-bottom:1px solid #ddd6ca">Test customer name</td><td style="padding:8px;border-bottom:1px solid #ddd6ca">' + escaped.customerName + '</td></tr>' +
    '<tr><td style="padding:8px;border-bottom:1px solid #ddd6ca">Email entered on form</td><td style="padding:8px;border-bottom:1px solid #ddd6ca">' + escaped.customerEmail + '</td></tr>' +
    '</table>' +
    '<p><a href="' + escaped.meetLink + '" style="display:inline-block;padding:12px 18px;background:#27312b;color:#fff;text-decoration:none;border-radius:24px">Open Google Meet</a></p>' +
    '<p style="font-size:12px;color:#68736b">Staging test only — not a real customer appointment.</p></div>';

  try {
    MailApp.sendEmail({ to: testRecipient, subject: adminSubject, body: adminBody, htmlBody: adminHtml, name: "The Unsaid — Staging Test" });
    adminEmailSent = true;
  } catch (error) {
    errors.push("Admin-template test email failed.");
    console.error("Staging admin email failed: " + (error && error.message ? error.message : "Unknown error"));
  }

  return {
    customerEmailSent: customerEmailSent,
    adminEmailSent: adminEmailSent,
    emailError: errors.length ? errors.join(" ") : null
  };
}

function authorizeStagingEmail() {
  const testRecipient = String(
    PropertiesService.getScriptProperties().getProperty("STAGING_TEST_EMAIL") || ""
  ).trim();
  if (!isValidEmail(testRecipient)) {
    throw new Error("Add a valid STAGING_TEST_EMAIL script property before authorizing email.");
  }
  const quota = MailApp.getRemainingDailyQuota();
  Logger.log("Staging email permission is ready. Remaining recipient quota: " + quota);
  return { ok: true, testRecipient: testRecipient, remainingRecipientQuota: quota };
}

function testStagingEmailTemplates() {
  const now = new Date();
  const date = Utilities.formatDate(now, TIME_ZONE, "yyyy-MM-dd");
  const time = Utilities.formatDate(now, TIME_ZONE, "HH:mm");
  const result = sendStagingEmails({
    bookingId: "STAGING-EMAIL-TEST-" + Utilities.getUuid().slice(0, 8),
    sessionName: "Focused Conversation — 20 min (email template test)",
    date: date,
    time: time,
    duration: 20,
    customerName: "Test Customer",
    customerEmail: "test-customer@example.com",
    amount: 499,
    meetLink: "https://example.com/staging-email-test-only"
  });
  Logger.log(JSON.stringify(result));
  return result;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function htmlEscape(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[character];
  });
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function jsonOutput(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
