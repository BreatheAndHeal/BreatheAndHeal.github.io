const crypto = require("crypto");

async function getAccessToken() {
  if(!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REFRESH_TOKEN) {
    return null;
  }
  const body = new URLSearchParams({
    client_id:process.env.GOOGLE_CLIENT_ID,
    client_secret:process.env.GOOGLE_CLIENT_SECRET,
    refresh_token:process.env.GOOGLE_REFRESH_TOKEN,
    grant_type:"refresh_token"
  });
  const r = await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body
  });
  if(!r.ok) throw new Error("Google OAuth token request failed.");
  const data=await r.json();
  return data.access_token;
}

async function createMeetEvent({bookingId,service,sessionName,startDate,startTime,durationMinutes,customerName,customerEmail,notes}) {
  const accessToken=await getAccessToken();
  if(!accessToken) return {skipped:true,reason:"Google Calendar credentials not configured."};

  const calendarId=process.env.GOOGLE_CALENDAR_ID || "primary";
  const timezone=process.env.BOOKING_TIMEZONE || "Asia/Kolkata";
  const startISO=startDate+"T"+startTime+":00";
  const [hh,mm]=startTime.split(":").map(Number);
  const endTotal=hh*60+mm+durationMinutes;
  const endTime=String(Math.floor(endTotal/60)).padStart(2,"0")+":"+String(endTotal%60).padStart(2,"0");
  const endISO=startDate+"T"+endTime+":00";

  const event={
    summary:"The Unsaid — "+sessionName,
    description:[
      "Booking ID: "+bookingId,
      "Service: "+service,
      "Customer: "+customerName,
      "Notes: "+(notes||"")
    ].join("\n"),
    start:{dateTime:startISO,timeZone:timezone},
    end:{dateTime:endISO,timeZone:timezone},
    attendees:[{email:customerEmail}],
    conferenceData:{
      createRequest:{
        requestId:"theunsaid-"+bookingId+"-"+crypto.randomUUID(),
        conferenceSolutionKey:{type:"hangoutsMeet"}
      }
    }
  };

  const url="https://www.googleapis.com/calendar/v3/calendars/"+encodeURIComponent(calendarId)+"/events?conferenceDataVersion=1&sendUpdates=all";
  const r=await fetch(url,{
    method:"POST",
    headers:{
      "Authorization":"Bearer "+accessToken,
      "Content-Type":"application/json"
    },
    body:JSON.stringify(event)
  });
  const data=await r.json();
  if(!r.ok) throw new Error(data.error?.message || "Google Calendar event creation failed.");

  const meet = data.hangoutLink ||
    data.conferenceData?.entryPoints?.find(x=>x.entryPointType==="video")?.uri || null;
  return {eventId:data.id || null,meetLink:meet};
}

module.exports={createMeetEvent};