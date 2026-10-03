const crypto = require("crypto");
const { sql } = require("../lib/db");
const { SESSIONS, json, handleOptions, isValidISODate, isValidHHMM } = require("../lib/config");
const { confirmPaidBooking } = require("../lib/confirm-booking");
const { allowRequest } = require("../lib/rate-limit");

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
  if(handleOptions(req,res)) return;
  if(req.method !== "POST") return json(res,405,{error:"Method not allowed."});
  if(!allowRequest(req,"verify-payment",20,10*60*1000))
    return json(res,429,{error:"Too many verification attempts. Please wait and try again."});
  try {
    const {
      bookingId,razorpay_order_id,razorpay_payment_id,razorpay_signature
    }=req.body || {};
    if(!bookingId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature)
      return json(res,400,{error:"Missing payment verification fields."});

    const rows=await sql`SELECT * FROM bookings WHERE id=${bookingId} LIMIT 1`;
    const booking=rows[0];
    if(!booking) return json(res,404,{error:"Booking not found."});
    if(!isValidISODate(String(booking.booking_date).slice(0,10)) || !isValidHHMM(String(booking.booking_time).slice(0,5)))
      return json(res,409,{error:"This booking has an invalid slot. Please contact support."});
    if(booking.razorpay_order_id !== razorpay_order_id)
      return json(res,400,{error:"Payment order mismatch."});
    if(booking.booking_status==="paid_slot_conflict"){
      return json(res,200,{
        ok:true, pending:false, slotConflict:true, bookingId,
        service:booking.service, session:booking.session_name,
        date:String(booking.booking_date).slice(0,10),
        time:String(booking.booking_time).slice(0,5), meetLink:null,
        message:"Payment was already verified for a slot that became unavailable. Please do not pay again; contact support."
      });
    }

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

    const confirmation=await confirmPaidBooking(bookingId);
    const fresh=(await sql`SELECT * FROM bookings WHERE id=${bookingId} LIMIT 1`);
    const current=fresh[0]||booking;

    return json(res,200,{
      ok:true,
      pending:!confirmation.confirmed,
      bookingId,
      service:current.service,
      session:current.session_name,
      date:String(current.booking_date).slice(0,10),
      time:String(current.booking_time).slice(0,5),
      meetLink:confirmation.meetLink||current.meet_link||null,
      calendarPending:!confirmation.confirmed && !confirmation.slotConflict,
      slotConflict:Boolean(confirmation.slotConflict),
      message:confirmation.slotConflict
        ? "Payment was verified, but the selected slot became unavailable before confirmation. Please do not pay again; contact support."
        : confirmation.confirmed
          ? "Payment verified and booking confirmed."
          : "Payment verified. Your booking is reserved, and the Google Meet link is still being created."
    });
  }catch(err){
    console.error(err);
    return json(res,500,{error:"Payment verification could not be completed. Please do not pay again; contact support if the amount was deducted."});
  }
};
