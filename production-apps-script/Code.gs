/**
 * THE UNSAID — PRODUCTION GOOGLE APPS SCRIPT ADAPTER
 *
 * IMPORTANT:
 * - This is a SEPARATE production candidate. Do not paste it over the staging script.
 * - Do not deploy or connect it to the public website until production cutover is approved.
 * - Uses an existing, dedicated production Calendar ID; it does not create a calendar.
 * - Requires Script Properties:
 *     GOOGLE_APPS_SCRIPT_SECRET
 *     PRODUCTION_CALENDAR_ID
 *     ADMIN_NOTIFICATION_EMAIL
 * - Requires the Advanced Google Calendar service to be enabled.
 *
 * A paid booking is sent here by the trusted server only after server-side payment
 * verification. Emails go to the booking customer and the configured admin inbox.
 */

const TIME_ZONE = "Asia/Kolkata";
const CALENDAR_PROPERTY = "PRODUCTION_CALENDAR_ID";
const SECRET_PROPERTY = "GOOGLE_APPS_SCRIPT_SECRET";
const ADMIN_EMAIL_PROPERTY = "ADMIN_NOTIFICATION_EMAIL";
const SLOT_MINUTES = 20;
const BOOKING_RECORD_PREFIX = "UNSAID_PROD_BOOKING_";

function doGet() {
  return jsonOutput({
    ok: true,
    environment: "production-adapter",
    service: "The Unsaid production calendar"
  });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e && e.postData && e.postData.contents ? e.postData.contents : "{}");
  } catch (_) {
    return jsonOutput({ ok: false, error: "Invalid JSON." });
  }

  const properties = PropertiesService.getScriptProperties();
  const configuredSecret = properties.getProperty(SECRET_PROPERTY);
  if (!configuredSecret || !constantTimeEqual(String(body.secret || ""), configuredSecret)) {
    return jsonOutput({ ok: false, error: "Unauthorized." });
  }

  try {
    if (body.action === "getBusySlots") {
      return jsonOutput({ ok: true, blockedSlots: getBusySlots(body) });
    }
    return jsonOutput(createProductionMeetEvent(body));
  } catch (error) {
    console.error("Production calendar request failed:", error && error.message ? error.message : "Unknown error");
    return jsonOutput({ ok: false, error: "Calendar booking request failed." });
  }
}

function authorizeProductionEmail() {
  const properties = PropertiesService.getScriptProperties();
  const adminEmail = String(properties.getProperty(ADMIN_EMAIL_PROPERTY) || "").trim();
  const calendarId = String(properties.getProperty(CALENDAR_PROPERTY) || "").trim();

  if (!isValidEmail(adminEmail)) {
    throw new Error("Set ADMIN_NOTIFICATION_EMAIL to the inbox that should receive booking notifications.");
  }
  if (!calendarId || !CalendarApp.getCalendarById(calendarId)) {
    throw new Error("Set PRODUCTION_CALENDAR_ID to the existing production booking calendar.");
  }
  if (!properties.getProperty(SECRET_PROPERTY)) {
    throw new Error("Set GOOGLE_APPS_SCRIPT_SECRET before deploying the web app.");
  }

  const quota = MailApp.getRemainingDailyQuota();
  Logger.log("Production adapter configuration is ready. Remaining recipient quota: " + quota);
  return { ok: true, remainingRecipientQuota: quota };
}

/**
 * Safe template check: sends BOTH sample templates only to ADMIN_NOTIFICATION_EMAIL.
 * It does not create a Calendar event, charge a customer, or email the sample customer.
 */
function testProductionEmailTemplates() {
  const properties = PropertiesService.getScriptProperties();
  const adminEmail = String(properties.getProperty(ADMIN_EMAIL_PROPERTY) || "").trim();
  if (!isValidEmail(adminEmail)) {
    throw new Error("Set a valid ADMIN_NOTIFICATION_EMAIL first.");
  }

  const sample = {
    bookingId: "PRODUCTION-SETUP-TEST-" + Utilities.getUuid().slice(0, 8),
    sessionName: "Focused Conversation — 20 min",
    date: Utilities.formatDate(new Date(), TIME_ZONE, "yyyy-MM-dd"),
    time: "11:00",
    duration: 20,
    customerName: "Sample Customer (test only)",
    customerEmail: "sample-customer@example.com",
    customerWhatsapp: "Not applicable — setup test",
    amount: 499,
    meetLink: "https://meet.google.com/"
  };

  const customerTemplate = buildCustomerEmail(sample);
  const adminTemplate = buildAdminEmail(sample);

  MailApp.sendEmail({
    to: adminEmail,
    subject: "[PRODUCTION SETUP TEST] Customer confirmation template",
    body: "This is a setup test delivered only to the admin inbox. No customer was emailed.\n\n" + customerTemplate.body,
    htmlBody: '<p style="font:12px Arial;color:#68736b">SETUP TEST — delivered only to the admin inbox. No customer was emailed.</p>' + customerTemplate.html,
    name: "The Unsaid — Setup Test"
  });

  MailApp.sendEmail({
    to: adminEmail,
    subject: "[PRODUCTION SETUP TEST] Admin notification template",
    body: "This is a setup test delivered only to the admin inbox.\n\n" + adminTemplate.body,
    htmlBody: '<p style="font:12px Arial;color:#68736b">SETUP TEST — delivered only to the admin inbox.</p>' + adminTemplate.html,
    name: "The Unsaid — Setup Test"
  });

  Logger.log("Both production email templates were sent to the admin inbox only.");
  return { ok: true, customerTemplateSentToAdminInbox: true, adminTemplateSentToAdminInbox: true };
}

function getProductionCalendar() {
  const id = String(PropertiesService.getScriptProperties().getProperty(CALENDAR_PROPERTY) || "").trim();
  if (!id) throw new Error("Set PRODUCTION_CALENDAR_ID to the existing production calendar.");
  const calendar = CalendarApp.getCalendarById(id);
  if (!calendar) throw new Error("Production calendar is missing or inaccessible.");
  return calendar;
}

function getBusySlots(body) {
  const date = String(body.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date.");

  const workStart = Number(body.workStart);
  const workEnd = Number(body.workEnd);
  // Older Vercel callers omit the interval. Keep them on their old 30-minute grid
  // until that backend is updated; new callers explicitly send 20 after cutover.
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

  const events = getProductionCalendar().getEvents(dayStart, dayEnd);
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

function createProductionMeetEvent(body) {
  const bookingId = String(body.bookingId || "").slice(0, 120);
  const sessionName = String(body.sessionName || "The Unsaid session").slice(0, 150);
  const date = String(body.startDate || "");
  const time = String(body.startTime || "");
  const duration = Number(body.durationMinutes);
  const customerName = String(body.customerName || "").trim().slice(0, 200);
  const customerEmail = String(body.customerEmail || "").trim().toLowerCase().slice(0, 320);
  const customerWhatsapp = String(body.customerWhatsapp || "").trim().slice(0, 60);
  const amount = Number(body.amount || 0);
  const adminEmail = String(PropertiesService.getScriptProperties().getProperty(ADMIN_EMAIL_PROPERTY) || "").trim();

  if (!/^[A-Za-z0-9_-]{1,120}$/.test(bookingId) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ||
      !Number.isInteger(duration) || duration < 1 || duration > 180 ||
      !customerName || !isValidEmail(customerEmail) ||
      !Number.isFinite(amount) || amount <= 0 ||
      !isValidEmail(adminEmail)) {
    throw new Error("Invalid booking details or missing admin email configuration.");
  }

  const calendarId = String(PropertiesService.getScriptProperties().getProperty(CALENDAR_PROPERTY) || "").trim();
  if (!calendarId || !CalendarApp.getCalendarById(calendarId)) {
    throw new Error("Production calendar is not configured or accessible.");
  }

  const start = new Date(date + "T" + time + ":00+05:30");
  const end = new Date(start.getTime() + duration * 60 * 1000);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    throw new Error("Invalid booking date or time.");
  }

  // A script lock and a per-booking record prevent normal webhook/status-poll
  // retries from creating multiple Calendar events or repeatedly sending emails.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error("Booking confirmation is busy; retry shortly.");

  try {
    const properties = PropertiesService.getScriptProperties();
    const recordKey = BOOKING_RECORD_PREFIX + bookingId;
    let record = {};
    const stored = properties.getProperty(recordKey);
    if (stored) {
      try { record = JSON.parse(stored) || {}; } catch (_) { record = {}; }
    }

    let created = null;
    if (record.eventId) {
      created = Calendar.Events.get(calendarId, record.eventId);
    } else {
      // Recover an event if the prior request created it but stopped before
      // saving its ID in Script Properties.
      const existing = Calendar.Events.list(calendarId, {
        privateExtendedProperty: "theunsaidBookingId=" + bookingId,
        maxResults: 1,
        showDeleted: false
      });
      if (existing.items && existing.items.length) {
        created = existing.items[0];
      } else {
        created = Calendar.Events.insert({
          summary: sessionName,
          description: "The Unsaid booking reference: " + bookingId,
          start: { dateTime: start.toISOString(), timeZone: TIME_ZONE },
          end: { dateTime: end.toISOString(), timeZone: TIME_ZONE },
          extendedProperties: {
            private: { theunsaidBookingId: bookingId }
          },
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
      }
    }

    const meetLink = created.hangoutLink ||
      (created.conferenceData && created.conferenceData.entryPoints
        ? (created.conferenceData.entryPoints.find((entry) => entry.entryPointType === "video") || {}).uri
        : null);

    if (!created.id || !meetLink) {
      throw new Error("Google Meet link was not created. Retry confirmation later.");
    }

    record = Object.assign({}, record, {
      bookingId: bookingId,
      eventId: created.id,
      meetLink: meetLink,
      customerEmailSent: Boolean(record.customerEmailSent),
      adminEmailSent: Boolean(record.adminEmailSent)
    });
    properties.setProperty(recordKey, JSON.stringify(record));

    const emailDetails = {
      bookingId: bookingId,
      sessionName: sessionName,
      date: date,
      time: time,
      duration: duration,
      customerName: customerName,
      customerEmail: customerEmail,
      customerWhatsapp: customerWhatsapp || "Not provided",
      amount: amount,
      meetLink: meetLink
    };

    const errors = [];
    if (!record.customerEmailSent) {
      try {
        const email = buildCustomerEmail(emailDetails);
        MailApp.sendEmail({
          to: customerEmail,
          subject: email.subject,
          body: email.body,
          htmlBody: email.html,
          name: "The Unsaid",
          replyTo: adminEmail
        });
        record.customerEmailSent = true;
        properties.setProperty(recordKey, JSON.stringify(record));
      } catch (error) {
        errors.push("Customer confirmation email could not be sent.");
        console.error("Customer confirmation email failed for booking " + bookingId + ": " +
          (error && error.message ? error.message : "Unknown error"));
      }
    }

    if (!record.adminEmailSent) {
      try {
        const email = buildAdminEmail(emailDetails);
        MailApp.sendEmail({
          to: adminEmail,
          subject: email.subject,
          body: email.body,
          htmlBody: email.html,
          name: "The Unsaid",
          replyTo: customerEmail
        });
        record.adminEmailSent = true;
        properties.setProperty(recordKey, JSON.stringify(record));
      } catch (error) {
        errors.push("Admin booking notification could not be sent.");
        console.error("Admin booking notification failed for booking " + bookingId + ": " +
          (error && error.message ? error.message : "Unknown error"));
      }
    }

    const emailError = errors.length ? errors.join(" ") : null;
    // The Calendar/Meet appointment exists at this point. Keep the booking
    // response successful even if a notification provider temporarily fails;
    // otherwise the booking API might retry availability checks and mistake
    // this newly created event for a slot conflict. Email delivery status is
    // returned separately for monitoring.
    return {
      ok: true,
      eventId: created.id,
      meetLink: meetLink,
      customerEmailSent: Boolean(record.customerEmailSent),
      adminEmailSent: Boolean(record.adminEmailSent),
      emailError: emailError
    };
  } finally {
    lock.releaseLock();
  }
}

function buildCustomerEmail(booking) {
  const safe = escapedBooking(booking);
  const dateTime = booking.date + " at " + booking.time + " (Asia/Kolkata)";
  const amountText = "₹" + Number(booking.amount).toLocaleString("en-IN");
  const body =
    "The Unsaid — Your booking is confirmed\n\n" +
    "Hi " + booking.customerName + ",\n\n" +
    "Thank you for booking a session with The Unsaid. Your booking is confirmed.\n\n" +
    "Session: " + booking.sessionName + "\n" +
    "Date and time: " + dateTime + "\n" +
    "Duration: " + booking.duration + " minutes\n" +
    "Amount paid: " + amountText + "\n" +
    "Booking reference: " + booking.bookingId + "\n" +
    "Google Meet: " + booking.meetLink + "\n\n" +
    "Please keep this email for your reference. If you need help, reply to this email.\n\n" +
    "The Unsaid\nFor everything you never knew how to say.";
  const html =
    '<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#27312b;line-height:1.65">' +
    '<p style="font-size:11px;letter-spacing:2px;color:#68736b">THE UNSAID</p>' +
    '<h2 style="font-weight:600">Your booking is confirmed</h2>' +
    '<p>Hi ' + safe.customerName + ',</p>' +
    '<p>Thank you for booking a session with The Unsaid. Your booking is confirmed.</p>' +
    '<table style="border-collapse:collapse;width:100%">' +
    '<tr><td style="padding:9px;border-bottom:1px solid #ddd6ca">Session</td><td style="padding:9px;border-bottom:1px solid #ddd6ca">' + safe.sessionName + '</td></tr>' +
    '<tr><td style="padding:9px;border-bottom:1px solid #ddd6ca">Date and time</td><td style="padding:9px;border-bottom:1px solid #ddd6ca">' + safe.dateTime + '</td></tr>' +
    '<tr><td style="padding:9px;border-bottom:1px solid #ddd6ca">Duration</td><td style="padding:9px;border-bottom:1px solid #ddd6ca">' + booking.duration + ' minutes</td></tr>' +
    '<tr><td style="padding:9px;border-bottom:1px solid #ddd6ca">Amount paid</td><td style="padding:9px;border-bottom:1px solid #ddd6ca">' + safe.amountText + '</td></tr>' +
    '<tr><td style="padding:9px;border-bottom:1px solid #ddd6ca">Booking reference</td><td style="padding:9px;border-bottom:1px solid #ddd6ca">' + safe.bookingId + '</td></tr>' +
    '</table>' +
    '<p style="margin:24px 0"><a href="' + safe.meetLink + '" style="display:inline-block;padding:12px 18px;background:#27312b;color:#fff;text-decoration:none;border-radius:24px">Join your session on Google Meet</a></p>' +
    '<p>Please keep this email for your reference. For help, reply to this email.</p>' +
    '<p style="color:#68736b">The Unsaid<br>For everything you never knew how to say.</p></div>';
  return { subject: "Your booking is confirmed | The Unsaid", body: body, html: html };
}

function buildAdminEmail(booking) {
  const safe = escapedBooking(booking);
  const dateTime = booking.date + " at " + booking.time + " (Asia/Kolkata)";
  const amountText = "₹" + Number(booking.amount).toLocaleString("en-IN");
  const body =
    "The Unsaid — New paid booking\n\n" +
    "Booking reference: " + booking.bookingId + "\n" +
    "Session: " + booking.sessionName + "\n" +
    "Date and time: " + dateTime + "\n" +
    "Duration: " + booking.duration + " minutes\n" +
    "Amount: " + amountText + "\n" +
    "Customer name: " + booking.customerName + "\n" +
    "Customer email: " + booking.customerEmail + "\n" +
    "Customer WhatsApp: " + (booking.customerWhatsapp || "Not provided") + "\n" +
    "Google Meet: " + booking.meetLink + "\n\n" +
    "The payment has been verified by the booking server.";
  const html =
    '<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#27312b;line-height:1.65">' +
    '<p style="font-size:11px;letter-spacing:2px;color:#68736b">THE UNSAID · ADMIN NOTIFICATION</p>' +
    '<h2 style="font-weight:600">New paid booking</h2>' +
    '<table style="border-collapse:collapse;width:100%">' +
    '<tr><td style="padding:9px;border-bottom:1px solid #ddd6ca">Booking reference</td><td style="padding:9px;border-bottom:1px solid #ddd6ca">' + safe.bookingId + '</td></tr>' +
    '<tr><td style="padding:9px;border-bottom:1px solid #ddd6ca">Session</td><td style="padding:9px;border-bottom:1px solid #ddd6ca">' + safe.sessionName + '</td></tr>' +
    '<tr><td style="padding:9px;border-bottom:1px solid #ddd6ca">Date and time</td><td style="padding:9px;border-bottom:1px solid #ddd6ca">' + safe.dateTime + '</td></tr>' +
    '<tr><td style="padding:9px;border-bottom:1px solid #ddd6ca">Duration</td><td style="padding:9px;border-bottom:1px solid #ddd6ca">' + booking.duration + ' minutes</td></tr>' +
    '<tr><td style="padding:9px;border-bottom:1px solid #ddd6ca">Amount</td><td style="padding:9px;border-bottom:1px solid #ddd6ca">' + safe.amountText + '</td></tr>' +
    '<tr><td style="padding:9px;border-bottom:1px solid #ddd6ca">Customer name</td><td style="padding:9px;border-bottom:1px solid #ddd6ca">' + safe.customerName + '</td></tr>' +
    '<tr><td style="padding:9px;border-bottom:1px solid #ddd6ca">Customer email</td><td style="padding:9px;border-bottom:1px solid #ddd6ca">' + safe.customerEmail + '</td></tr>' +
    '<tr><td style="padding:9px;border-bottom:1px solid #ddd6ca">Customer WhatsApp</td><td style="padding:9px;border-bottom:1px solid #ddd6ca">' + safe.customerWhatsapp + '</td></tr>' +
    '</table>' +
    '<p style="margin:24px 0"><a href="' + safe.meetLink + '" style="display:inline-block;padding:12px 18px;background:#27312b;color:#fff;text-decoration:none;border-radius:24px">Open Google Meet</a></p>' +
    '<p>Payment verified by the booking server.</p></div>';
  return { subject: "New paid booking | The Unsaid", body: body, html: html };
}

function escapedBooking(booking) {
  const dateTime = booking.date + " at " + booking.time + " (Asia/Kolkata)";
  const amountText = "₹" + Number(booking.amount).toLocaleString("en-IN");
  return {
    bookingId: htmlEscape(booking.bookingId),
    sessionName: htmlEscape(booking.sessionName),
    dateTime: htmlEscape(dateTime),
    customerName: htmlEscape(booking.customerName),
    customerEmail: htmlEscape(booking.customerEmail),
    customerWhatsapp: htmlEscape(booking.customerWhatsapp || "Not provided"),
    amountText: htmlEscape(amountText),
    meetLink: htmlEscape(booking.meetLink)
  };
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

function constantTimeEqual(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function jsonOutput(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
