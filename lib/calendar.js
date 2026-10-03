async function createMeetEvent({bookingId,service,sessionName,startDate,startTime,durationMinutes,amount,customerName,customerEmail,customerWhatsapp,notes}) {
  const url = process.env.GOOGLE_APPS_SCRIPT_URL || "https://script.google.com/macros/s/AKfycbzD5v2Ct6hFJMlhMba9vz1GXOb8zlPfxuMhJCxYa8U6uOlm3yXWcFLVaet4SVCqhrJbmQ/exec";
  const secret = process.env.GOOGLE_APPS_SCRIPT_SECRET;
  if(!url || !secret) {
    return {skipped:true,reason:"Google Apps Script calendar integration is not configured."};
  }

  const response = await fetch(url,{
    method:"POST",
    headers:{
      "Content-Type":"application/json"
    },
    body:JSON.stringify({
      secret,
      bookingId,
      service,
      sessionName,
      startDate,
      startTime,
      durationMinutes,
      amount:amount||null,
      customerName,
      customerEmail,
      customerWhatsapp:customerWhatsapp||"",
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
    meetLink:data.meetLink||null,
    customerEmailSent:Boolean(data.customerEmailSent),
    adminEmailSent:Boolean(data.adminEmailSent),
    emailError:data.emailError||null
  };
}

module.exports={createMeetEvent};
