const SESSIONS = {
  "First Conversation — 30 min": { service:"emotional", amount:499, duration:30 },
  "Deep Conversation — 45 min": { service:"emotional", amount:699, duration:45 },
  "Extended Session — 60 min": { service:"emotional", amount:1199, duration:60 },
  "Vedic Insight — 30 min": { service:"astrology", amount:999, duration:30 },
  "Deep Vedic Reading — 50 min": { service:"astrology", amount:1499, duration:50 },
  "Complete Vedic Guidance — 70 min": { service:"astrology", amount:2199, duration:70 }
};

const TZ = process.env.BOOKING_TIMEZONE || "Asia/Kolkata";
const WORK_START = Number(process.env.WORK_START_HOUR || 10);
const WORK_END = Math.max(22, Number(process.env.WORK_END_HOUR || 22));
const SLOT_MINUTES = Number(process.env.SLOT_INTERVAL_MINUTES || 30);
const MIN_LEAD_MINUTES = Number(process.env.MIN_LEAD_MINUTES || 60);
const WORK_DAYS = new Set(
  String(process.env.WORK_DAYS || "1,2,3,4,5,6")
    .split(",").map(x => Number(x.trim())).filter(Number.isFinite)
);

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin","https://breatheandheal.github.io");
  res.setHeader("Vary","Origin");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type,Accept,X-Booking-Access-Token");
}

function handleOptions(req,res) {
  if(req.method !== "OPTIONS") return false;
  cors(res);
  res.status(204).end();
  return true;
}

function json(res, status, body) {
  cors(res);
  res.status(status)
    .setHeader("Content-Type","application/json")
    .setHeader("Cache-Control","no-store")
    .setHeader("X-Content-Type-Options","nosniff")
    .setHeader("X-Frame-Options","DENY")
    .setHeader("Referrer-Policy","no-referrer")
    .setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");
  res.end(JSON.stringify(body));
}

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||"").trim());
}

function clean(v, max=5000) {
  return String(v ?? "").trim().slice(0,max);
}

function localParts(dateStr, timeStr) {
  const [y,m,d] = String(dateStr).split("-").map(Number);
  const [hh,mm] = String(timeStr).split(":").map(Number);
  return {y,m,d,hh,mm};
}

function localDateWeekday(dateStr) {
  const {y,m,d}=localParts(dateStr,"00:00");
  return new Date(Date.UTC(y,m-1,d)).getUTCDay();
}

function addMinutes(hhmm, minutes) {
  const [hh,mm]=hhmm.split(":").map(Number);
  const total=hh*60+mm+minutes;
  return String(Math.floor(total/60)).padStart(2,"0")+":"+String(total%60).padStart(2,"0");
}

function toBlocks(startTime, duration) {
  const blocks = Math.ceil(duration / SLOT_MINUTES);
  const out=[];
  for(let i=0;i<blocks;i++) out.push(addMinutes(startTime, i*SLOT_MINUTES)+":00");
  return out;
}

function nowInIndia() {
  const parts = new Intl.DateTimeFormat("en-GB",{
    timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hour12:false
  }).formatToParts(new Date());
  const get=k=>parts.find(p=>p.type===k)?.value;
  return {date:get("year")+"-"+get("month")+"-"+get("day"), time:get("hour")+":"+get("minute")};
}

function canonicalSession(raw) {
  const s = clean(raw,200);
  if (SESSIONS[s]) return s;
  const stripped = s.replace(/\s+·\s+₹[0-9,]+$/, "");
  if (SESSIONS[stripped]) return stripped;
  return null;
}

function validateSlot(dateStr,timeStr,duration) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{2}:\d{2}$/.test(timeStr)) return "Invalid date or time.";
  const {hh,mm}=localParts(dateStr,timeStr);
  if(!Number.isInteger(hh)||!Number.isInteger(mm)||hh<0||hh>23||mm<0||mm>59) return "Invalid date or time.";
  if(mm % SLOT_MINUTES !== 0) return "Please choose a standard 30-minute slot.";
  if(!WORK_DAYS.has(localDateWeekday(dateStr))) return "That day is not available.";
  const start=hh*60+mm;
  const end=start+duration;
  if(start < WORK_START*60 || end > WORK_END*60) return "That time is outside the available hours.";
  const today=nowInIndia();
  if(dateStr < today.date) return "Please choose a future date.";
  if(dateStr===today.date){
    const [th,tm]=today.time.split(":").map(Number);
    if(start < th*60+tm+MIN_LEAD_MINUTES) return "Please choose a later time.";
  }
  return null;
}

module.exports={
  SESSIONS,TZ,WORK_START,WORK_END,SLOT_MINUTES,MIN_LEAD_MINUTES,WORK_DAYS,canonicalSession,
  cors,handleOptions,json,isValidEmail,clean,localParts,addMinutes,toBlocks,nowInIndia,validateSlot
};