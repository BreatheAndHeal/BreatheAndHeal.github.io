const { sql } = require("../lib/db");
const { handleOptions, json } = require("../lib/config");
const { confirmPaidBooking } = require("../lib/confirm-booking");
const { verifyBookingAccessToken } = require("../lib/booking-access");

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

    let rows=await sql`SELECT id,service,session_name,booking_date,booking_time,
      payment_status,booking_status,meet_link,calendar_event_id
      FROM bookings WHERE id=${bookingId} LIMIT 1`;
    let calendarError=null;

    let booking=rows[0];
    if(!booking) return json(res,404,{error:"Booking not found."});

    if(booking.payment_status==="paid" &&
       (booking.booking_status==="paid_pending_confirmation" || booking.booking_status==="calendar_processing") &&
       !booking.meet_link){
      try{
        const retry=await confirmPaidBooking(bookingId);
        calendarError=retry?.calendarError||null;
        rows=await sql`SELECT id,service,session_name,booking_date,booking_time,
          payment_status,booking_status,meet_link,calendar_event_id
          FROM bookings WHERE id=${bookingId} LIMIT 1`;
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
