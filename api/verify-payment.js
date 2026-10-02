const crypto = require("crypto");
const { sql } = require("../lib/db");
const { SESSIONS, json } = require("../lib/config");
const { createMeetEvent } = require("../lib/calendar");

function safeEqualHex(a,b){
  if(!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a,"utf8"),Buffer.from(b,"utf8"));
}

async function fetchRazorpayPayment(paymentId){
  const keyId=process.env.RAZORPAY_KEY_ID;
  const keySecret=process.env.RAZORPAY_KEY_SECRET;
  if(!keyId || !keySecret) throw new Error("Payment verification is not configured.");
  const auth=Buffer.from(keyId+":"+keySecret).toString("base64");
  const r=await fetch("https://api.razorpay.com/v1/payments/"+encodeURIComponent(paymentId),{
    headers:{Authorization:"Basic "+auth,Accept:"application/json"}
  });
  const data=await r.json();
  if(!r.ok || !data?.id) throw new Error("Could not confirm the payment with Razorpay.");
  return data;
}

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

    const keySecret=process.env.RAZORPAY_KEY_SECRET;
    if(!keySecret) return json(res,500,{error:"Payment verification is not configured."});

    const expected=crypto.createHmac("sha256",keySecret)
      .update(razorpay_order_id+"|"+razorpay_payment_id)
      .digest("hex");
    if(!safeEqualHex(expected,razorpay_signature))
      return json(res,400,{error:"Payment verification failed."});

    if(booking.booking_status==="confirmed" && booking.razorpay_payment_id===razorpay_payment_id)
      return json(res,200,{
        ok:true,
        bookingId,
        service:booking.service,
        session:booking.session_name,
        date:String(booking.booking_date).slice(0,10),
        time:String(booking.booking_time).slice(0,5),
        meetLink:booking.meet_link||null,
        pending:false
      });

    // Second server-side check: the payment must belong to this order and match
    // the exact booking amount before we treat the booking as paid.
    let payment;
    try{
      payment=await fetchRazorpayPayment(razorpay_payment_id);
    }catch(paymentErr){
      console.error("razorpay payment lookup:",paymentErr);
      return json(res,502,{error:"Payment was received, but Razorpay confirmation is still being checked. Please wait a moment and do not pay again."});
    }

    const expectedAmount=Number(booking.amount_inr)*100;
    if(payment.order_id !== razorpay_order_id)
      return json(res,400,{error:"Payment order mismatch."});
    if(Number(payment.amount)!==expectedAmount)
      return json(res,400,{error:"Payment amount mismatch."});
    if(payment.status!=="captured")
      return json(res,409,{error:"Payment is not captured yet. Please wait a moment; do not pay again."});

    await sql`UPDATE bookings
      SET razorpay_payment_id=${razorpay_payment_id},
          payment_status='paid',
          booking_status='paid_pending_confirmation',
          paid_at=COALESCE(paid_at,NOW()),
          expires_at=NULL,
          updated_at=NOW()
      WHERE id=${bookingId}`;

    await sql`UPDATE slot_locks SET expires_at=NULL WHERE booking_id=${bookingId}`;

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
      return json(res,200,{
        ok:true,
        pending:true,
        bookingId,
        service:booking.service,
        session:booking.session_name,
        date:String(booking.booking_date).slice(0,10),
        time:String(booking.booking_time).slice(0,5),
        meetLink:null,
        calendarPending:true,
        message:"Payment verified. Your booking is reserved, and the Google Meet link is still being created."
      });
    }

    if(!calendar?.meetLink){
      return json(res,200,{
        ok:true,
        pending:true,
        bookingId,
        service:booking.service,
        session:booking.session_name,
        date:String(booking.booking_date).slice(0,10),
        time:String(booking.booking_time).slice(0,5),
        meetLink:null,
        calendarPending:true,
        message:"Payment verified. Your booking is reserved, and the Google Meet link is still being created."
      });
    }

    await sql`UPDATE bookings
      SET booking_status='confirmed',
          meet_link=${calendar.meetLink},
          calendar_event_id=${calendar.eventId||null},
          updated_at=NOW()
      WHERE id=${bookingId}`;

    return json(res,200,{
      ok:true,
      pending:false,
      bookingId,
      service:booking.service,
      session:booking.session_name,
      date:String(booking.booking_date).slice(0,10),
      time:String(booking.booking_time).slice(0,5),
      meetLink:calendar.meetLink,
      calendarPending:false
    });
  }catch(err){
    console.error(err);
    return json(res,500,{error:"Payment verification could not be completed. Please do not pay again; contact support if the amount was deducted."});
  }
};
