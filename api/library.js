import { clearSessionCookie, json, readSessionCode, unlock } from "../lib/drillAccess.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return json(response, 405, { message: "Method not allowed." });
  }
  const code = readSessionCode(request);
  if (!code) return json(response, 401, { message: "Access required." });

  try {
    const result = await unlock(request, code);
    if (!result) {
      clearSessionCookie(response);
      return json(response, 401, { message: "Access expired." });
    }
    return json(response, 200, {
      accessId: result.accessId,
      role: result.role,
      drills: result.drills,
    });
  } catch {
    return json(response, 503, { message: "Library is temporarily unavailable." });
  }
}
