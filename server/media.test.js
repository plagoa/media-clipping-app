import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { discoverMedia, inspectGoogleResult, mediaHandler } from "./media.js";
import { safeImageUrl } from "./metadata.js";

const html = (body) =>
  new Response(body, { headers: { "content-type": "text/html" } });

test("extracts supported players and removes arbitrary parameters", async () => {
  const found = await discoverMedia(
    "https://www.publico.pt/article",
    async () =>
      html(`
    <iframe src="https://omny.fm/shows/program/episode/embed?autoplay=1"></iframe>
    <iframe src="https://omny.fm/shows/program/episode/embed?another=1"></iframe>
    <iframe data-src="https://www.youtube.com/embed/abcdefghijk?autoplay=1"></iframe>
    <iframe src="https://open.spotify.com/embed/episode/Abc123?autoplay=1"></iframe>
    <iframe src="https://evil.example/embed/abcdefghijk"></iframe>`),
  );
  assert.deepEqual(found, [
    {
      type: "audio",
      provider: "Omny",
      url: "https://omny.fm/shows/program/episode/embed",
    },
    {
      type: "video",
      provider: "YouTube",
      url: "https://www.youtube.com/embed/abcdefghijk",
    },
    {
      type: "audio",
      provider: "Spotify",
      url: "https://open.spotify.com/embed/episode/Abc123",
    },
  ]);
});

test("returns no media for unsupported players or absent embeds", async () => {
  assert.deepEqual(
    await discoverMedia("https://expresso.pt/a", async () =>
      html(
        '<iframe src="https://youtube.com.evil.example/embed/abcdefghijk"></iframe>',
      ),
    ),
    [],
  );
});

test("rejects unsafe article URLs before fetching", async () => {
  for (const url of [
    "http://www.publico.pt/x",
    "https://www.publico.pt:444/x",
    "https://127.0.0.1/x",
    "https://user@www.publico.pt/x",
  ]) {
    await assert.rejects(
      discoverMedia(url, () => {
        throw new Error("must not fetch");
      }),
      /Unsupported article URL/,
    );
  }
});

test("follows public publisher redirects and rejects unsafe ones", async () => {
  let requests = 0;
  const media = await discoverMedia(
    "https://www.publico.pt/123",
    async (url, options) => {
      assert.equal(options.redirect, "manual");
      requests++;
      if (requests === 1)
        return new Response(null, {
          status: 301,
          headers: { location: "https://anotherpublisher.example.com/article" },
        });
      assert.equal(url, "https://anotherpublisher.example.com/article");
      return html('<iframe src="https://omny.fm/shows/a/b/embed"></iframe>');
    },
  );
  assert.equal(media.length, 1);
  await assert.rejects(
    discoverMedia(
      "https://www.publico.pt/123",
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/" },
        }),
    ),
    /unsafe URL/,
  );
});

test("rejects non-HTML and oversized article responses", async () => {
  await assert.rejects(
    discoverMedia(
      "https://www.publico.pt/a",
      async () =>
        new Response("x", { headers: { "content-type": "application/json" } }),
    ),
    /HTML/,
  );
  await assert.rejects(
    discoverMedia("https://www.publico.pt/a", async () =>
      html("x".repeat(2 * 1024 * 1024 + 1)),
    ),
    /too large/,
  );
});

test("media endpoint validates source, URLs and methods", async (t) => {
  const server = createServer((req, res) =>
    mediaHandler(req, res, () => res.writeHead(404).end()),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/media`;
  assert.equal(
    (
      await fetch(
        `${base}?source=constructor&url=https%3A%2F%2Fwww.publico.pt%2F`,
      )
    ).status,
    400,
  );
  assert.equal(
    (await fetch(`${base}?source=publico&url=http%3A%2F%2F127.0.0.1%2F`))
      .status,
    400,
  );
  assert.equal((await fetch(base, { method: "POST" })).status, 405);
});

test("media endpoint distinguishes unavailable results from actual errors", async (t) => {
  let mode = "consent";
  const server = createServer((req, res) =>
    mediaHandler(
      req,
      res,
      () => res.writeHead(404).end(),
      async (url) => {
        if (mode === "broken") throw new Error("unexpected failure");
        if (mode === "consent")
          return new Response(null, {
            status: 302,
            headers: { location: "https://consent.google.com/" },
          });
        if (mode === "opaque") return html("Google News page, no redirect");
        if (mode === "publisher-blocked") {
          if (url.startsWith("https://news.google.com/"))
            return new Response(null, {
              status: 302,
              headers: { location: "https://publisher.example.com/article" },
            });
          return new Response("Forbidden", { status: 403 });
        }
        if (url.startsWith("https://news.google.com/"))
          return new Response(null, {
            status: 302,
            headers: { location: "https://publisher.example.com/article" },
          });
        return html(
          '<meta property="og:image" content="/photo.jpg"><video></video>',
        );
      },
    ),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api/media?source=googleNews&url=${encodeURIComponent("https://news.google.com/articles/example")}`;
  for (const [value, reason] of [
    ["consent", "google_consent"],
    ["opaque", "google_opaque"],
    ["publisher-blocked", "article_unavailable"],
  ]) {
    mode = value;
    const response = await fetch(base);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "unavailable", reason });
  }
  mode = "success";
  const success = await fetch(base);
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), {
    status: "checked",
    media: [],
    mediaTypes: ["video"],
    imageUrl: "https://publisher.example.com/photo.jpg",
  });
  mode = "broken";
  assert.equal((await fetch(base)).status, 502);
});

test("inspects a direct Google News redirect to any public publisher", async () => {
  const urls = [];
  const result = await inspectGoogleResult(
    "https://news.google.com/rss/articles/abc",
    async (url, options) => {
      urls.push(url);
      assert.equal(options.redirect, "manual");
      if (urls.length === 1)
        return new Response(null, {
          status: 302,
          headers: { location: "https://news.example.com/noticias/example" },
        });
      return html(
        `<meta property="og:image" content="/photo.jpg"><script>new RTPPlayer({ mediaType: "video" });</script><audio></audio>`,
      );
    },
  );
  assert.deepEqual(urls, [
    "https://news.google.com/rss/articles/abc",
    "https://news.example.com/noticias/example",
  ]);
  assert.equal(result.imageUrl, "https://news.example.com/photo.jpg");
  assert.deepEqual(result.mediaTypes, ["audio", "video"]);
  assert.deepEqual(result.media, []);
});

test("does not follow consent or unsafe redirects", async () => {
  for (const location of [
    "https://consent.google.com/",
    "http://127.0.0.1/",
    "https://www.rtp.pt:444/a",
  ]) {
    let calls = 0;
    await assert.rejects(
      inspectGoogleResult(
        "https://news.google.com/rss/articles/abc",
        async () => {
          calls++;
          return new Response(null, { status: 302, headers: { location } });
        },
      ),
      /consent|unsafe URL/,
    );
    assert.equal(calls, 1);
  }
  await assert.rejects(
    inspectGoogleResult("https://news.google.com/rss/articles/abc", async () =>
      html("no redirect"),
    ),
    /did not provide/,
  );
  await assert.rejects(
    inspectGoogleResult("https://evil.example/", () => {
      throw new Error("must not fetch");
    }),
    /Unsupported/,
  );
});

test("rejects unsafe image URLs", () => {
  for (const value of [
    undefined,
    "",
    "javascript:alert(1)",
    "http://images.example.com/a",
    "https://127.0.0.1/a",
    "https://[::1]/a",
    "https://localhost/a",
    "https://host.local/a",
    "https://host.local./a",
    "https://user@images.example.com/a",
    "https://images.example.com:444/a",
  ]) {
    assert.equal(safeImageUrl(value, "https://www.rtp.pt/a"), null);
  }
  assert.equal(
    safeImageUrl("/a.jpg", "https://www.rtp.pt/article"),
    "https://www.rtp.pt/a.jpg",
  );
});

test("extracts JSON-LD media types and images", async () => {
  let calls = 0;
  const result = await inspectGoogleResult(
    "https://news.google.com/articles/abc",
    async () => {
      if (calls++ === 0)
        return new Response(null, {
          status: 302,
          headers: { location: "https://www.rtp.pt/article" },
        });
      return html(
        `<script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","image":{"url":"/news.jpg"}},{"@type":"https://schema.org/VideoObject"},{"@type":["AudioObject"]}]}</script><script type="application/ld+json">invalid</script>`,
      );
    },
  );
  assert.deepEqual(result.mediaTypes, ["video", "audio"]);
  assert.equal(result.imageUrl, "https://www.rtp.pt/news.jpg");
});

test("decodes an opaque Google page after ordinary consent redirects", async () => {
  const calls = [];
  const result = await inspectGoogleResult(
    "https://news.google.com/rss/articles/abc",
    async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1)
        return new Response(null, {
          status: 302,
          headers: {
            location: "https://consent.google.com/m?continue=example",
          },
        });
      if (calls.length === 2)
        return new Response(null, {
          status: 303,
          headers: {
            location: "https://news.google.com/rss/articles/abc?after=1",
          },
        });
      if (calls.length === 3)
        return html(`<c-wiz data-p='%.@.1,2,3,4,5,6,7,8]'></c-wiz>`);
      if (calls.length === 4) {
        assert.equal(
          url,
          "https://news.google.com/_/DotsSplashUi/data/batchexecute",
        );
        assert.equal(options.method, "POST");
        const request = JSON.parse(
          new URLSearchParams(options.body).get("f.req"),
        );
        assert.equal(request[0][0][0], "Fbv4je");
        assert.deepEqual(JSON.parse(request[0][0][1]), [
          "garturlreq",
          1,
          2,
          7,
          8,
        ]);
        return new Response(
          `)]}'\n\n${JSON.stringify([["wrb.fr", "Fbv4je", JSON.stringify(["garturlres", "https://publisher.example.com/a"])]])}`,
          { headers: { "content-type": "application/json" } },
        );
      }
      assert.equal(url, "https://publisher.example.com/a");
      return html('<meta property="og:image" content="/cover.jpg">');
    },
  );
  assert.equal(result.imageUrl, "https://publisher.example.com/cover.jpg");
  assert.equal(calls.length, 5);
});

test("does not submit a consent page or fetch unsafe decoded links", async () => {
  let calls = 0;
  await assert.rejects(
    inspectGoogleResult("https://news.google.com/articles/abc", async () => {
      calls++;
      return calls === 1
        ? new Response(null, {
            status: 302,
            headers: { location: "https://consent.google.com/m" },
          })
        : html("Consent required");
    }),
    /requires consent/,
  );
  assert.equal(calls, 2);
  for (const target of [
    "http://127.0.0.1/",
    "https://localhost/a",
    "https://news.google.com/articles/other",
  ]) {
    calls = 0;
    await assert.rejects(
      inspectGoogleResult("https://news.google.com/articles/abc", async () => {
        calls++;
        if (calls === 1)
          return html(`<c-wiz data-p='%.@.1,2,3,4,5,6,7,8]'></c-wiz>`);
        return new Response(
          `)]}'\n${JSON.stringify([["wrb.fr", "Fbv4je", JSON.stringify(["garturlres", target])]])}`,
          { headers: { "content-type": "application/json" } },
        );
      }),
      /unsupported article link/,
    );
    assert.equal(calls, 2);
  }
});

test("uses metadata for supported players and thumbnail images, not arbitrary streams", async () => {
  let calls = 0;
  const result = await inspectGoogleResult(
    "https://news.google.com/articles/abc",
    async () => {
      if (calls++ === 0)
        return new Response(null, {
          status: 302,
          headers: { location: "https://publisher.example.com/article" },
        });
      return html(
        `<meta name="twitter:player" content="https://www.youtube.com/embed/abcdefghijk?autoplay=1"><video src="https://example.com/master.m3u8" poster="/poster.jpg"></video><script type="application/ld+json">{"@type":"AudioObject","embedUrl":"https://open.spotify.com/embed/episode/Abc123?autoplay=1","thumbnailUrl":"/thumb.jpg","contentUrl":"https://example.com/audio.mp3"}</script>`,
      );
    },
  );
  assert.equal(result.imageUrl, "https://publisher.example.com/thumb.jpg");
  assert.deepEqual(result.mediaTypes, ["video", "audio"]);
  assert.deepEqual(
    result.media.map((item) => item.url),
    [
      "https://www.youtube.com/embed/abcdefghijk",
      "https://open.spotify.com/embed/episode/Abc123",
    ],
  );
});
