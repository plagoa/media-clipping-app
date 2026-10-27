import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { test } from "node:test";
import { resolvePublicHost, safeFetch } from "./safeFetch.js";

const resolver = (answers) => async () =>
  answers.map((address) => ({
    address,
    family: address.includes(":") ? 6 : 4,
  }));

test("refuses private, special-use, mapped, and mixed DNS answers", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "192.0.2.1",
    "::1",
    "fc00::1",
    "::ffff:127.0.0.1",
    "64:ff9b::a00:1",
    "not-an-ip",
  ]) {
    await assert.rejects(
      resolvePublicHost("publisher.example.com", resolver([address])),
      /public addresses/,
    );
    await assert.rejects(
      resolvePublicHost(
        "publisher.example.com",
        resolver(["8.8.8.8", address]),
      ),
      /public addresses/,
    );
  }
  await assert.rejects(
    resolvePublicHost("publisher.example.com", resolver([])),
    /public addresses/,
  );
  assert.equal(
    (await resolvePublicHost("publisher.example.com", resolver(["8.8.8.8"])))
      .address,
    "8.8.8.8",
  );
});

test("pins the validated address to the TLS request", async () => {
  let requested = false;
  const response = await safeFetch("https://publisher.example.com/article", {
    resolver: resolver(["8.8.8.8"]),
    requestImpl(url, options, onResponse) {
      requested = true;
      assert.equal(url.hostname, "publisher.example.com");
      assert.equal(options.agent, false);
      options.lookup(url.hostname, {}, (error, address, family) => {
        assert.ifError(error);
        assert.equal(address, "8.8.8.8");
        assert.equal(family, 4);
      });
      options.lookup(url.hostname, { all: true }, (error, addresses) => {
        assert.ifError(error);
        assert.deepEqual(addresses, [{ address: "8.8.8.8", family: 4 }]);
      });
      const req = new EventEmitter();
      req.end = () => {
        const body = Readable.from([Buffer.from("hello")]);
        body.statusCode = 200;
        body.headers = { "content-type": "text/html" };
        onResponse(body);
      };
      return req;
    },
  });
  assert.equal(requested, true);
  assert.equal(await response.text(), "hello");
  await assert.rejects(
    safeFetch("https://publisher.example.com/article", {
      resolver: resolver(["127.0.0.1"]),
      requestImpl() {
        throw new Error("must not connect");
      },
    }),
    /public addresses/,
  );
});

test("only allows a bounded POST to the Google decoding endpoint", async () => {
  for (const [url, options] of [
    ["https://publisher.example.com/", { method: "POST", body: "x" }],
    [
      "https://news.google.com/_/DotsSplashUi/data/batchexecute?x=1",
      { method: "POST", body: "x" },
    ],
    [
      "https://news.google.com/_/DotsSplashUi/data/batchexecute",
      { method: "POST", body: "x".repeat(65537) },
    ],
    ["https://news.google.com/", { method: "GET", body: "x" }],
  ]) {
    await assert.rejects(safeFetch(url, options), /Unsupported request/);
  }
  let written;
  const response = await safeFetch(
    "https://news.google.com/_/DotsSplashUi/data/batchexecute",
    {
      method: "POST",
      body: "f.req=test",
      resolver: resolver(["8.8.8.8"]),
      requestImpl(url, options, onResponse) {
        assert.equal(options.method, "POST");
        const req = new EventEmitter();
        req.end = (body) => {
          written = body;
          const stream = Readable.from([Buffer.from("ok")]);
          stream.statusCode = 200;
          stream.headers = {};
          onResponse(stream);
        };
        return req;
      },
    },
  );
  assert.equal(written, "f.req=test");
  assert.equal(await response.text(), "ok");
});
