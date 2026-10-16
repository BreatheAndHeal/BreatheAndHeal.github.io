const { sql } = require("../lib/db");
const { handleOptions, json } = require("../lib/config");
const { confirmPaidBooking } = require("../lib/confirm-booking");
const { verifyBookingAccessToken } = require("../lib/booking-access");

async function inspectRazorpayOrder(orderId, expectedAmount) {
  const keyId=process.env.RAZORPAY_KEY_ID;
  const keySecret=process.env.RAZORPAY_KEY_SECRET;
  if(!keyId || !keySecret || !orderId) return {status:"unknown"};

  try{
    const auth=Buffer.from(keyId+":"+keySecret).toString("base64");
    const response=await fetch(
      "https://api.razorpay.com/v1/orders/"+encodeURIComponent(orderId)+"/payments",
      {headers:{Authorization:"Basic "+auth,Accept:"application/json"}}
    );
    const data=await response.json();
    if(!response.ok || !Array.isArray(data?.items)) return {status:"unknown"};

    const payments=data.items.filter(payment=>payment?.order_id===orderId);
    const captured=payments.find(payment=>payment.status==="captured");
    if(captured){
      if(Number(captured.amount)!==Number(expectedAmount)*100) return {status:"unknown"};
      return {status:"captured",payment:captured};
    }
    if(!payments.length) return {status:"not_started"};
    if(payments.some(payment=>payment.status==="authorized" || payment.status==="created")) {
      return {status:"pending"};
    }
    if(payments.every(payment=>payment.status==="failed")) return {status:"failed"};
    return {status:"unknown"};
  }catch(error){
    console.error("Razorpay order status lookup failed:",error?.message||"Unknown error");
    return {status:"unknown"};
  }
}

module.exports = async (req,res) => {
  if(handleOptions(req,res)) return;
  if(req.method!=="GET") return json(res,405,{error:"Method not allowed."});

  try{
    const bookingId=String(req.query?.bookingId||"").trim();
    if(!bookingId) return json(res,400,{error:"Missing bookingId."});

    const accessToken=String(req.headers["x-booking-access-token"]||"");
    if(!verifyBookingAccessToken(bookingId,accessToken)){
      return json(res,401,{error:"Booking access is not authorized."});
    }

    let rows=await sql`SELECT * FROM bookings WHERE id=${bookingId} LIMIT 1`;
    let booking=rows[0];
    let calendarError=null;
    if(!booking) return json(res,404,{error:"Booking not found."});

    // Reconcile the provider's order before deciding that a pending browser
    // callback means payment failed. This is read-only against Razorpay.
    let paymentAttemptStatus=booking.payment_status==="paid" ? "captured" : "unknown";
    if(booking.payment_status!=="paid" && booking.razorpay_order_id){
      const inspected=await inspectRazorpayOrder(booking.razorpay_order_id,booking.amount_inr);
      paymentAttemptStatus=inspected.status;
      if(inspected.status==="captured" && inspected.payment){
        await sql`
          UPDATE bookings
          SET razorpay_payment_id=COALESCE(razorpay_payment_id,${inspected.payment.id}),
              payment_status='paid',
              booking_status=CASE
                WHEN booking_status IN ('confirmed','paid_slot_conflict') THEN booking_status
                ELSE 'paid_pending_confirmation'
              END,
              paid_at=COALESCE(paid_at,NOW()),
              expires_at=NULL,
              updated_at=NOW()
          WHERE id=${bookingId}
        `;
        await sql`UPDATE slot_locks SET expires_at=NULL WHERE booking_id=${bookingId}`;
        rows=await sql`SELECT * FROM bookings WHERE id=${bookingId} LIMIT 1`;
        booking=rows[0]||booking;
      }
    }

    if(booking.payment_status==="paid" &&
       (booking.booking_status==="paid_pending_confirmation" || booking.booking_status==="calendar_processing") &&
       !booking.meet_link){
      try{
        const retry=await confirmPaidBooking(bookingId);
        calendarError=retry?.calendarError||null;
        rows=await sql`SELECT * FROM bookings WHERE id=${bookingId} LIMIT 1`;
        booking=rows[0]||booking;
      }catch(err){
        console.error("booking-status calendar retry:",err);
      }
    }

    return json(res,200,{
      ok:true,
      bookingId:booking.id,
      service:booking.service,
      session:booking.session_name,
      date:String(booking.booking_date).slice(0,10),
      time:String(booking.booking_time).slice(0,5),
      paymentStatus:booking.payment_status,
      bookingStatus:booking.booking_status,
      paymentAttemptStatus:booking.payment_status==="paid" ? "captured" : paymentAttemptStatus,
      slotConflict:booking.booking_status==="paid_slot_conflict",
      meetLink:booking.meet_link||null,
      calendarError
    });
  }catch(err){
    console.error(err);
    return json(res,500,{error:"Could not check booking status."});
  }
};
