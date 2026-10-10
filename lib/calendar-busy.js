const APPS_SCRIPT_URL =
  process.env.GOOGLE_APPS_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbzD5v2Ct6hFJMlhMba9vz1GXOb8zlPfxuMhJCxYa8U6uOlm3yXWcFLVaet4SVCqhrJbmQ/exec';

async function getBlockedSlotsFromCalendar({date,workStart,workEnd}){
  const secret=process.env.GOOGLE_APPS_SCRIPT_SECRET;

  if(!secret){
    throw new Error('Google Apps Script calendar integration is not configured.');
  }

  const response=await fetch(APPS_SCRIPT_URL,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      secret,
      action:'getBusySlots',
      date,
      workStart,
      workEnd
    })
  });

  const text=await response.text();
  let data;

  try{
    data=JSON.parse(text);
  }catch{
    throw new Error('Google Apps Script availability returned an invalid response.');
  }

  if(!response.ok || !data?.ok || !Array.isArray(data?.blockedSlots)){
    const detail=typeof data?.error==='string'
      ? data.error
      : 'Google Calendar availability request failed.';
    throw new Error(detail);
  }

  // The Apps Script returns occupied 30-minute blocks (e.g. 10:00, 10:30),
  // not booking start times. The availability and order endpoints compare
  // every block of a session against this set.
  const blockedSlots=data.blockedSlots;

  if(blockedSlots.some(slot=>typeof slot!=='string' || !/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(slot))){
    throw new Error('Google Apps Script returned an invalid blocked time.');
  }

  return {blockedSlots:[...new Set(blockedSlots)]};
}

module.exports={getBlockedSlotsFromCalendar};
