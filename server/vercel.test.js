import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import search from "../api/search.js";
import media from "../api/media.js";

test("Vercel functions expose the existing API handlers", async (t) => {
  const server = createServer((req, res) => {
    if (req.url.startsWith("/api/search")) return search(req, res);
    if (req.url.startsWith("/api/media")) return media(req, res);
    res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const path of ["/api/search", "/api/media"]) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 400);
    assert.match(response.headers.get("content-type"), /application\/json/);
  }
  const response = await fetch(`${base}/api/search`, { method: "POST" });
  assert.equal(response.status, 405);
});
