const crypto = require("crypto");
const { sql } = require("../lib/db");
const { SESSIONS, json, handleOptions, isValidEmail, isValidHHMM, isValidISODate, clean, toBlocks, validateSlot, canonicalSession, WORK_START, WORK_END, timeRangesOverlap } = require("../lib/config");
const { getBlockedSlotsFromCalendar } = require("../lib/calendar-busy");
const { createBookingAccessToken } = require("../lib/booking-access");
const { allowRequest } = require("../lib/rate-limit");
const { normalizeDatabaseDate } = require("../lib/date-utils");
const { cleanupExpiredRecords } = require("../lib/retention");

function isPreviewHost(req){
  let host=String(req.headers["x-forwarded-host"]||req.headers.host||"").split(",")[0].trim().toLowerCase();
  if(!host){
    try{host=new URL(req.url).hostname.toLowerCase()}catch(_){host=""}
  }
  host=host.replace(/:\d+$/,"");
  if(host.endsWith(".pages.dev")) return host!=="the-unsaid-bg2.pages.dev";
  if(host.endsWith(".vercel.app")){
    return !new Set([
      "the-unsaid-alpha.vercel.app",
      "the-unsaid-lologram24-9450.vercel.app",
      "the-unsaid-git-main-lologram24-9450.vercel.app"
    ]).has(host);
  }
  return false;
}

let consentSchemaPromise=null;
async function ensureConsentSchema(){
  if(!consentSchemaPromise){
    consentSchemaPromise=(async()=>{
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS consent_accepted BOOLEAN NOT NULL DEFAULT FALSE`;
      await sql`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ`;
    })().catch(err=>{consentSchemaPromise=null;throw err;});
  }
  return consentSchemaPromise;
}

module.exports = async (req,res) => {
  if(handleOptions(req,res)) return;
  if(req.method !== "POST") return json(res,405,{error:"Method not allowed."});
  try {
    const body=req.body || {};
    if(body.consentAccepted!==true)
      return json(res,400,{error:"Please confirm you are 18 or older and agree to the Privacy Policy, Terms and Cancellation and Refunds."});
    const rawSession=clean(body.session);
    const sessionName=canonicalSession(rawSession);
    const meta=sessionName ? SESSIONS[sessionName] : null;
    if(!meta) return json(res,400,{error:"Invalid session."});

    const customerName=clean(body.name,200);
    const email=clean(body.email,320).toLowerCase();
    const whatsapp=clean(body.whatsapp,50);
    const date=clean(body.date,10);
    const time=clean(body.time,5);
    const birthDate=clean(body.birthDate,10);
    const birthTime=clean(body.birthTime,5);
    const birthTimeUnknown=body.birthTimeUnknown===true;
    const birthPlace=clean(body.birthPlace,200);
    if(!customerName || !isValidEmail(email) || !whatsapp || !date || !time || !isValidISODate(date) || !isValidHHMM(time))
      return json(res,400,{error:"Please complete all required booking details with valid date and time."});
    if(!/^[+()\d\s-]{7,25}$/.test(whatsapp))
      return json(res,400,{error:"Please enter a valid WhatsApp/phone number."});

    if(meta.service==="astrology"){
      const validBirthTime=birthTimeUnknown ? !birthTime : isValidHHMM(birthTime);
      if(!birthDate || !isValidISODate(birthDate) || !validBirthTime || !birthPlace){
        return json(res,400,{error:"Please provide a valid birth date and birth place, and enter your birth time or select that you do not know it."});
      }
    }

    const slotError=validateSlot(date,time,meta.duration);
    if(slotError) return json(res,400,{error:slotError});

    if(!await allowRequest(req,"create-order",12,10*60*1000))
      return json(res,429,{error:"Too many booking attempts. Please wait a little and try again."});
    await cleanupExpiredRecords();

    const keyId=process.env.RAZORPAY_KEY_ID;
    const keySecret=process.env.RAZORPAY_KEY_SECRET;
    if(!keyId || !keySecret) return json(res,500,{error:"Payment system is not configured yet."});
    if(keyId.startsWith("rzp_live_") && isPreviewHost(req)){
      return json(res,503,{error:"Live payments are disabled on preview deployments. No checkout was started. Use the production site for real customers or configure Razorpay Test Mode for preview testing."});
    }

    // Recheck the provider's Google Calendar immediately before creating the
    // payment order. This prevents an emergency/unavailable calendar event
    // added after the availability screen was loaded from becoming bookable.
    try{
      const remote=await getBlockedSlotsFromCalendar({
        date,
        durationMinutes:meta.duration,
        workStart:WORK_START,
        workEnd:WORK_END
      });
      const blocked=new Set((remote.blockedSlots||[]).map(String));
      const blocks=toBlocks(time,meta.duration).map(v=>v.slice(0,5));
      if(blocks.some(block=>blocked.has(block))){
        return json(res,409,{error:"That time is no longer available. Please choose another slot."});
      }
    }catch(err){
      console.error("calendar precheck:",err);
      return json(res,503,{error:"Availability is temporarily unavailable. Please try again shortly."});
    }

    // Ensure existing databases have the consent evidence columns before booking insert.
    await ensureConsentSchema();

    // Remove expired holds so slots become reusable.
    await sql`DELETE FROM slot_locks WHERE expires_at IS NOT NULL AND expires_at < NOW()`;

    // A failed/cancelled checkout may be retried. If this exact customer,
    // session and slot already has a live unpaid hold, reuse its existing
    // booking and Razorpay order instead of attempting a second slot lock.
    const requestedBlocks=toBlocks(time,meta.duration);
    const blockers=new Map();
    for(const block of requestedBlocks){
      const lockedRows=await sql`
        SELECT b.*, sl.expires_at AS slot_lock_expires_at
        FROM slot_locks sl
        INNER JOIN bookings b ON b.id=sl.booking_id
        WHERE sl.slot_date=${date}
          AND sl.slot_start=${block}
          AND (sl.expires_at IS NULL OR sl.expires_at > NOW())
        LIMIT 1
      `;
      if(lockedRows[0]) blockers.set(lockedRows[0].id,lockedRows[0]);
    }

    // Compare real time ranges too; some existing bookings were locked on the
    // previous 30-minute grid and have no lock row at every new 20-minute step.
    const activeBookingRows=await sql`
      SELECT b.*, b.expires_at AS slot_lock_expires_at
      FROM bookings b
      WHERE b.booking_date=${date}
        AND (
          (b.payment_status='paid' AND b.booking_status IN ('confirmed','paid_pending_confirmation','calendar_processing'))
          OR (b.booking_status='pending' AND b.expires_at > NOW())
        )
    `;
    for(const row of activeBookingRows){
      const bookedStart=String(row.booking_time).slice(0,5);
      if(timeRangesOverlap(time,meta.duration,bookedStart,Number(row.duration_minutes))){
        blockers.set(row.id,row);
      }
    }

    if(blockers.size){
      const existing=blockers.size===1 ? [...blockers.values()][0] : null;
      const sameRequestedSlot=Boolean(existing &&
        normalizeDatabaseDate(existing.booking_date)===date &&
        String(existing.booking_time).slice(0,5)===time &&
        existing.session_name===sessionName &&
        existing.service===meta.service &&
        Number(existing.duration_minutes)===Number(meta.duration));
      const activeUnpaidHold=Boolean(existing &&
        existing.payment_status!=="paid" &&
        existing.booking_status==="pending" &&
        existing.razorpay_order_id &&
        existing.customer_email===email &&
        sameRequestedSlot &&
        existing.slot_lock_expires_at &&
        new Date(existing.slot_lock_expires_at).getTime()>Date.now());

      if(activeUnpaidHold){
        return json(res,200,{
          bookingId:existing.id,
          accessToken:createBookingAccessToken(existing.id),
          orderId:existing.razorpay_order_id,
          amount:Number(existing.amount_inr),
          currency:"INR",
          keyId,
          expiresAt:existing.expires_at,
          reused:true
        });
      }

      if(existing && existing.payment_status==="paid"){
        return json(res,409,{error:"Payment is already recorded or being confirmed for this slot. Please do not pay again; check the booking status or contact support."});
      }

      return json(res,409,{error:"This time overlaps an active booking hold. If this is your previous unpaid attempt, retry with the same email, session, date and time. Otherwise choose another available slot after the hold expires."});
    }

    const bookingId=crypto.randomUUID();
    const expiresAt=new Date(Date.now()+10*60*1000).toISOString();

    await sql`INSERT INTO bookings
      (id,service,session_name,amount_inr,duration_minutes,customer_name,customer_email,customer_whatsapp,
       booking_date,booking_time,language,concern,message,birth_date,birth_time,birth_place,consent_accepted,consent_at,
       payment_status,booking_status,expires_at)
      VALUES
      (${bookingId},${meta.service},${sessionName},${meta.amount},${meta.duration},${customerName},${email},${whatsapp},
       ${date},${time},${clean(body.language,30)},${clean(body.concern,100)},${clean(body.message,5000)},
       ${birthDate||null},${birthTimeUnknown?null:(birthTime||null)},${birthPlace||null},TRUE,NOW(),
       'created','pending',${expiresAt})`;

    try {
      for(const block of toBlocks(time,meta.duration)) {
        await sql`INSERT INTO slot_locks (booking_id,slot_date,slot_start,expires_at)
          VALUES (${bookingId},${date},${block},${expiresAt})`;
      }
    } catch(err) {
      await sql`DELETE FROM bookings WHERE id=${bookingId}`;
      return json(res,409,{error:"That time was just booked. Please choose another available slot."});
    }

    const auth=Buffer.from(keyId+":"+keySecret).toString("base64");
    const rr=await fetch("https://api.razorpay.com/v1/orders",{
      method:"POST",
      headers:{
        "Authorization":"Basic "+auth,
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        amount:meta.amount*100,
        currency:"INR",
        receipt:bookingId,
        notes:{booking_id:bookingId,session:sessionName,service:meta.service}
      })
    });
    const order=await rr.json();
    if(!rr.ok || !order.id){
      // Log only the provider's sanitized error metadata for Preview diagnostics.
      // Never log API keys, Authorization headers, or the full request/response.
      console.error("Razorpay order creation failed", {
        httpStatus: rr.status,
        code: order?.error?.code || null,
        description: order?.error?.description || null,
        source: order?.error?.source || null,
        step: order?.error?.step || null,
        reason: order?.error?.reason || null
      });
      await sql`DELETE FROM bookings WHERE id=${bookingId}`;
      return json(res,502,{error:"Could not create the payment order. Please try again."});
    }

    await sql`UPDATE bookings
      SET razorpay_order_id=${order.id},updated_at=NOW()
      WHERE id=${bookingId}`;

    return json(res,200,{
      bookingId,
      accessToken:createBookingAccessToken(bookingId),
      orderId:order.id,
      amount:meta.amount,
      currency:"INR",
      keyId,
      expiresAt
    });
  } catch(err){
    console.error(err);
    return json(res,500,{error:"Something went wrong while creating the booking."});
  }
};