import handler from "../../api/webhook.js";
import { runLegacyHandler } from "../_shared/legacy-adapter.js";

export async function onRequest({ request, waitUntil }) {
  return runLegacyHandler(request, handler, { waitUntil });
}
