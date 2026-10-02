const crypto = require("crypto");
const { sql } = require("../lib/db");

async function rawBody(req){
  let data="";
  for await (const chunk of req) data += chunk;
  return data;
}

module.exports = async (req,res) => {
  if(req.method!=="POST") return res.status(405).end();
  try{
    const raw=await rawBody(req);
    const signature=req.headers["x-razorpay-signature"];
    const secret=process.env.RAZORPAY_WEBHOOK_SECRET;
    if(!secret || !signature) return res.status(401).end();
    const expected=crypto.createHmac("sha256",secret).update(raw).digest("hex");
    if(!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(signature))) return res.status(401).end();

    const event=JSON.parse(raw);
    const payment=event.payload?.payment?.entity;
    const orderId=payment?.order_id;
    if(payment?.status==="captured" && orderId){
      await sql`UPDATE bookings
        SET razorpay_payment_id=COALESCE(razorpay_payment_id,${payment.id}),
            payment_status='paid',
            booking_status=CASE WHEN booking_status='confirmed' THEN booking_status ELSE 'paid_pending_confirmation' END,
            expires_at=NULL,
            updated_at=NOW()
        WHERE razorpay_order_id=${orderId}`;
    }
    return res.status(200).json({ok:true});
  }catch(err){
    console.error(err);
    return res.status(400).end();
  }
};