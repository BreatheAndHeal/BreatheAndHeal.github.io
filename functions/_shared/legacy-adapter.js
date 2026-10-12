const MAX_BODY_BYTES = 1_000_000;

function securityHeaders() {
  return new Headers({
    "Cache-Control": "no-store",
    "Strict-Transport-Security": "max-age=31536000",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  });
}

function errorResponse(status, message) {
  const headers = securityHeaders();
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify({ error: message }), { status, headers });
}

/**
 * Adapt the existing Vercel-style handlers to Cloudflare Pages Functions.
 * Booking and payment business logic stays in the existing API modules.
 */
export async function runLegacyHandler(request, handler) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const configuredOrigins = new Set(
    String(process.env.ALLOWED_ORIGIN || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );

  // Same-origin frontend calls are expected. Reject browser-originated
  // cross-site requests unless explicitly allowlisted. Razorpay webhooks
  // normally have no Origin header and continue to signature validation.
  if (origin && origin !== url.origin && !configuredOrigins.has(origin)) {
    return errorResponse(403, "Origin not allowed.");
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return errorResponse(413, "Request body is too large.");
  }

  let rawBody = "";
  if (request.method !== "GET" && request.method !== "HEAD") {
    rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      return errorResponse(413, "Request body is too large.");
    }
  }

  const requestHeaders = Object.create(null);
  request.headers.forEach((value, key) => {
    requestHeaders[key.toLowerCase()] = value;
  });

  let parsedBody = null;
  const contentType = String(request.headers.get("content-type") || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (rawBody && contentType === "application/json") {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return errorResponse(400, "Invalid JSON request body.");
    }
  }

  const req = {
    method: request.method,
    url: request.url,
    headers: requestHeaders,
    query: Object.fromEntries(url.searchParams.entries()),
    body: parsedBody,
    async *[Symbol.asyncIterator]() {
      if (rawBody) yield rawBody;
    }
  };

  let statusCode = 200;
  let responseBody = null;
  let response = null;
  const responseHeaders = securityHeaders();

  function finalize(body) {
    responseBody = body == null ? null : String(body);
    const noBodyStatus = statusCode === 204 || statusCode === 304;
    response = new Response(noBodyStatus ? null : responseBody, {
      status: statusCode,
      headers: responseHeaders
    });
    return response;
  }

  const res = {
    status(code) {
      statusCode = Number(code) || 200;
      return this;
    },
    setHeader(name, value) {
      responseHeaders.set(String(name), String(value));
      return this;
    },
    end(body = null) {
      return finalize(body);
    },
    json(value) {
      responseHeaders.set("Content-Type", "application/json; charset=utf-8");
      return finalize(JSON.stringify(value));
    }
  };

  try {
    await handler(req, res);
    return response || finalize(responseBody);
  } catch (error) {
    // Do not expose stack traces, environment variables or request contents.
    console.error("Cloudflare API handler failed:", error?.message || "Unknown error");
    return errorResponse(500, "An unexpected error occurred. Please try again later.");
  }
}
