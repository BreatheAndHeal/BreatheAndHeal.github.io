const { sql } = require("../lib/db");
const { SESSIONS, json, SLOT_MINUTES, WORK_START, WORK_END, WORK_DAYS, addMinutes, toBlocks, validateSlot } = require("../lib/config");

module.exports = async (req,res) => {
  if(req.method!=="GET") return json(res,405,{error:"Method not allowed."});
  try{
    const date=String(req.query?.date||"");
    const sessionName=String(req.query?.session||"");
    const meta=SESSIONS[sessionName];
    if(!meta) return json(res,400,{error:"Invalid session."});

    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))
      return json(res,400,{error:"Invalid date."});
    if(!WORK_DAYS.has(new Date(date+"T00:00:00Z").getUTCDay()))
      return json(res,200,{date,slots:[]});

    await sql`DELETE FROM slot_locks WHERE expires_at IS NOT NULL AND expires_at < NOW()`;
    const lockedRows=await sql`SELECT slot_start FROM slot_locks
      WHERE slot_date=${date} AND (expires_at IS NULL OR expires_at > NOW())`;
    const locked=new Set(lockedRows.map(r=>String(r.slot_start).slice(0,5)));

    const slots=[];
    const requiredBlocks=Math.ceil(meta.duration/SLOT_MINUTES);
    for(let m=WORK_START*60;m+meta.duration<=WORK_END*60;m+=SLOT_MINUTES){
      const start=String(Math.floor(m/60)).padStart(2,"0")+":"+String(m%60).padStart(2,"0");
      const blocks=toBlocks(start,meta.duration);
      if(blocks.length!==requiredBlocks) continue;
      const free=blocks.every(b=>!locked.has(b.slice(0,5)));
      if(free && !validateSlot(date,start,meta.duration)) slots.push(start);
    }
    return json(res,200,{date,slots});
  }catch(err){
    console.error(err);
    return json(res,500,{error:"Could not load available times."});
  }
};