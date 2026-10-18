const { sql } = require("../lib/db");
const { getBlockedSlotsFromCalendar } = require("../lib/calendar-busy");
const { SESSIONS, json, handleOptions, SLOT_MINUTES, WORK_START, WORK_END, WORK_DAYS, addMinutes, toBlocks, validateSlot, canonicalSession, timeRangesOverlap } = require("../lib/config");
const { allowRequest } = require("../lib/rate-limit");

module.exports = async (req,res) => {
  if(handleOptions(req,res)) return;
  if(req.method!=="GET") return json(res,405,{error:"Method not allowed."});
  if(!allowRequest(req,"availability",120,60*1000))
    return json(res,429,{error:"Too many availability requests. Please wait a moment."});
  try{
    const date=String(req.query?.date||"");
    const rawSession=String(req.query?.session||"");
    const sessionName=canonicalSession(rawSession);
    const meta=sessionName ? SESSIONS[sessionName] : null;
    if(!meta) return json(res,400,{error:"Invalid session."});

    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return json(res,400,{error:"Invalid date."});
    if(!WORK_DAYS.has(new Date(date+"T00:00:00Z").getUTCDay()))
      return json(res,200,{date,slots:[]});

    await sql`DELETE FROM slot_locks WHERE expires_at IS NOT NULL AND expires_at < NOW()`;
    const lockedRows=await sql`SELECT slot_start FROM slot_locks
      WHERE slot_date=${date} AND (expires_at IS NULL OR expires_at > NOW())`;
    const locked=new Set(lockedRows.map(r=>String(r.slot_start).slice(0,5)));

    // Compare booking intervals as well as slot-lock rows. This protects
    // bookings/holds created before the old 30-minute grid is replaced.
    const activeBookings=await sql`
      SELECT booking_time,duration_minutes FROM bookings
      WHERE booking_date=${date}
        AND (
          (payment_status='paid' AND booking_status IN ('confirmed','paid_pending_confirmation','calendar_processing'))
          OR (booking_status='pending' AND expires_at > NOW())
        )
    `;

    let calendarBlocked;
    try{
      const remote=await getBlockedSlotsFromCalendar({
        date,
        durationMinutes:meta.duration,
        workStart:WORK_START,
        workEnd:WORK_END
      });
      calendarBlocked=new Set(remote.blockedSlots||[]);
    }catch(err){
      console.error("calendar availability:",err);
      return json(res,503,{error:"Availability is temporarily unavailable. Please try again shortly."});
    }

    const slots=[];
    const requiredBlocks=Math.ceil(meta.duration/SLOT_MINUTES);
    for(let m=WORK_START*60;m+meta.duration<=WORK_END*60;m+=SLOT_MINUTES){
      const start=String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0");
      const blocks=toBlocks(start,meta.duration);
      if(blocks.length!==requiredBlocks) continue;
      const overlapsBooking=activeBookings.some(row=>
        timeRangesOverlap(start,meta.duration,String(row.booking_time).slice(0,5),Number(row.duration_minutes))
      );
      const free=blocks.every(b=>!locked.has(b.slice(0,5)) && !calendarBlocked.has(b.slice(0,5))) && !overlapsBooking;
      if(free && !validateSlot(date,start,meta.duration)) slots.push(start);
    }
    return json(res,200,{date,slots});
  }catch(err){
    console.error(err);
    return json(res,500,{error:"Could not load available times."});
  }
};