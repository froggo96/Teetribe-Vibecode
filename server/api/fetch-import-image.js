/**
 * Server-side proxy for the bulk CSV listing importer's image-URL column (see
 * src/containers/BulkImportListingsPage). The browser can't fetch arbitrary third-party image
 * URLs directly - most hosts don't send CORS headers permitting a cross-origin fetch from the
 * marketplace's own domain - so this endpoint fetches the URL server-to-server (no CORS applies
 * to server-to-server HTTP) and returns the raw bytes for the browser to wrap in a Blob and pass
 * to sdk.images.upload, exactly like a normal file picked in the Photos tab.
 *
 * This endpoint does NOT touch any Sharetribe listing/image data itself - it only authenticates
 * the caller (so usage is tied to accountable logged-in users) and streams back whatever image
 * bytes the given URL returns. Because it fetches attacker-influenced URLs server-side, it is
 * hardened against SSRF: only http/https, only public (non-private/loopback/link-local/
 * multicast) addresses, every redirect hop re-validated, a response size cap that doesn't trust
 * Content-Length, a fetch timeout, and a Content-Type check.
 */
const dns = require('dns');
const { getSdk, handleError } = require('../api-util/sdk');
const log = require('../log');

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 10000;
const MAX_BYTES = 15 * 1024 * 1024; // 15MB

// IPv4 ranges that must never be reachable from this server-side fetch: loopback, private,
// link-local (this range includes the cloud metadata address 169.254.169.254), carrier-grade
// NAT, "this network", benchmarking, multicast, and reserved space.
const isPrivateIPv4 = ip => {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // not a well-formed IPv4 literal - fail closed
  }
  const [a, b] = parts;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true; // 224-239 multicast, 240-255 reserved
  return false;
};

// IPv6 ranges to block: loopback, unique-local, link-local, multicast, and IPv4-mapped
// addresses (checked against the embedded IPv4 rules above).
const isPrivateIPv6 = ip => {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // fc00::/7 (ULA)
  if (/^fe[89ab]/.test(normalized)) return true; // fe80::/10 (link-local)
  if (normalized.startsWith('ff')) return true; // ff00::/8 (multicast)
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
};

const isPrivateIp = ip => (ip.includes(':') ? isPrivateIPv6(ip) : isPrivateIPv4(ip));

// Resolve every address a hostname maps to (not just the first) and reject if ANY is private.
// This is a best-effort, request-time check (a later DNS answer could differ - "DNS rebinding")
// rather than an absolute guarantee; the per-redirect-hop revalidation plus the byte/time caps
// below keep the worst case bounded even if a rebind slipped past this check.
const assertHostIsPublic = hostname =>
  new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err || !addresses || addresses.length === 0) {
        reject(new Error('Could not resolve host'));
        return;
      }
      if (addresses.some(a => isPrivateIp(a.address))) {
        reject(new Error('URL resolves to a disallowed address'));
        return;
      }
      resolve();
    });
  });

const assertUrlIsSafe = async urlString => {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch (e) {
    throw new Error('Invalid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http/https URLs are allowed');
  }
  await assertHostIsPublic(parsed.hostname);
  return parsed;
};

// Fetch a URL, manually following redirects so each hop is re-validated against the same SSRF
// rules (an initial safe URL could otherwise redirect to an internal address).
const fetchImageFollowingRedirects = async (urlString, redirectsLeft) => {
  await assertUrlIsSafe(urlString);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(urlString, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'User-Agent': 'sharetribe-bulk-import-image-fetch/1.0' },
    });
  } finally {
    clearTimeout(timeout);
  }

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (redirectsLeft <= 0) {
      throw new Error('Too many redirects');
    }
    const location = response.headers.get('location');
    if (!location) {
      throw new Error('Redirect with no location header');
    }
    const nextUrl = new URL(location, urlString).toString();
    return fetchImageFollowingRedirects(nextUrl, redirectsLeft - 1);
  }

  if (!response.ok) {
    throw new Error(`Image fetch failed with status ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) {
    throw new Error('URL did not return an image');
  }

  // Stream with a hard byte cap - don't trust Content-Length (the remote server could lie about
  // or omit it); count actual bytes as they arrive and abort past the cap.
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      controller.abort();
      throw new Error('Image exceeds maximum allowed size');
    }
    chunks.push(value);
  }

  return { buffer: Buffer.concat(chunks.map(c => Buffer.from(c))), contentType };
};

module.exports = async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'Missing "url" in request body' }).end();
    return;
  }

  const sdk = getSdk(req, res);

  // Gate access to authenticated marketplace users only. This endpoint can't mutate any
  // Sharetribe data, but it does fetch attacker-influenced URLs server-side, so usage should at
  // least be tied to accountable logged-in accounts.
  try {
    await sdk.currentUser.show();
  } catch (authError) {
    handleError(res, authError, { skipErrorLogging: true });
    return;
  }

  try {
    const { buffer, contentType } = await fetchImageFollowingRedirects(url, MAX_REDIRECTS);
    res
      .status(200)
      .set('Content-Type', contentType)
      .send(buffer)
      .end();
  } catch (e) {
    log.error(e, 'fetch-import-image-failed', { url });
    res.status(422).json({ error: e.message || 'Failed to fetch image' }).end();
  }
};
