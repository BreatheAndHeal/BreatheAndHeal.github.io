const { sql } = require("./db");
const { createMeetEvent } = require("./calendar");
const { getBlockedSlotsFromCalendar } = require("./calendar-busy");
const { SESSIONS, toBlocks, WORK_START, WORK_END } = require("./config");

function normalizeBookingDate(value){
  if(value instanceof Date && !isNaN(value.getTime())){
    return value.toISOString().slice(0,10);
  }

  const text=String(value||"").trim();

  const iso=text.match(/^(\d{4}-\d{2}-\d{2})/);
  if(iso) return iso[1];

  // PostgreSQL DATE values can be exposed as Date-like values depending on
  // the driver/runtime. Reject anything ambiguous instead of sending an
  // invalid date to Google Calendar.
  throw new Error("Invalid booking date: "+text);
}

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
    // Re-claim every duration block here so browser callbacks and payment
    // webhooks cannot revive an expired hold into a double booking.
    const bookingDate=normalizeBookingDate(work.booking_date);
    const bookingTime=String(work.booking_time).slice(0,5);
    const blocks=toBlocks(bookingTime,Number(work.duration_minutes)).map(v=>v.slice(0,5));
    const refreshedExpiry=new Date(Date.now()+15*60*1000).toISOString();

    await sql`UPDATE slot_locks
      SET expires_at=${refreshedExpiry}
      WHERE booking_id=${bookingId}
        AND expires_at IS NOT NULL
        AND expires_at < NOW()`;

    for(const block of blocks){
      await sql`INSERT INTO slot_locks (booking_id,slot_date,slot_start,expires_at)
        VALUES (${bookingId},${bookingDate},${block},${refreshedExpiry})
        ON CONFLICT (slot_date,slot_start) DO NOTHING`;
    }

    const ownedBlocks=await sql`SELECT slot_start FROM slot_locks WHERE booking_id=${bookingId}`;
    if(ownedBlocks.length!==blocks.length || !blocks.every(block=>ownedBlocks.some(row=>String(row.slot_start).slice(0,5)===block))){
      await sql`UPDATE bookings
        SET booking_status='paid_slot_conflict',
            expires_at=NULL,
            updated_at=NOW()
        WHERE id=${bookingId}
          AND payment_status='paid'`;
      await sql`DELETE FROM slot_locks WHERE booking_id=${bookingId}`;
      return { ok:true, confirmed:false, pending:false, slotConflict:true, meetLink:null, calendarError:"The selected time was taken before confirmation." };
    }

    await sql`UPDATE slot_locks SET expires_at=NULL WHERE booking_id=${bookingId}`;

    // Recheck the provider calendar immediately before creating the Meet event.
    const meta=SESSIONS[work.session_name];
    if(meta){
      try{
        const remote=await getBlockedSlotsFromCalendar({
          date:bookingDate, durationMinutes:work.duration_minutes,
          workStart:WORK_START, workEnd:WORK_END
        });
        const blocked=new Set((remote.blockedSlots||[]).map(String));
        if(blocks.some(block=>blocked.has(block))){
          await sql`UPDATE bookings
            SET booking_status='paid_slot_conflict', updated_at=NOW()
            WHERE id=${bookingId} AND booking_status='calendar_processing'`;
          await sql`DELETE FROM slot_locks WHERE booking_id=${bookingId}`;
          return { ok:true, confirmed:false, pending:false, slotConflict:true, meetLink:null, calendarError:"The selected time became unavailable before confirmation." };
        }
      }catch(calendarCheckError){
        console.error("calendar free-busy recheck:",calendarCheckError);
      }
    }
    const calendar=await createMeetEvent({
      bookingId:work.id,
      service:work.service,
      sessionName:work.session_name,
      startDate:normalizeBookingDate(work.booking_date),
      startTime:String(work.booking_time).slice(0,5),
      durationMinutes:work.duration_minutes,
      amount:work.amount_inr,
      customerName:work.customer_name,
      customerEmail:work.customer_email,
      customerWhatsapp:work.customer_whatsapp,
      notes:""
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
