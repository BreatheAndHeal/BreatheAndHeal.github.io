const crypto = require("crypto");

function requesterKey(req){
  const forwarded=String(req.headers["x-forwarded-for"]||"").split(",")[0].trim();
  const real=String(req.headers["x-real-ip"]||"").trim();
  const ip=forwarded||real||"unknown";
  const secret=process.env.RAZORPAY_KEY_SECRET || "the-unsaid-rate-limit";
  return crypto.createHmac("sha256",secret).update(ip).digest("hex");
}

function allowRequest(req,name,limit,windowMs){
  const now=Date.now();
  const key=name+":"+requesterKey(req);
  const store=globalThis.__theUnsaidRateLimits || (globalThis.__theUnsaidRateLimits=new Map());

  let entry=store.get(key);
  if(!entry || now-entry.startedAt>=windowMs){
    entry={startedAt:now,count:0};
    store.set(key,entry);
  }

  entry.count += 1;

  // Bound memory in long-lived serverless instances.
  if(store.size>2000){
    for(const [k,v] of store){
      if(now-v.startedAt>=windowMs) store.delete(k);
    }
  }

  return entry.count<=limit;
}

module.exports={allowRequest};
