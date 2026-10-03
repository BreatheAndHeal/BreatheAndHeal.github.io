const crypto = require("crypto");

function getSecret(){
  const secret=process.env.RAZORPAY_KEY_SECRET;
  if(!secret) throw new Error("Booking access security is not configured.");
  return secret;
}

function createBookingAccessToken(bookingId){
  return crypto.createHmac("sha256",getSecret())
    .update("the-unsaid:booking-status:"+String(bookingId))
    .digest("base64url");
}

function verifyBookingAccessToken(bookingId,token){
  if(!token || typeof token!=="string") return false;
  const expected=createBookingAccessToken(bookingId);
  const a=Buffer.from(token,"utf8");
  const b=Buffer.from(expected,"utf8");
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}

module.exports={createBookingAccessToken,verifyBookingAccessToken};
