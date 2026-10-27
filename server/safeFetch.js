import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { Readable } from "node:stream";
import ipaddr from "ipaddr.js";
import { safeImageUrl } from "./metadata.js";

export function safePublicUrl(value) {
  const url = safeImageUrl(value);
  return url ? new URL(url) : null;
}

export async function resolvePublicHost(hostname, resolver = lookup) {
  const addresses = await resolver(hostname, { all: true, verbatim: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) => {
      try {
        return ipaddr.process(address).range() !== "unicast";
      } catch {
        return true;
      }
    })
  )
    throw new Error(
      "The host does not resolve exclusively to public addresses.",
    );
  return addresses[0];
}

// Every request resolves afresh, validates all answers, and pins the chosen IP
// to the actual TLS connection. Redirects must be handled and checked by caller.
export async function safeFetch(
  value,
  {
    headers,
    signal,
    method = "GET",
    body,
    resolver = lookup,
    requestImpl = request,
  } = {},
) {
  const url = safePublicUrl(value);
  if (!url) throw new Error("Unsupported URL.");
  // The only permitted POST is the fixed Google News decoding endpoint.
  if (
    (method !== "GET" && method !== "POST") ||
    (method === "GET" && body !== undefined) ||
    (method === "POST" &&
      (url.href !==
        "https://news.google.com/_/DotsSplashUi/data/batchexecute" ||
        typeof body !== "string" ||
        Buffer.byteLength(body) > 65536))
  )
    throw new Error("Unsupported request.");
  signal?.throwIfAborted();
  let abortHandler;
  const aborted = new Promise((_, reject) => {
    abortHandler = () => reject(signal.reason);
    signal?.addEventListener("abort", abortHandler, { once: true });
  });
  let address;
  try {
    address = await Promise.race([
      resolvePublicHost(url.hostname, resolver),
      aborted,
    ]);
  } finally {
    signal?.removeEventListener("abort", abortHandler);
  }
  signal?.throwIfAborted();

  return new Promise((resolve, reject) => {
    const req = requestImpl(
      url,
      {
        method,
        headers: { ...headers, "Accept-Encoding": "identity" },
        signal,
        agent: false,
        autoSelectFamily: false,
        lookup: (_hostname, options, callback) => {
          if (options.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
      },
      (response) => {
        const responseHeaders = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          if (Array.isArray(value))
            value.forEach((v) => responseHeaders.append(name, v));
          else if (value !== undefined) responseHeaders.set(name, value);
        }
        const noBody = [204, 205, 304].includes(response.statusCode);
        if (noBody) response.resume();
        resolve(
          new Response(noBody ? null : Readable.toWeb(response), {
            status: response.statusCode,
            headers: responseHeaders,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
