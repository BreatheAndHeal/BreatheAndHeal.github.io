const { sql } = require("../lib/db");
const { confirmPaidBooking } = require("../lib/confirm-booking");
const crypto = require("crypto");

async function rawBody(req){
  let data="";
  for await (const chunk of req) data += chunk;
  return data;
}

function sameHex(a,b){
  if(!a || !b || a.length!==b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a,"utf8"),Buffer.from(b,"utf8"));
}

module.exports = async (req,res) => {
  if(req.method!=="POST") return res.status(405).end();

  try{
    const raw=await rawBody(req);
    const signature=req.headers["x-razorpay-signature"];
    const secret=process.env.RAZORPAY_WEBHOOK_SECRET;

    if(!secret || !signature) return res.status(401).end();

    const expected=crypto.createHmac("sha256",secret).update(raw).digest("hex");
    if(!sameHex(expected,signature)) return res.status(401).end();

    const event=JSON.parse(raw);
    // Acknowledge unrelated Razorpay events quickly; only payment.captured can confirm a booking.
    if(event.event!=="payment.captured") return res.status(200).json({ok:true});

    const payment=event.payload?.payment?.entity;
    const orderId=payment?.order_id;
    if(payment?.status!=="captured" || !orderId) return res.status(200).json({ok:true});
    if(typeof payment.id!=="string" || !/^pay_[A-Za-z0-9]+$/.test(payment.id)){
      console.error("Webhook received an invalid payment ID for order",orderId);
      return res.status(400).end();
    }

    const rows=await sql`SELECT id, amount_inr, payment_status, booking_status, razorpay_payment_id
      FROM bookings
      WHERE razorpay_order_id=${orderId}
      LIMIT 1`;
    const booking=rows[0];

    // Unknown orders must not create records or start Calendar work.
    if(!booking) return res.status(200).json({ok:true});

    if(payment.currency!=="INR" || Number(payment.amount)!==Number(booking.amount_inr)*100){
      console.error("Webhook currency/amount mismatch for order",orderId);
      return res.status(400).end();
    }

    // Never replace a different recorded payment ID. A second captured payment
    // for the same order needs reconciliation rather than silently reusing the booking.
    if(booking.razorpay_payment_id && booking.razorpay_payment_id!==payment.id){
      console.error("Webhook payment ID mismatch for order",orderId);
      return res.status(200).json({ok:true,ignored:true});
    }

    const updated=await sql`UPDATE bookings
      SET razorpay_payment_id=COALESCE(razorpay_payment_id,${payment.id}),
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
        AND (razorpay_payment_id IS NULL OR razorpay_payment_id=${payment.id})
      RETURNING id`;

    if(!updated[0]){
      console.error("Webhook payment state did not match the booking order",orderId);
      return res.status(200).json({ok:true,ignored:true});
    }

    // Cloudflare Pages waitUntil keeps Calendar/Meet/email work alive after the
    // 2xx acknowledgement. Never make Razorpay wait for the external providers.
    const confirmationPromise=Promise.resolve()
      .then(()=>confirmPaidBooking(booking.id))
      .catch(err=>{
        console.error("Background booking confirmation failed:",err?.message||"unknown error");
      });
    if(typeof req.waitUntil==="function"){
      req.waitUntil(confirmationPromise);
    }else{
      // Compatibility for non-Cloudflare callers. Production is routed through
      // the Cloudflare adapter, which supplies waitUntil.
      void confirmationPromise;
    }

    return res.status(200).json({ok:true});
  }catch(err){
    console.error("Razorpay webhook handler failed:",err?.message||"unknown error");
    return res.status(400).end();
  }
};
