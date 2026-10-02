const { sql } = require("../lib/db");
const { handleOptions } = require("../lib/config");

module.exports = async (req,res) => {
  if(handleOptions(req,res)) return;
  if(req.method!=="GET") return res.status(405).json({error:"Method not allowed."});

  try{
    const bookingId=String(req.query?.bookingId||"").trim();
    if(!bookingId) return res.status(400).json({error:"Missing bookingId."});

    const rows=await sql`SELECT id,service,session_name,booking_date,booking_time,
      payment_status,booking_status,meet_link
      FROM bookings WHERE id=${bookingId} LIMIT 1`;

    const booking=rows[0];
    if(!booking) return res.status(404).json({error:"Booking not found."});

    res.setHeader("Access-Control-Allow-Origin","https://breatheandheal.github.io");
    res.setHeader("Vary","Origin");
    return res.status(200).json({
      ok:true,
      bookingId:booking.id,
      service:booking.service,
      session:booking.session_name,
      date:String(booking.booking_date).slice(0,10),
      time:String(booking.booking_time).slice(0,5),
      paymentStatus:booking.payment_status,
      bookingStatus:booking.booking_status,
      meetLink:booking.meet_link||null
    });
  }catch(err){
    console.error(err);
    return res.status(500).json({error:"Could not check booking status."});
  }
};
