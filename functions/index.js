import { onRequest } from "firebase-functions/v2/https";
import { app } from "../server.js";

export const api = onRequest(
  {
    region: "southamerica-east1",
    timeoutSeconds: 300,
    memory: "512MiB"
  },
  app
);