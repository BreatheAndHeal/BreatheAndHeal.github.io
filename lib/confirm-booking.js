const { sql } = require("./db");
const { createMeetEvent } = require("./calendar");

async function confirmPaidBooking(bookingId){
  const rows=await sql`SELECT * FROM bookings WHERE id=${bookingId} LIMIT 1`;
  const booking=rows[0];
  if(!booking) return {ok:false,reason:"booking_not_found"};

  if(booking.payment_status!=="paid"){
    return {ok:false,reason:"not_paid"};
  }

  if(booking.booking_status==="confirmed" && booking.meet_link){
    return {ok:true,confirmed:true,meetLink:booking.meet_link,eventId:booking.calendar_event_id||null};
  }

  // If a previous Calendar request crashed mid-flight, allow a later status poll
  // to retry after a small safety window.
  if(booking.booking_status==="calendar_processing"){
    await sql`
      UPDATE bookings
      SET booking_status='paid_pending_confirmation',
          updated_at=NOW()
      WHERE id=${bookingId}
        AND payment_status='paid'
        AND booking_status='calendar_processing'
        AND updated_at < NOW() - INTERVAL '2 minutes'
    `;
  }

  // Claim the calendar-confirmation step so simultaneous browser/webhook retries
  // cannot create duplicate Calendar events.
  const claimed=await sql`
    UPDATE bookings
    SET booking_status='calendar_processing',
        expires_at=NULL,
        updated_at=NOW()
    WHERE id=${bookingId}
      AND payment_status='paid'
      AND booking_status='paid_pending_confirmation'
      AND calendar_event_id IS NULL
    RETURNING *
  `;

  if(!claimed[0]){
    const fresh=(await sql`SELECT * FROM bookings WHERE id=${bookingId} LIMIT 1`)[0];
    if(fresh?.booking_status==="calendar_processing"){
      return {ok:true,confirmed:false,pending:true,meetLink:fresh.meet_link||null};
    }
    if(fresh?.booking_status==="confirmed" && fresh.meet_link){
      return {ok:true,confirmed:true,meetLink:fresh.meet_link,eventId:fresh.calendar_event_id||null};
    }
    return {ok:true,confirmed:false,pending:true,meetLink:fresh?.meet_link||null};
  }

  const work=claimed[0];

  try{
    const calendar=await createMeetEvent({
      bookingId:work.id,
      service:work.service,
      sessionName:work.session_name,
      startDate:String(work.booking_date).slice(0,10),
      startTime:String(work.booking_time).slice(0,5),
      durationMinutes:work.duration_minutes,
      customerName:work.customer_name,
      customerEmail:work.customer_email,
      notes:work.message
    });

    if(calendar?.meetLink){
      await sql`
        UPDATE bookings
        SET booking_status='confirmed',
            meet_link=${calendar.meetLink},
            calendar_event_id=${calendar.eventId||null},
            updated_at=NOW()
        WHERE id=${bookingId}
      `;
      return {
        ok:true,
        confirmed:true,
        meetLink:calendar.meetLink,
        eventId:calendar.eventId||null
      };
    }

    await sql`
      UPDATE bookings
      SET booking_status='paid_pending_confirmation',
          updated_at=NOW()
      WHERE id=${bookingId}
        AND booking_status='calendar_processing'
    `;
    return {ok:true,confirmed:false,pending:true,meetLink:null};
  }catch(err){
    console.error("calendar confirmation:",err);
    await sql`
      UPDATE bookings
      SET booking_status='paid_pending_confirmation',
          updated_at=NOW()
      WHERE id=${bookingId}
        AND booking_status='calendar_processing'
    `;
    return {
      ok:true,
      confirmed:false,
      pending:true,
      meetLink:null,
      calendarError:err.message||"calendar_error"
    };
  }
}

module.exports={confirmPaidBooking};
