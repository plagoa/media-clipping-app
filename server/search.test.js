import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { searchHandler, searchSource } from "./search.js";
import { sourceDefinitions } from "../src/data/sourceLibrary.js";

const rss = (body) =>
  new Response(body, { headers: { "Content-Type": "application/rss+xml" } });

test("discovers Google News publishers from the last seven days", async () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  let requestedUrl;
  const item = (title, date, link, publisher = "Novo Jornal") =>
    `<item><title>${title} - ${publisher}</title><link>${link}</link><pubDate>${date}</pubDate><source url="https://novojornal.pt">${publisher}</source></item>`;
  const xml = `<?xml version="1.0"?><rss><channel>
    ${item("Título &amp; notícia", "Tue, 27 Oct 2026 10:00:00 GMT", "https://news.google.com/rss/articles/abc?oc=5")}
    ${item("Duplicado", "Tue, 27 Oct 2026 10:00:00 GMT", "https://news.google.com/rss/articles/abc?oc=5")}
    ${item("Antigo", "Tue, 20 Oct 2026 11:59:59 GMT", "https://news.google.com/rss/articles/old")}
    ${item("Futuro", "Tue, 27 Oct 2026 12:00:01 GMT", "https://news.google.com/rss/articles/future")}
    ${item("Link inválido", "Tue, 27 Oct 2026 10:00:00 GMT", "https://evil.example/attack")}
  </channel></rss>`;
  const results = await searchSource(
    sourceDefinitions.googleNews,
    "clima & energia",
    async (url) => {
      requestedUrl = url;
      return rss(xml);
    },
    now,
  );
  assert.equal(
    requestedUrl,
    "https://news.google.com/rss/search?q=clima%20%26%20energia%20when%3A7d&hl=pt-PT&gl=PT&ceid=PT%3Apt-150",
  );
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Título & notícia");
  assert.equal(results[0].publisherName, "Novo Jornal");
  assert.equal(results[0].publisherDomain, "novojornal.pt");
  assert.equal(results[0].publishedAt, "2026-10-27T10:00:00.000Z");
  assert.equal(results[0].url, "https://news.google.com/rss/articles/abc?oc=5");
});

test("handles empty feeds, malformed feeds, and Google News errors", async () => {
  assert.deepEqual(
    await searchSource(sourceDefinitions.googleNews, "test", async () =>
      rss("<rss><channel></channel></rss>"),
    ),
    [],
  );
  await assert.rejects(
    searchSource(sourceDefinitions.googleNews, "test", async () =>
      rss("<html></html>"),
    ),
    /could not be understood/,
  );
  await assert.rejects(
    searchSource(
      sourceDefinitions.googleNews,
      "test",
      async () =>
        new Response("Challenge", { headers: { "Content-Type": "text/html" } }),
    ),
    /did not return an RSS feed/,
  );
  await assert.rejects(
    searchSource(
      sourceDefinitions.googleNews,
      "test",
      async () => new Response("Rate limited", { status: 429 }),
    ),
    /HTTP 429/,
  );
});

test("extracts optional feed image and media indicators without trusting unsafe images", async () => {
  const now = Date.parse("2026-10-27T12:00:00Z");
  const xml = `<rss xmlns:media="http://search.yahoo.com/mrss/"><channel>
    <item><title>News - RTP</title><link>https://news.google.com/rss/articles/abc</link>
    <pubDate>Tue, 27 Oct 2026 10:00:00 GMT</pubDate><source url="https://rtp.pt">RTP</source>
    <media:thumbnail url="http://127.0.0.1/image.jpg" />
    <media:content medium="image" url="https://images.example.com/photo.jpg#fragment" />
    <enclosure type="audio/mpeg" url="https://example.com/audio.mp3" />
    <media:content medium="video" url="https://example.com/video.mp4" />
    </item></channel></rss>`;
  const [result] = await searchSource(
    sourceDefinitions.googleNews,
    "test",
    async () => rss(xml),
    now,
  );
  assert.equal(result.imageUrl, "https://images.example.com/photo.jpg");
  assert.deepEqual(result.mediaTypes, ["audio", "video"]);
});

test("the API rejects removed sources and invalid requests", async (t) => {
  const server = createServer((req, res) =>
    searchHandler(req, res, () => res.writeHead(404).end()),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(Object.keys(sourceDefinitions), ["googleNews"]);
  for (const source of ["publico", "expresso", "__proto__"]) {
    assert.equal(
      (await fetch(`${base}/api/search?source=${source}&q=test`)).status,
      400,
    );
  }
  assert.equal(
    (await fetch(`${base}/api/search?source=googleNews&q=%20`)).status,
    400,
  );
  assert.equal(
    (
      await fetch(`${base}/api/search?source=googleNews&q=test`, {
        method: "POST",
      })
    ).status,
    405,
  );
  assert.equal((await fetch(`${base}/other`)).status, 404);
  await assert.rejects(
    searchSource(
      { id: "expresso", searchUrl: "https://expresso.pt/?q={term}" },
      "test",
      () => {
        throw new Error("must not fetch");
      },
    ),
    /Unsupported search source/,
  );
});
