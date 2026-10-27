export const sourceDefinitions = {
  googleNews: {
    id: "googleNews",
    name: "Google News",
    icon: "G",
    accentColor: "#4285f4",
    domain: "news.google.com",
    searchUrl:
      "https://news.google.com/rss/search?q={term}%20when%3A7d&hl=pt-PT&gl=PT&ceid=PT%3Apt-150",
    publicSearchUrl:
      "https://news.google.com/search?q={term}%20when%3A7d&hl=pt-PT&gl=PT&ceid=PT%3Apt-150",
  },
};

export function getSearchUrl(source, term) {
  return source.searchUrl.replace("{term}", encodeURIComponent(term));
}

export function getPublicSearchUrl(source, term) {
  return (source.publicSearchUrl || source.searchUrl).replace(
    "{term}",
    encodeURIComponent(term),
  );
}
