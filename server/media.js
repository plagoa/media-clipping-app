import { load } from "cheerio";
import { safeImageUrl } from "./metadata.js";
import { safeFetch, safePublicUrl } from "./safeFetch.js";

const maxBytes = 2 * 1024 * 1024;

class InspectionUnavailable extends Error {
  constructor(reason, message) {
    super(message);
    this.reason = reason;
  }
}

function supportedEmbed(value, base) {
  try {
    const url = new URL(value, base);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return null;
    let provider;
    let kind;
    if (
      ["www.youtube.com", "www.youtube-nocookie.com"].includes(url.hostname) &&
      /^\/embed\/[\w-]{11}\/?$/.test(url.pathname)
    ) {
      provider = "YouTube";
      kind = "video";
    } else if (
      url.hostname === "open.spotify.com" &&
      /^\/embed\/(episode|show)\/[a-zA-Z0-9]+\/?$/.test(url.pathname)
    ) {
      provider = "Spotify";
      kind = "audio";
    } else if (
      url.hostname === "omny.fm" &&
      /^\/shows\/[\w%-]+\/[\w%-]+\/embed\/?$/.test(url.pathname)
    ) {
      provider = "Omny";
      kind = "audio";
    } else {
      return null;
    }
    // Drop publisher-provided query parameters; construct known, non-autoplaying embeds.
    url.search = "";
    url.hash = "";
    return { type: kind, provider, url: url.href };
  } catch {
    return null;
  }
}

async function readHtml(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let html = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes)
        throw new InspectionUnavailable(
          "article_unavailable",
          "The article is too large to inspect.",
        );
      html += decoder.decode(value, { stream: true });
    }
    return html + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function inspectArticle(articleUrl, fetchImpl, signal) {
  let url = safePublicUrl(articleUrl);
  if (!url) throw new Error("Unsupported article URL.");
  let response;
  for (let redirects = 0; redirects <= 3; redirects++) {
    response = await fetchImpl(url.href, {
      redirect: "manual",
      headers: { "User-Agent": "MediaClippingApp/1.0", Accept: "text/html" },
      signal,
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location || redirects === 3)
      throw new Error(
        "The article redirected too many times or to an invalid URL.",
      );
    let target;
    try {
      target = new URL(location, url);
    } catch {
      throw new Error("The article redirected to an invalid URL.");
    }
    url = safePublicUrl(target.href);
    if (!url) throw new Error("The article redirected to an unsafe URL.");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new InspectionUnavailable(
      "article_unavailable",
      `The article returned HTTP ${response.status}.`,
    );
  }
  if (
    response.headers.get("content-encoding") &&
    response.headers.get("content-encoding") !== "identity"
  ) {
    await response.body?.cancel();
    throw new InspectionUnavailable(
      "article_unavailable",
      "The article returned an unsupported encoding.",
    );
  }
  if (!response.headers.get("content-type")?.includes("text/html")) {
    await response.body?.cancel();
    throw new InspectionUnavailable(
      "article_unavailable",
      "The article did not return an HTML page.",
    );
  }
  const $ = load(await readHtml(response));
  const media = [];
  const seen = new Set();
  const mediaTypes = new Set();
  function addEmbed(value) {
    if (typeof value !== "string" || !value.trim()) return;
    const embed = supportedEmbed(value, url);
    if (embed && !seen.has(embed.url)) {
      seen.add(embed.url);
      media.push(embed);
      mediaTypes.add(embed.type);
    }
  }
  $("iframe[src], iframe[data-src]").each((_, element) => {
    addEmbed($(element).attr("src") || $(element).attr("data-src"));
  });
  $(
    "meta[property='og:video'], meta[property='og:video:url'], meta[property='og:video:secure_url'], meta[property='og:audio'], meta[property='og:audio:url'], meta[property='og:audio:secure_url'], meta[name='twitter:player'], meta[property='twitter:player']",
  ).each((_, element) => {
    addEmbed($(element).attr("content"));
  });
  if (
    $(
      "video, meta[property='og:video'], meta[property='og:video:url'], meta[property='og:video:secure_url']",
    ).length
  )
    mediaTypes.add("video");
  if (
    $(
      "audio, meta[property='og:audio'], meta[property='og:audio:url'], meta[property='og:audio:secure_url']",
    ).length
  )
    mediaTypes.add("audio");
  const structuredImages = [];
  function inspectStructuredData(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 12) return;
    if (Array.isArray(value)) {
      value.forEach((item) => inspectStructuredData(item, depth + 1));
      return;
    }
    const types = Array.isArray(value["@type"])
      ? value["@type"]
      : [value["@type"]];
    if (
      types.some(
        (type) =>
          typeof type === "string" && /(?:^|\/)VideoObject$/i.test(type),
      )
    )
      mediaTypes.add("video");
    if (
      types.some(
        (type) =>
          typeof type === "string" && /(?:^|\/)AudioObject$/i.test(type),
      )
    )
      mediaTypes.add("audio");
    if (
      types.some(
        (type) =>
          typeof type === "string" &&
          /(?:^|\/)(?:VideoObject|AudioObject)$/i.test(type),
      )
    )
      addEmbed(value.embedUrl);
    const images = [value.image, value.thumbnailUrl, value.thumbnail].flat();
    for (const image of images) {
      if (typeof image === "string") structuredImages.push(image);
      else if (image && typeof image === "object")
        structuredImages.push(image.url || image.contentUrl);
    }
    Object.values(value).forEach((item) =>
      inspectStructuredData(item, depth + 1),
    );
  }
  $("script[type='application/ld+json']").each((_, script) => {
    try {
      inspectStructuredData(JSON.parse($(script).text()));
    } catch {
      // Invalid structured data does not make the article uninspectable.
    }
  });
  $("script:not([src])").each((_, script) => {
    const text = $(script).text();
    if (/\bmediaType\s*:\s*["']video["']/i.test(text)) mediaTypes.add("video");
    if (/\bmediaType\s*:\s*["']audio["']/i.test(text)) mediaTypes.add("audio");
  });
  const imageCandidates = $(
    "meta[property='og:image'], meta[property='og:image:url'], meta[property='og:image:secure_url'], meta[name='twitter:image'], meta[name='twitter:image:src'], meta[itemprop='image']",
  )
    .toArray()
    .map((node) => $(node).attr("content"));
  const imageUrl =
    [
      ...imageCandidates,
      ...structuredImages,
      ...$("video[poster]")
        .toArray()
        .map((node) => $(node).attr("poster")),
    ]
      .map((value) => safeImageUrl(value, url))
      .find(Boolean) || null;
  return { media: media.slice(0, 3), mediaTypes: [...mediaTypes], imageUrl };
}

export async function discoverMedia(articleUrl, fetchImpl = safeFetch) {
  return (
    await inspectArticle(articleUrl, fetchImpl, AbortSignal.timeout(12000))
  ).media;
}

function safeGoogleUrl(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "news.google.com" ||
      url.username ||
      url.password ||
      url.port ||
      !/^\/(?:rss\/)?articles\//.test(url.pathname)
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

async function decodeGooglePage(response, fetchImpl, signal) {
  if (!response.headers.get("content-type")?.includes("text/html")) {
    await response.body?.cancel();
    throw new InspectionUnavailable(
      "google_opaque",
      "Google News did not provide a direct article link.",
    );
  }
  const $ = load(await readHtml(response));
  const data = $("c-wiz[data-p]").attr("data-p");
  let request;
  try {
    if (!data?.startsWith("%.@.") || data.length > 40000) throw new Error();
    const values = JSON.parse(data.replace("%.@.", '["garturlreq",'));
    if (!Array.isArray(values) || values.length < 7) throw new Error();
    request = JSON.stringify([...values.slice(0, -6), ...values.slice(-2)]);
  } catch {
    throw new InspectionUnavailable(
      "google_opaque",
      "Google News did not provide a direct article link.",
    );
  }
  const body = new URLSearchParams({
    "f.req": JSON.stringify([[["Fbv4je", request, "null", "generic"]]]),
  }).toString();
  if (Buffer.byteLength(body) > 65536)
    throw new InspectionUnavailable(
      "google_opaque",
      "Google News decoding data is too large.",
    );
  const decoded = await fetchImpl(
    "https://news.google.com/_/DotsSplashUi/data/batchexecute",
    {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Accept: "application/json",
      },
      body,
      signal,
    },
  );
  if (
    !decoded.ok ||
    !decoded.headers.get("content-type")?.includes("application/json")
  ) {
    await decoded.body?.cancel();
    throw new InspectionUnavailable(
      "google_opaque",
      "Google News could not decode the article link.",
    );
  }
  const text = await readHtml(decoded);
  let target;
  try {
    const envelope = JSON.parse(text.replace(/^\)\]\}'\s*/, ""));
    const result = envelope.find(
      (entry) =>
        Array.isArray(entry) && entry[0] === "wrb.fr" && entry[1] === "Fbv4je",
    );
    const values = JSON.parse(result[2]);
    if (values[0] !== "garturlres" || typeof values[1] !== "string")
      throw new Error();
    target = safePublicUrl(values[1]);
  } catch {
    throw new InspectionUnavailable(
      "google_opaque",
      "Google News could not decode the article link.",
    );
  }
  if (
    !target ||
    target.hostname === "news.google.com" ||
    target.hostname === "consent.google.com"
  )
    throw new InspectionUnavailable(
      "google_opaque",
      "Google News returned an unsupported article link.",
    );
  return target.href;
}

export async function inspectGoogleResult(
  value,
  fetchImpl = safeFetch,
  signal = AbortSignal.timeout(12000),
) {
  let url = safeGoogleUrl(value);
  if (!url) throw new Error("Unsupported Google News URL.");
  for (let redirects = 0; redirects < 6; redirects++) {
    const response = await fetchImpl(url.href, {
      redirect: "manual",
      headers: { "User-Agent": "MediaClippingApp/1.0", Accept: "text/html" },
      signal,
    });
    const location = response.headers.get("location");
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
      if (url.hostname === "consent.google.com") {
        await response.body?.cancel();
        throw new InspectionUnavailable(
          "google_consent",
          "Google News requires consent before opening this article.",
        );
      }
      if (response.ok)
        return inspectArticle(
          await decodeGooglePage(response, fetchImpl, signal),
          fetchImpl,
          signal,
        );
      await response.body?.cancel();
      throw new InspectionUnavailable(
        "google_unavailable",
        "Google News did not provide a direct article redirect.",
      );
    }
    await response.body?.cancel();
    let target;
    try {
      target = new URL(location, url);
    } catch {
      throw new Error("Google News returned an invalid redirect.");
    }
    const googleUrl = safeGoogleUrl(target.href);
    if (googleUrl) {
      url = googleUrl;
      continue;
    }
    if (
      url.hostname !== "consent.google.com" &&
      target.protocol === "https:" &&
      target.hostname === "consent.google.com" &&
      target.pathname === "/m" &&
      !target.username &&
      !target.password &&
      !target.port
    ) {
      // Follow the ordinary GET redirect only; never submit or dismiss a consent page.
      url = target;
      continue;
    }
    if (
      url.hostname === "consent.google.com" ||
      target.hostname === "consent.google.com"
    )
      throw new InspectionUnavailable(
        "google_consent",
        "Google News requires consent before opening this article.",
      );
    if (!safePublicUrl(target.href))
      throw new Error("Google News redirected to an unsafe URL.");
    return inspectArticle(target.href, fetchImpl, signal);
  }
  throw new Error("Google News redirected too many times.");
}

export async function mediaHandler(req, res, next, fetchImpl = safeFetch) {
  const requestUrl = new URL(req.url, "http://localhost");
  if (requestUrl.pathname !== "/api/media") return next();
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" }).end();
    return;
  }
  const source = requestUrl.searchParams.get("source");
  const article = requestUrl.searchParams.get("url");
  if (
    !article ||
    article.length > 2048 ||
    source !== "googleNews" ||
    !safeGoogleUrl(article)
  ) {
    res
      .writeHead(400, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: "Unsupported article URL." }));
    return;
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  res.once("close", cancel);
  try {
    const result = await inspectGoogleResult(
      article,
      fetchImpl,
      AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]),
    );
    if (controller.signal.aborted) return;
    res
      .writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      })
      .end(JSON.stringify({ status: "checked", ...result }));
  } catch (error) {
    if (controller.signal.aborted) return;
    if (
      error instanceof InspectionUnavailable ||
      error.name === "TimeoutError"
    ) {
      res
        .writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        })
        .end(
          JSON.stringify({
            status: "unavailable",
            reason: error.reason || "timeout",
          }),
        );
      return;
    }
    res
      .writeHead(502, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      })
      .end(
        JSON.stringify({ error: error.message || "Media lookup unavailable." }),
      );
  } finally {
    res.removeListener("close", cancel);
  }
}
