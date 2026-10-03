const url = process.env.GOOGLE_APPS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbzD5v2Ct6hFJMlhMba9vz1GXOb8zlPfxuMhJCxYa8U6uOlm3yXWcFLVaet4SVCqhrJbmQ/exec";
const secret = process.env.GOOGLE_APPS_SCRIPT_SECRET;

async function getBlockedSlotsFromCalendar({date,durationMinutes,workStart,workEnd}){
  if(!url || !secret){
    return {blockedSlots:[]};
  }

  const response=await fetch(url,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      secret,
      action:"blockedSlots",
      date,
      durationMinutes:Number(durationMinutes),
      workStartHour:Number(workStart),
      workEndHour:Number(workEnd)
    })
  });

  const text=await response.text();
  let data;
  try{ data=JSON.parse(text); }
  catch{ throw new Error("Google Calendar availability returned an invalid response."); }

  if(!response.ok || !data.ok){
    throw new Error(data.error||"Google Calendar availability check failed.");
  }

  return {blockedSlots:Array.isArray(data.blockedSlots)?data.blockedSlots:[]};
}

module.exports={getBlockedSlotsFromCalendar};
