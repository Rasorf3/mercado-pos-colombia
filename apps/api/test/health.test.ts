import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

test("GET /health devuelve el estado de la API", async () => {
  const app = buildApp();

  const response = await app.inject({ method: "GET", url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: "ok",
    service: "api",
    timestamp: response.json().timestamp
  });
  assert.match(response.json().timestamp, /^\d{4}-\d{2}-\d{2}T/);

  await app.close();
});
