const crypto = require("crypto");
const { sql } = require("../lib/db");
const { SESSIONS, json } = require("../lib/config");
const { createMeetEvent } = require("../lib/calendar");

module.exports = async (req,res) => {
  if(req.method !== "POST") return json(res,405,{error:"Method not allowed."});
  try {
    const {
      bookingId,razorpay_order_id,razorpay_payment_id,razorpay_signature
    }=req.body || {};
    if(!bookingId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
      return json(res,400,{error:"Missing payment verification fields."});

    const rows=await sql`SELECT * FROM bookings WHERE id=${bookingId} LIMIT 1`;
    const booking=rows[0];
    if(!booking) return json(res,404,{error:"Booking not found."});
    if(booking.razorpay_order_id !== razorpay_order_id)
      return json(res,400,{error:"Payment order mismatch."});

    const expected=crypto.createHmac("sha256",process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id+"|"+razorpay_payment_id)
      .digest("hex");
    if(!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(razorpay_signature)))
      return json(res,400,{error:"Payment verification failed."});

    if(booking.booking_status==="confirmed" && booking.razorpay_payment_id===razorpay_payment_id)
      return json(res,200,{ok:true,bookingId,meetLink:booking.meet_link||null});

    await sql`UPDATE bookings
      SET razorpay_payment_id=${razorpay_payment_id},
          payment_status='paid',
          booking_status='paid_pending_confirmation',
          paid_at=NOW(),
          expires_at=NULL,
          updated_at=NOW()
      WHERE id=${bookingId}`;

    await sql`DELETE FROM slot_locks WHERE booking_id=${bookingId}`;

    let calendar=null;
    try{
      calendar=await createMeetEvent({
        bookingId:booking.id,
        service:booking.service,
        sessionName:booking.session_name,
        startDate:String(booking.booking_date).slice(0,10),
        startTime:String(booking.booking_time).slice(0,5),
        durationMinutes:booking.duration_minutes,
        customerName:booking.customer_name,
        customerEmail:booking.customer_email,
        notes:booking.message
      });
    }catch(calendarErr){
      console.error("calendar:",calendarErr);
      calendar={error:calendarErr.message};
    }

    await sql`UPDATE bookings
      SET booking_status='confirmed',
          meet_link=${calendar?.meetLink||null},
          calendar_event_id=${calendar?.eventId||null},
          updated_at=NOW()
      WHERE id=${bookingId}`;

    return json(res,200,{
      ok:true,
      bookingId,
      service:booking.service,
      session:booking.session_name,
      date:String(booking.booking_date).slice(0,10),
      time:String(booking.booking_time).slice(0,5),
      meetLink:calendar?.meetLink||null,
      calendarPending:!calendar?.meetLink
    });
  }catch(err){
    console.error(err);
    return json(res,500,{error:"Payment was received but confirmation could not be completed automatically. Please contact support."});
  }
};