import { useEffect, useState } from "react";
import { getPublicSearchUrl, sourceDefinitions } from "./data/sourceLibrary";
import {
  formatPublicationDate,
  sortAndFilterResults,
} from "./data/resultDates";
import { mergeResults } from "./data/mergeResults";
import { lookupMedia } from "./data/mediaLookup";
import "./App.css";

function ArticleMedia({ result, onImage }) {
  const [status, setStatus] = useState("loading");
  const [media, setMedia] = useState([]);
  const [mediaTypes, setMediaTypes] = useState(result.mediaTypes || []);
  const [activeUrl, setActiveUrl] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    lookupMedia(result.sourceId, result.url, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data.status === "unavailable") {
          setStatus(
            data.reason === "google_consent" || data.reason === "google_opaque"
              ? "unavailable"
              : "error",
          );
          return;
        }
        setMedia(data.media);
        setMediaTypes([
          ...new Set([...(result.mediaTypes || []), ...data.mediaTypes]),
        ]);
        if (data.imageUrl) onImage(data.imageUrl);
        setStatus("checked");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("error");
      });
    return () => controller.abort();
  }, [result, onImage, attempt]);

  return (
    <div className="article-media">
      {mediaTypes.length > 0 && (
        <p>
          Media indicated: {mediaTypes.join(" and ")}. Playback may not be
          available.
        </p>
      )}
      {status === "error" && (
        <button
          type="button"
          className="media-button"
          onClick={() => {
            setStatus("loading");
            setAttempt((value) => value + 1);
          }}
        >
          Try media lookup again
        </button>
      )}
      <div aria-live="polite">
        {status === "loading" && <p>Checking article metadata…</p>}
        {status === "checked" && mediaTypes.length === 0 && (
          <p>
            No audio or video indicators found in the article HTML. Media loaded
            by the publisher may not be detected.
          </p>
        )}
        {status === "error" && (
          <p>
            Could not check the article: Google News may not provide a direct
            link, or the publisher may block access. Open it to check directly.
          </p>
        )}
        {status === "unavailable" && (
          <p>
            Could not check media: Google News did not provide a direct article
            link.
          </p>
        )}
        {status === "checked" &&
          media.map((item) => (
            <div className="media-item" key={item.url}>
              {activeUrl === item.url ? (
                <>
                  <iframe
                    className={`media-player media-player--${item.type}`}
                    src={item.url}
                    title={`${item.provider} ${item.type}: ${result.title}`}
                    sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
                    allow="encrypted-media; picture-in-picture; fullscreen"
                    referrerPolicy="strict-origin-when-cross-origin"
                  />
                  <button
                    type="button"
                    className="media-button"
                    onClick={() => setActiveUrl(null)}
                  >
                    Close player
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="media-button"
                  onClick={() => setActiveUrl(item.url)}
                >
                  Play {item.type} via {item.provider} ↗
                </button>
              )}
            </div>
          ))}
        {status === "checked" && media.length > 0 && (
          <p>Players are provided by third parties and may set cookies.</p>
        )}
      </div>
    </div>
  );
}

function ResultCard({ result }) {
  const source = sourceDefinitions[result.sourceId];
  const publisherName = result.publisherName || source.name;
  const isDiscovery = result.sourceId === "googleNews";
  const [imageUrl, setImageUrl] = useState(result.imageUrl);

  return (
    <li className="result-item">
      <a
        className="result-link"
        href={result.url}
        target="_blank"
        rel="noreferrer noopener"
      >
        <div className="result-content">
          <div className="result-copy">
            <div className="source-row">
              <span
                className="source-badge"
                aria-label={`${publisherName} source icon`}
              >
                {isDiscovery
                  ? publisherName.charAt(0).toUpperCase()
                  : source.icon}
              </span>
              <span className="source-name">{publisherName}</span>
              {result.publishedAt && (
                <time className="result-date" dateTime={result.publishedAt}>
                  {formatPublicationDate(result.publishedAt)}
                </time>
              )}
            </div>
            <h3>{result.title}</h3>
            {result.snippet && <p>{result.snippet}</p>}
            <div className="meta-row">
              {!isDiscovery && (
                <span>
                  Read article <span aria-hidden="true">↗</span>
                </span>
              )}
              <span>{result.publisherDomain || source.domain}</span>
            </div>
          </div>
          {imageUrl && (
            <img
              className="result-image"
              src={imageUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => setImageUrl(null)}
            />
          )}
        </div>
      </a>
      <ArticleMedia result={result} onImage={setImageUrl} />
    </li>
  );
}

function App() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState({ term: "", results: [], errors: [] });
  const [todayOnly, setTodayOnly] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const term = query.trim();
  const loading = Boolean(term && search.term !== term);
  const visibleResults =
    !loading && term
      ? sortAndFilterResults(search.results, todayOnly, new Date(now))
      : [];
  const errors = !loading && term ? search.errors : [];

  useEffect(() => {
    if (!todayOnly) return;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [todayOnly]);

  useEffect(() => {
    if (!term) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const responses = await Promise.all(
        Object.values(sourceDefinitions).map(async (source) => {
          try {
            const params = new URLSearchParams({ source: source.id, q: term });
            const response = await fetch(`/api/search?${params}`, {
              signal: controller.signal,
            });
            const data = await response.json();
            if (!response.ok)
              throw new Error(data.error || "Search unavailable.");
            return { results: data.results };
          } catch (error) {
            return { source, error: error.message || "Search unavailable." };
          }
        }),
      );

      if (!controller.signal.aborted) {
        setSearch({
          term,
          results: mergeResults(
            responses.flatMap((response) => response.results || []),
          ),
          errors: responses.filter((response) => response.error),
        });
      }
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="Press Monitor, home">
          <span>PRESS</span>
          <span>
            MONITOR<span className="wordmark-dot">.</span>
          </span>
        </a>
        <div className="masthead-note">
          <span>AN INDEPENDENT VIEW</span>
          <span>OF THE STORIES THAT MATTER</span>
        </div>
      </header>

      <nav className="navigation" aria-label="Page sections">
        <a href="#top">HOME</a>
        <a href="#search">SEARCH THE PRESS</a>
        <a href="#results">LATEST RESULTS</a>
        <span className="nav-caption">MEDIA CLIPPING / PORTUGAL</span>
      </nav>

      <section className="hero" id="top" aria-labelledby="hero-title">
        <div className="hero-copy">
          <span className="hero-kicker">
            <span aria-hidden="true">✳</span> THE PRESS, IN PERSPECTIVE
          </span>
          <h1 id="hero-title">
            EVERY STORY
            <br />
            HAS A <em>STAGE.</em>
          </h1>
          <p>
            Follow the stories making headlines, from the sources you know and
            the ones you have yet to discover.
          </p>
          <a className="hero-link" href="#search">
            START EXPLORING <span aria-hidden="true">↗</span>
          </a>
          <span className="hero-index" aria-hidden="true">
            01 / THE STORIES
          </span>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="art-frame art-frame-outer"></div>
          <div className="art-frame art-frame-middle"></div>
          <div className="art-frame art-frame-inner"></div>
          <div className="art-sun"></div>
          <div className="art-floor"></div>
          <span className="art-caption">
            A WIDER VIEW
            <br />
            ON THE NEWS.
          </span>
        </div>
      </section>

      <div className="content-wrap">
        <section
          className="search-section"
          id="search"
          aria-labelledby="search-heading"
        >
          <div className="section-heading">
            <div>
              <span className="section-kicker">01 / DISCOVER</span>
              <h2 id="search-heading">
                FIND YOUR STORY<span>.</span>
              </h2>
            </div>
            <p>One search. A wider view of the press.</p>
          </div>
          <label className="search-box" htmlFor="search-term">
            <span className="search-label">Search term</span>
            <div className="search-input-wrap">
              <input
                id="search-term"
                type="text"
                maxLength={200}
                value={query}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value.trim() !== term) {
                    setSearch({ term: "", results: [], errors: [] });
                  }
                  setQuery(value);
                }}
                placeholder="Search for a topic..."
              />
              <span className="search-icon" aria-hidden="true">
                ↗
              </span>
            </div>
          </label>
          <p className="search-hint">
            SEARCH ARTICLES, TOPICS AND NAMES <span>↗</span>
          </p>
        </section>

        <section className="results-panel" id="results" aria-live="polite">
          <div className="results-header">
            <div>
              <span className="section-kicker">02 / THE LATEST</span>
              <h2>
                IN THE PRESS<span>.</span>
              </h2>
            </div>
            <span className="result-count">
              {loading
                ? "Searching…"
                : `${visibleResults.length} ${visibleResults.length === 1 ? "match" : "matches"}`}
            </span>
          </div>

          <div className="results-filters">
            <label className="today-filter">
              <input
                type="checkbox"
                checked={todayOnly}
                onChange={(event) => {
                  setNow(Date.now());
                  setTodayOnly(event.target.checked);
                }}
              />
              <span>Today only</span>
            </label>
            <span className="filter-hint">Lisbon time</span>
          </div>

          <p className="discovery-note">
            Results are discovered through Google News from the last 7 days.
          </p>

          {errors.length > 0 && (
            <div className="search-errors" role="status">
              {errors.map(({ source, error }) => (
                <p key={source.id}>
                  {source.name}: {error}{" "}
                  <a
                    href={getPublicSearchUrl(source, term)}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    Search on {source.name}
                  </a>
                </p>
              ))}
            </div>
          )}

          {!term ? (
            <div className="empty-state">
              Enter a search term to find articles.
            </div>
          ) : loading ? (
            <div className="empty-state">Searching sources…</div>
          ) : visibleResults.length === 0 &&
            errors.length < Object.keys(sourceDefinitions).length ? (
            <div className="empty-state">
              {todayOnly && search.results.length > 0
                ? `No results for “${term}” were published today`
                : `No results were found for “${term}”`}
              {errors.length ? " in the available sources" : ""}.
            </div>
          ) : visibleResults.length > 0 ? (
            <ul className="result-list">
              {visibleResults.map((result) => (
                <ResultCard key={result.id} result={result} />
              ))}
            </ul>
          ) : null}
        </section>
      </div>

      <footer className="footer">
        <span>
          PRESS MONITOR<span className="footer-dot">.</span>
        </span>
        <p>KEEP AN EYE ON THE STORIES THAT MATTER.</p>
        <a href="#top">BACK TO TOP ↑</a>
      </footer>
    </main>
  );
}

export default App;
