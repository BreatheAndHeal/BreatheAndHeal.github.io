async function createMeetEvent({bookingId,service,sessionName,startDate,startTime,durationMinutes,customerName,customerEmail,notes}) {
  const url = process.env.GOOGLE_APPS_SCRIPT_URL;
  const secret = process.env.GOOGLE_APPS_SCRIPT_SECRET;
  if(!url || !secret) {
    return {skipped:true,reason:"Google Apps Script calendar integration is not configured."};
  }

  const response = await fetch(url,{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Authorization":"Bearer "+secret
    },
    body:JSON.stringify({
      bookingId,
      service,
      sessionName,
      startDate,
      startTime,
      durationMinutes,
      customerName,
      customerEmail,
      notes:notes||""
    })
  });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error("Google Calendar integration returned an invalid response."); }

  if(!response.ok || !data.ok) {
    throw new Error(data.error || "Google Calendar event creation failed.");
  }

  return {
    eventId:data.eventId||null,
    meetLink:data.meetLink||null
  };
}

module.exports={createMeetEvent};
