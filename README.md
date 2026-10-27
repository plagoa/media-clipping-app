# Media clipping

Discover publishers through Google News. Search terms are sent to the server,
which requests the Google News RSS search feed and extracts its results.

Google News results use the Portuguese edition and are limited to articles from
the past seven days. Links open via Google News. Google News may omit sources or impose rate limits;
results are not comprehensive. The Google News RSS feed states it is provided
solely for personal, non-commercial feed-reader use. Review Google's terms and
use a licensed news search provider for other uses.

## Running

- Install dependencies with `npm install`.
- Run `npm run dev` for development (the search API is included in Vite).
- For a production build, run `npm run build` followed by `npm start`. The Node
  server serves both the built app and the search API; `PORT` defaults to 3000.
- Run `npm test` and `npm run lint` to check the app.

The app shows an image and audio/video indicators when these are present in RSS
metadata. It also checks article HTML automatically, with a limited number of
concurrent requests. Changing the search cancels outstanding checks.
The app follows normal Google redirects and attempts to decode opaque links using
an undocumented Google News endpoint. This is best effort and may stop working
or be rate-limited; actual consent pages and CAPTCHAs are not submitted or bypassed.
Publisher requests and every redirect are checked against private and special-use
network addresses, and DNS answers are pinned to each connection. When decoding
or inspection fails, this does not mean the article has no media.
Checks look at the static HTML,
so media loaded dynamically can be missed. An indicator does not imply inline
playback is available. Known third-party embeds found in HTML or structured
metadata are loaded only on request; arbitrary publisher streams are not played.
Images are loaded directly from external hosts by the browser and may disclose
the visitor's IP address to those hosts; images may also be unavailable or blocked
by their provider.
