import { isIP } from "node:net";

// Images are loaded by the browser, never fetched by the server.
export function safeImageUrl(value, base) {
  try {
    if (typeof value !== "string" || !value.trim()) return null;
    const url = new URL(value, base);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      isIP(host.replace(/^\[|\]$/g, "")) ||
      !host.includes(".") ||
      /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)
    )
      return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

export function feedMetadata(element, $) {
  let imageUrl = null;
  const types = new Set();
  element.find("*").each((_, node) => {
    const name = node.name?.toLowerCase();
    const item = $(node);
    const medium = (item.attr("medium") || "").toLowerCase();
    const mime = (item.attr("type") || "").toLowerCase();
    const value = item.attr("url") || item.attr("href");
    if (name === "media:content" || name === "enclosure") {
      if (medium === "audio" || mime.startsWith("audio/")) types.add("audio");
      if (medium === "video" || mime.startsWith("video/")) types.add("video");
    }
    if (
      !imageUrl &&
      (name === "media:thumbnail" ||
        name === "itunes:image" ||
        ((name === "media:content" || name === "enclosure") &&
          (medium === "image" || mime.startsWith("image/"))))
    )
      imageUrl = safeImageUrl(value);
  });
  return { imageUrl, mediaTypes: [...types] };
}
