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
  return crypto.timingSafeEqual(
    Buffer.from(a,"utf8"),
    Buffer.from(b,"utf8")
  );
}

module.exports = async (req,res) => {
  if(req.method!=="POST") return res.status(405).end();

  try{
    const raw=await rawBody(req);
    const signature=req.headers["x-razorpay-signature"];
    const secret=process.env.RAZORPAY_WEBHOOK_SECRET;

    if(!secret || !signature) return res.status(401).end();

    const expected=crypto.createHmac("sha256",secret)
      .update(raw)
      .digest("hex");

    if(!sameHex(expected,signature)) return res.status(401).end();

    const event=JSON.parse(raw);
    const payment=event.payload?.payment?.entity;
    const orderId=payment?.order_id;

    if(payment?.status==="captured" && orderId){
      const rows=await sql`SELECT * FROM bookings
        WHERE razorpay_order_id=${orderId}
        LIMIT 1`;

      const booking=rows[0];

      if(booking){
        if(Number(payment.amount)!==Number(booking.amount_inr)*100){
          console.error("Webhook amount mismatch for order",orderId);
          return res.status(400).end();
        }

        await sql`UPDATE bookings
          SET razorpay_payment_id=COALESCE(razorpay_payment_id,${payment.id}),
              payment_status='paid',
              booking_status=CASE
                WHEN booking_status='confirmed' THEN booking_status
                ELSE 'paid_pending_confirmation'
              END,
              expires_at=NULL,
              updated_at=NOW()
          WHERE id=${booking.id}`;

        await confirmPaidBooking(booking.id);
      }
    }

    return res.status(200).json({ok:true});
  }catch(err){
    console.error(err);
    return res.status(400).end();
  }
};
