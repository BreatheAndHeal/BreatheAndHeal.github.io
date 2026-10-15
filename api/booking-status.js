const { sql } = require("../lib/db");
const { handleOptions, json } = require("../lib/config");
const { confirmPaidBooking } = require("../lib/confirm-booking");
const { verifyBookingAccessToken } = require("../lib/booking-access");

async function recoverCapturedPayment(booking){
  const keyId=process.env.RAZORPAY_KEY_ID;
  const keySecret=process.env.RAZORPAY_KEY_SECRET;
  const orderId=String(booking.razorpay_order_id||"");
  if(!keyId || !keySecret || !orderId) return false;

  // Avoid repeatedly querying Razorpay during the frontend's short polling loop.
  const lastUpdated=new Date(booking.updated_at).getTime();
  if(Number.isFinite(lastUpdated) && Date.now()-lastUpdated<20000) return false;

  const auth=Buffer.from(keyId+":"+keySecret).toString("base64");
  let response;
  try{
    response=await fetch("https://api.razorpay.com/v1/orders/"+encodeURIComponent(orderId)+"/payments",{
      headers:{Authorization:"Basic "+auth,Accept:"application/json"}
    });
  }catch(err){
    console.error("Razorpay order-payment lookup failed.");
    return false;
  }

  if(!response.ok){
    console.error("Razorpay order-payment lookup returned HTTP",response.status);
    return false;
  }

  let result;
  try{ result=await response.json(); }
  catch(_){ return false; }

  const expectedAmount=Number(booking.amount_inr)*100;
  const captured=(Array.isArray(result?.items)?result.items:[]).find(payment=>
    payment &&
    payment.order_id===orderId &&
    payment.status==="captured" &&
    payment.currency==="INR" &&
    Number(payment.amount)===expectedAmount &&
    typeof payment.id==="string" &&
    payment.id.length>0
  );

  if(!captured){
    // Recheck at most once every ~20 seconds while the browser is polling.
    await sql`UPDATE bookings
      SET updated_at=NOW()
      WHERE id=${booking.id}
        AND payment_status <> 'paid'`;
    return false;
  }

  // Recovery path for a captured payment whose checkout callback/webhook was
  // not persisted. Match the exact Razorpay order and expected amount before
  // changing the booking to paid. The caller has already authenticated access
  // to this booking with its per-booking access token.
  await sql`UPDATE bookings
    SET razorpay_payment_id=COALESCE(razorpay_payment_id,${captured.id}),
        payment_status='paid',
        booking_status=CASE
          WHEN booking_status IN ('confirmed','paid_slot_conflict','calendar_processing') THEN booking_status
          ELSE 'paid_pending_confirmation'
        END,
        paid_at=COALESCE(paid_at,NOW()),
        expires_at=NULL,
        updated_at=NOW()
    WHERE id=${booking.id}
      AND razorpay_order_id=${orderId}
      AND payment_status <> 'paid'`;

  await sql`UPDATE slot_locks
    SET expires_at=NULL
    WHERE booking_id=${booking.id}`;

  return true;
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

    const selectBooking=()=>sql`SELECT id,service,session_name,booking_date,booking_time,
      payment_status,booking_status,meet_link,calendar_event_id,razorpay_order_id,
      razorpay_payment_id,amount_inr,updated_at
      FROM bookings WHERE id=${bookingId} LIMIT 1`;

    let rows=await selectBooking();
    let calendarError=null;

    let booking=rows[0];
    if(!booking) return json(res,404,{error:"Booking not found."});

    // If checkout reported success but its callback didn't persist the payment,
    // confirm directly against Razorpay's authenticated order-payment endpoint.
    if(booking.payment_status!=="paid" && booking.razorpay_order_id){
      try{
        await recoverCapturedPayment(booking);
        rows=await selectBooking();
        booking=rows[0]||booking;
      }catch(err){
        console.error("booking-status payment recovery failed:",err);
      }
    }

    if(booking.payment_status==="paid" &&
       (booking.booking_status==="paid_pending_confirmation" || booking.booking_status==="calendar_processing") &&
       !booking.meet_link){
      try{
        const retry=await confirmPaidBooking(bookingId);
        calendarError=retry?.calendarError||null;
        rows=await selectBooking();
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
      slotConflict:booking.booking_status==="paid_slot_conflict",
      meetLink:booking.meet_link||null,
      calendarError
    });
  }catch(err){
    console.error(err);
    return json(res,500,{error:"Could not check booking status."});
  }
};
