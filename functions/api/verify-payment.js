import handler from "../../api/verify-payment.js";
import { runLegacyHandler } from "../_shared/legacy-adapter.js";

export async function onRequest({ request }) {
  return runLegacyHandler(request, handler);
}
