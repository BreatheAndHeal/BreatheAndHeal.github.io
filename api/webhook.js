const { sql } = require("../lib/db");
const { createMeetEvent } = require("../lib/calendar");
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

async function confirmPaidBooking(bookingId){
  const rows=await sql`SELECT * FROM bookings WHERE id=${bookingId} LIMIT 1`;
  const booking=rows[0];
  if(!booking) return {ok:false,reason:"booking_not_found"};

  if(booking.booking_status==="confirmed" && booking.meet_link){
    return {ok:true,confirmed:true,meetLink:booking.meet_link};
  }

  await sql`UPDATE bookings
    SET payment_status='paid',
        booking_status='paid_pending_confirmation',
        expires_at=NULL,
        updated_at=NOW()
    WHERE id=${bookingId}`;

  await sql`UPDATE slot_locks SET expires_at=NULL WHERE booking_id=${bookingId}`;

  try{
    const calendar=await createMeetEvent({
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

    if(calendar?.meetLink){
      await sql`UPDATE bookings
        SET booking_status='confirmed',
            meet_link=${calendar.meetLink},
            calendar_event_id=${calendar.eventId||null},
            updated_at=NOW()
        WHERE id=${bookingId}`;

      return {ok:true,confirmed:true,meetLink:calendar.meetLink};
    }
  }catch(err){
    console.error("calendar:",err);
  }

  return {ok:true,confirmed:false,meetLink:null};
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
