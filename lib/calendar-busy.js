const TZ='Asia/Kolkata';

function rfc3339(dateStr,timeStr){
  return String(dateStr)+'T'+String(timeStr)+':00+05:30';
}

async function getAccessToken(){
  const clientId=process.env.GOOGLE_CLIENT_ID;
  const clientSecret=process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken=process.env.GOOGLE_REFRESH_TOKEN;

  // Calendar blocking is an optional enhancement. If the Google OAuth
  // credentials are not configured in Vercel, keep normal booking slots
  // working instead of taking the booking calendar offline.
  if(!clientId || !clientSecret || !refreshToken){
    return null;
  }

  const response=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',
    headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({
      client_id:clientId,
      client_secret:clientSecret,
      refresh_token:refreshToken,
      grant_type:'refresh_token'
    }).toString()
  });

  const data=await response.json().catch(()=>({}));

  if(!response.ok || !data.access_token){
    throw new Error('Could not authenticate with Google Calendar.');
  }

  return data.access_token;
}

function addMinutes(total,minutes){
  return total+minutes;
}

async function getBlockedSlotsFromCalendar({date,durationMinutes,workStart,workEnd}){
  const token=await getAccessToken();
  // No Google OAuth configuration: there is no calendar block data to apply.
  // This deliberately falls back to the normal slot system.
  if(!token) return {blockedSlots:[]};
  const calendarId=process.env.GOOGLE_CALENDAR_ID || 'primary';

  const timeMin=rfc3339(
    date,
    String(workStart).padStart(2,'0')+':00'
  );

  const endMinutes=Number(workEnd)*60;
  const endHour=Math.floor(endMinutes/60);
  const endMinute=endMinutes%60;

  const timeMax=rfc3339(
    date,
    String(endHour).padStart(2,'0')+':'+String(endMinute).padStart(2,'0')
  );

  const response=await fetch('https://www.googleapis.com/calendar/v3/freeBusy',{
    method:'POST',
    headers:{
      Authorization:'Bearer '+token,
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      timeMin,
      timeMax,
      timeZone:TZ,
      items:[{id:calendarId}]
    })
  });

  const data=await response.json().catch(()=>({}));

  if(!response.ok){
    const detail=data?.error?.message || 'Google Calendar availability request failed.';
    throw new Error(detail);
  }

  const busyIntervals=
    data?.calendars?.[calendarId]?.busy ||
    [];

  const blockedSlots=[];

  for(
    let minute=Number(workStart)*60;
    minute+Number(durationMinutes)<=Number(workEnd)*60;
    minute+=30
  ){
    const hh=String(Math.floor(minute/60)).padStart(2,'0');
    const mm=String(minute%60).padStart(2,'0');
    const slot=hh+':'+mm;

    const startUtc=new Date(
      rfc3339(date,slot)
    );

    const endMinute=addMinutes(
      minute,
      Number(durationMinutes)
    );

    const endH=String(Math.floor(endMinute/60)).padStart(2,'0');
    const endM=String(endMinute%60).padStart(2,'0');

    const endUtc=new Date(
      rfc3339(date,endH+':'+endM)
    );

    if(
      busyIntervals.some(interval=>{
        const busyStart=new Date(interval.start);
        const busyEnd=new Date(interval.end);

        return (
          startUtc < busyEnd &&
          endUtc > busyStart
        );
      })
    ){
      blockedSlots.push(slot);
    }
  }

  return {blockedSlots};
}

module.exports={getBlockedSlotsFromCalendar};
