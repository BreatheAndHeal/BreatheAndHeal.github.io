const crypto = require("crypto");
const { sql } = require("../lib/db");
const { SESSIONS, json, handleOptions, isValidEmail, clean, toBlocks, validateSlot, canonicalSession, WORK_START, WORK_END } = require("../lib/config");
const { getBlockedSlotsFromCalendar } = require("../lib/calendar-busy");
const { createBookingAccessToken } = require("../lib/booking-access");

module.exports = async (req,res) => {
  if(handleOptions(req,res)) return;
  if(req.method !== "POST") return json(res,405,{error:"Method not allowed."});
  try {
    const body=req.body || {};
    const rawSession=clean(body.session);
    const sessionName=canonicalSession(rawSession);
    const meta=sessionName ? SESSIONS[sessionName] : null;
    if(!meta) return json(res,400,{error:"Invalid session."});

    const customerName=clean(body.name,200);
    const email=clean(body.email,320).toLowerCase();
    const whatsapp=clean(body.whatsapp,50);
    const date=clean(body.date,10);
    const time=clean(body.time,5);
    if(!customerName || !isValidEmail(email) || !whatsapp || !date || !time)
      return json(res,400,{error:"Please complete all required booking details."});

    const slotError=validateSlot(date,time,meta.duration);
    if(slotError) return json(res,400,{error:slotError});

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
      if((remote.blockedSlots||[]).includes(time)){
        return json(res,409,{error:"That time is no longer available. Please choose another slot."});
      }
    }catch(err){
      console.error("calendar precheck:",err);
      return json(res,503,{error:"Availability is temporarily unavailable. Please try again shortly."});
    }

    // Remove expired holds so slots become reusable.
    await sql`DELETE FROM slot_locks WHERE expires_at IS NOT NULL AND expires_at < NOW()`;

    const bookingId=crypto.randomUUID();
    const expiresAt=new Date(Date.now()+10*60*1000).toISOString();

    await sql`INSERT INTO bookings
      (id,service,session_name,amount_inr,duration_minutes,customer_name,customer_email,customer_whatsapp,
       booking_date,booking_time,language,concern,message,birth_date,birth_time,birth_place,
       payment_status,booking_status,expires_at)
      VALUES
      (${bookingId},${meta.service},${sessionName},${meta.amount},${meta.duration},${customerName},${email},${whatsapp},
       ${date},${time},${clean(body.language,30)},${clean(body.concern,100)},${clean(body.message,5000)},
       ${body.birthDate||null},${body.birthTime||null},${clean(body.birthPlace,200)},
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

    const keyId=process.env.RAZORPAY_KEY_ID;
    const keySecret=process.env.RAZORPAY_KEY_SECRET;
    if(!keyId || !keySecret){
      await sql`DELETE FROM bookings WHERE id=${bookingId}`;
      return json(res,500,{error:"Payment system is not configured yet."});
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