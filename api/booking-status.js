const { sql } = require("../lib/db");
const { handleOptions, json } = require("../lib/config");
const { confirmPaidBooking } = require("../lib/confirm-booking");
const { verifyBookingAccessToken } = require("../lib/booking-access");
const { allowRequest } = require("../lib/rate-limit");

async function fetchRazorpayPayment(paymentId){
  const keyId=process.env.RAZORPAY_KEY_ID;
  const keySecret=process.env.RAZORPAY_KEY_SECRET;
  if(!keyId || !keySecret) throw new Error("Payment verification is not configured.");
  const auth=Buffer.from(keyId+":"+keySecret).toString("base64");
  const response=await fetch("https://api.razorpay.com/v1/payments/"+encodeURIComponent(paymentId),{
    headers:{Authorization:"Basic "+auth,Accept:"application/json"}
  });
  if(!response.ok){
    console.error("Razorpay payment recovery lookup returned HTTP",response.status);
    return null;
  }
  try{ return await response.json(); }catch(_){ return null; }
}

async function getCapturedPaymentForOrder(booking, explicitPaymentId){
  const keyId=process.env.RAZORPAY_KEY_ID;
  const keySecret=process.env.RAZORPAY_KEY_SECRET;
  const orderId=String(booking.razorpay_order_id||"");
  if(!keyId || !keySecret || !orderId) return null;

  const lastUpdated=new Date(booking.updated_at).getTime();
  // Browser polling uses a 5-second interval; throttle background list checks,
  // but never throttle a one-time recovery using a supplied payment ID.
  if(!explicitPaymentId && Number.isFinite(lastUpdated) && Date.now()-lastUpdated<20000) return null;

  let candidates=[];
  if(explicitPaymentId){
    if(!/^pay_[A-Za-z0-9]+$/.test(explicitPaymentId)) return null;
    const payment=await fetchRazorpayPayment(explicitPaymentId);
    if(payment) candidates=[payment];
  }else{
    const auth=Buffer.from(keyId+":"+keySecret).toString("base64");
    let response;
    try{
      response=await fetch("https://api.razorpay.com/v1/orders/"+encodeURIComponent(orderId)+"/payments",{
        headers:{Authorization:"Basic "+auth,Accept:"application/json"}
      });
    }catch(_){
      console.error("Razorpay order-payment recovery lookup failed.");
      return null;
    }
    if(!response.ok){
      console.error("Razorpay order-payment recovery returned HTTP",response.status);
      return null;
    }
    let result;
    try{result=await response.json();}catch(_){return null;}
    candidates=Array.isArray(result?.items)?result.items:[];
  }

  const expectedAmount=Number(booking.amount_inr)*100;
  const captured=candidates.find(payment=>
    payment &&
    payment.order_id===orderId &&
    payment.status==="captured" &&
    payment.currency==="INR" &&
    Number(payment.amount)===expectedAmount &&
    typeof payment.id==="string" &&
    payment.id.length>0 &&
    (!explicitPaymentId || payment.id===explicitPaymentId)
  );

  if(!captured){
    // Throttle failed list lookups during automatic browser polling.
    if(!explicitPaymentId){
      await sql`UPDATE bookings
        SET updated_at=NOW()
        WHERE id=${booking.id}
          AND payment_status <> 'paid'`;
    }
    return null;
  }

  await sql`UPDATE bookings
    SET razorpay_payment_id=${captured.id},
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

  // Also repair an inconsistent/missing payment ID if the same valid captured
  // payment was already recorded as paid for this exact order.
  await sql`UPDATE bookings
    SET razorpay_payment_id=${captured.id}, updated_at=NOW()
    WHERE id=${booking.id}
      AND razorpay_order_id=${orderId}
      AND payment_status='paid'
      AND (razorpay_payment_id IS NULL OR razorpay_payment_id=${captured.id})`;

  await sql`UPDATE slot_locks
    SET expires_at=NULL
    WHERE booking_id=${booking.id}`;

  return captured.id;
}

module.exports = async (req,res) => {
  if(handleOptions(req,res)) return;
  if(req.method!=="GET") return json(res,405,{error:"Method not allowed."});

  try{
    const bookingId=String(req.query?.bookingId||"").trim();
    const recoveryPaymentId=String(req.query?.paymentId||"").trim();
    if(!bookingId) return json(res,400,{error:"Missing bookingId."});

    const accessToken=String(req.headers["x-booking-access-token"]||"");
    const hasValidAccess=verifyBookingAccessToken(bookingId,accessToken);
    // For a one-time recovery without the browser's original session token,
    // require a concrete payment ID and verify it against Razorpay's API,
    // including the exact order ID and expected amount. No Meet link or PII is
    // returned on this possession-verified recovery path.
    if(!hasValidAccess && !recoveryPaymentId){
      return json(res,401,{error:"Booking access is not authorized."});
    }
    if(!hasValidAccess && !allowRequest(req,"booking-payment-recovery",5,10*60*1000)){
      return json(res,429,{error:"Too many recovery attempts. Please wait and try again."});
    }

    const selectBooking=()=>sql`SELECT id,service,session_name,booking_date,booking_time,
      payment_status,booking_status,meet_link,calendar_event_id,razorpay_order_id,
      razorpay_payment_id,amount_inr,updated_at
      FROM bookings WHERE id=${bookingId} LIMIT 1`;

    let rows=await selectBooking();
    let booking=rows[0];
    if(!booking) return json(res,404,{error:"Booking not found."});
    let calendarError=null;
    let recovered=false;

    if(recoveryPaymentId){
      const verifiedPaymentId=await getCapturedPaymentForOrder(booking,recoveryPaymentId);
      if(!verifiedPaymentId){
        return json(res,409,{
          ok:false,
          error:"Razorpay could not verify a captured payment matching this booking and amount. No booking change was made."
        });
      }
      recovered=true;
      rows=await selectBooking();
      booking=rows[0]||booking;
    }else if(booking.payment_status!=="paid" && booking.razorpay_order_id){
      try{
        recovered=Boolean(await getCapturedPaymentForOrder(booking,null));
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
        calendarError="Calendar/Meet confirmation is still pending.";
      }
    }

    // A recovery URL without the booking access token confirms only that the
    // verified transaction was reconciled; it never exposes the Meet URL.
    if(!hasValidAccess){
      return json(res,200,{
        ok:true,
        recovered,
        paymentStatus:booking.payment_status,
        bookingStatus:booking.booking_status,
        confirmed:booking.booking_status==="confirmed" && Boolean(booking.meet_link),
        calendarPending:booking.payment_status==="paid" && booking.booking_status!=="confirmed",
        calendarError
      });
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
