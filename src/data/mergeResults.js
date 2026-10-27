import { sourceDefinitions } from "./sourceLibrary.js";

function normalized(value) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("pt-PT")
    .replace(/\s+/g, " ")
    .trim();
}

export function mergeResults(results) {
  const seen = new Set();
  return results.filter((result) => {
    const publisher =
      result.publisherName || sourceDefinitions[result.sourceId]?.name;
    if (!publisher || publisher === "Unknown publisher") return true;
    const key = `${normalized(publisher)}\n${normalized(result.title)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
