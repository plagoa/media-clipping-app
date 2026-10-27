import { load } from "cheerio";
import { getSearchUrl, sourceDefinitions } from "../src/data/sourceLibrary.js";
import { feedMetadata } from "./metadata.js";

function parseGoogleNews(xml, source, now) {
  const $ = load(xml, { xmlMode: true });
  if (!$("rss > channel").length) {
    throw new Error("The Google News feed could not be understood.");
  }

  const results = [];
  const seen = new Set();
  $("rss > channel > item").each((_, item) => {
    const element = $(item);
    const publisher = element.children("source").first().text().trim();
    const fullTitle = element.children("title").first().text().trim();
    const suffix = ` - ${publisher}`;
    const title =
      publisher && fullTitle.endsWith(suffix)
        ? fullTitle.slice(0, -suffix.length).trim()
        : fullTitle;
    const rawUrl = element.children("link").first().text().trim();
    const publishedTime = Date.parse(
      element.children("pubDate").first().text(),
    );
    if (
      !title ||
      !rawUrl ||
      !Number.isFinite(publishedTime) ||
      publishedTime < now - 7 * 24 * 60 * 60 * 1000 ||
      publishedTime > now
    )
      return;

    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return;
    }
    if (
      url.protocol !== "https:" ||
      url.hostname !== "news.google.com" ||
      !/^\/(?:rss\/)?articles\//.test(url.pathname)
    )
      return;
    url.hash = "";
    if (seen.has(url.href)) return;
    seen.add(url.href);

    let publisherDomain = "";
    try {
      const publisherUrl = new URL(
        element.children("source").first().attr("url"),
      );
      if (["https:", "http:"].includes(publisherUrl.protocol))
        publisherDomain = publisherUrl.hostname;
    } catch {
      // Some results do not include a publisher URL.
    }
    results.push({
      id: `${source.id}:${url.href}`,
      sourceId: source.id,
      publisherName: publisher || "Unknown publisher",
      publisherDomain,
      title,
      snippet: "",
      url: url.href,
      publishedAt: new Date(publishedTime).toISOString(),
      ...feedMetadata(element, $),
    });
  });
  if (
    $("rss > channel > item").length &&
    $("rss > channel > item")
      .toArray()
      .every(
        (item) =>
          !$(item).children("title").length ||
          !$(item).children("link").length ||
          !$(item).children("pubDate").length,
      )
  ) {
    throw new Error("The Google News results could not be understood.");
  }
  return results;
}

export async function searchSource(
  source,
  term,
  fetchImpl = fetch,
  now = Date.now(),
) {
  if (source?.id !== "googleNews" || source !== sourceDefinitions.googleNews) {
    throw new Error("Unsupported search source.");
  }
  const response = await fetchImpl(getSearchUrl(source, term), {
    headers: {
      "User-Agent": "MediaClippingApp/1.0",
      Accept: "application/rss+xml, application/xml, text/xml",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(`The source returned HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type") || "";
  if (!/(?:application|text)\/(?:rss\+xml|xml)/i.test(contentType)) {
    throw new Error("Google News did not return an RSS feed.");
  }
  return parseGoogleNews(await response.text(), source, now);
}

export async function searchHandler(req, res, next) {
  const requestUrl = new URL(req.url, "http://localhost");
  if (requestUrl.pathname !== "/api/search") return next();
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" }).end();
    return;
  }
  const sourceId = requestUrl.searchParams.get("source");
  const source = Object.hasOwn(sourceDefinitions, sourceId)
    ? sourceDefinitions[sourceId]
    : null;
  const term = requestUrl.searchParams.get("q")?.trim();
  if (!source || !term || term.length > 200) {
    res.writeHead(400, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        error: "A valid source and search term are required.",
      }),
    );
    return;
  }
  try {
    const results = await searchSource(source, term);
    res
      .writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      })
      .end(JSON.stringify({ results }));
  } catch (error) {
    res
      .writeHead(502, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      })
      .end(
        JSON.stringify({
          error: error.message || "The source is unavailable.",
        }),
      );
  }
}
