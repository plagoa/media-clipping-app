import assert from "node:assert/strict";
import { test } from "node:test";
import { createMediaLookupQueue } from "./mediaLookup.js";

const response = (value) => ({ ok: true, json: async () => ({ value }) });
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("dispatches automatically with a concurrency limit and cancels queued work", async () => {
  const started = [];
  const releases = [];
  const lookup = createMediaLookupQueue(2, (url, { signal }) => {
    started.push({ url, signal });
    return new Promise((resolve, reject) => {
      releases.push(resolve);
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  });
  const controllers = Array.from({ length: 4 }, () => new AbortController());
  const checks = controllers.map((controller, index) =>
    lookup(
      "googleNews",
      `https://news.google.com/articles/${index}`,
      controller.signal,
    ),
  );
  const cancelled = assert.rejects(checks[2], { name: "AbortError" });
  await tick();
  assert.equal(started.length, 2);
  controllers[2].abort();
  await cancelled;
  releases[0](response("first"));
  assert.deepEqual(await checks[0], { value: "first" });
  await tick();
  assert.equal(started.length, 3);
  assert.match(started[2].url, /articles%2F3/);
  controllers[1].abort();
  await assert.rejects(checks[1], { name: "AbortError" });
  releases[2](response("last"));
  assert.deepEqual(await checks[3], { value: "last" });
});

test("does not start aborted work and recovers after a failed request", async () => {
  let calls = 0;
  const lookup = createMediaLookupQueue(1, async () => {
    calls++;
    return calls === 1 ? { ok: false } : response("ok");
  });
  const cancelled = new AbortController();
  const aborted = lookup(
    "googleNews",
    "https://news.google.com/articles/a",
    cancelled.signal,
  );
  cancelled.abort();
  await assert.rejects(aborted, { name: "AbortError" });
  assert.equal(calls, 0);
  const signal = new AbortController().signal;
  await assert.rejects(
    lookup("googleNews", "https://news.google.com/articles/b", signal),
    /lookup failed/,
  );
  assert.deepEqual(
    await lookup("googleNews", "https://news.google.com/articles/c", signal),
    { value: "ok" },
  );
});
