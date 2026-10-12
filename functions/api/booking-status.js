import handler from "../../api/booking-status.js";
import { runLegacyHandler } from "../_shared/legacy-adapter.js";

export async function onRequest({ request }) {
  return runLegacyHandler(request, handler);
}
