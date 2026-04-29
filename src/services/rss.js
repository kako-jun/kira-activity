import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import { lookup } from 'dns/promises';

const FEED_FETCH_TIMEOUT_MS = 15000;
const FEED_USER_AGENT = 'kira-activity/1.0 (+https://github.com/kako-jun/kira-activity)';
const FEED_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// Atom <link> rel values we accept as the canonical entry URL.
// undefined / '' covers `<link href="...">` with no rel attribute.
const ALLOWED_LINK_RELS = new Set(['alternate', '', undefined]);

/**
 * Reject hostnames that resolve to private / loopback / link-local IPs.
 * This is the first line of SSRF defense for `source=rss`: even if the URL
 * passes scheme + length validation upstream, we don't want feed fetches to
 * land on internal services or cloud metadata endpoints (169.254.169.254).
 *
 * Notes / known limitations:
 *   - DNS rebinding is not fully prevented here; an attacker controlling DNS
 *     could return a public IP at validation time and a private IP at fetch
 *     time. Mitigating that fully requires resolving the IP once and
 *     connecting directly to that IP (custom http agent), which adds
 *     complexity. We accept the residual risk for now and rely on this
 *     coarse filter + Node's default agent.
 *   - String guards for `localhost` and `*.local` catch the common cases
 *     before DNS resolution.
 */
async function isPrivateHost(hostname) {
  if (/^(localhost|.*\.local)$/i.test(hostname)) return true;

  let ip;
  try {
    const result = await lookup(hostname);
    ip = result.address;
  } catch {
    // Unresolvable hostnames are rejected: we don't want to fall through to
    // axios where the failure mode could vary by environment.
    return true;
  }
  return isPrivateIp(ip);
}

/**
 * CIDR-style check for IPv4 / IPv6 ranges that should never be reachable
 * from a feed fetcher: loopback, link-local, RFC1918, IPv6 ULA / link-local,
 * and the unspecified 0.0.0.0/8 block.
 */
function isPrivateIp(ip) {
  // IPv4
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [, a, b] = v4.map(Number);
    if (a === 10) return true;                         // 10.0.0.0/8
    if (a === 127) return true;                        // 127.0.0.0/8 loopback
    if (a === 0) return true;                          // 0.0.0.0/8
    if (a === 169 && b === 254) return true;           // 169.254.0.0/16 link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
    if (a === 192 && b === 168) return true;           // 192.168.0.0/16
    return false;
  }
  // IPv6
  const v6 = ip.toLowerCase();
  if (v6 === '::1' || v6 === '::') return true;
  if (v6.startsWith('fe80:')) return true;             // fe80::/10 link-local
  if (v6.startsWith('fc') || v6.startsWith('fd')) return true; // fc00::/7 ULA
  return false;
}

/**
 * Generic RSS/Atom/RDF feed client.
 *
 * Normalizes any compliant feed into the common
 * `{ events: [{ date, type, title, url }] }` shape used by visualization.
 * Supports:
 *   - Atom 1.0 (parsed.feed)
 *   - RSS 2.0 (parsed.rss.channel)
 *   - RSS 1.0 / RDF (parsed['rdf:RDF'])
 *
 * Date extraction tries multiple fields in order:
 *   Atom:   entry.published > entry.updated
 *   RSS 2:  item.pubDate > item['dc:date']
 *   RDF:    item['dc:date'] > item.pubDate
 *
 * Feeds typically expose only the most recent 10-50 entries, so the
 * resulting visualization only shows posting-time bias for the recent
 * window — not long-tail edit history.
 *
 * Security: SSRF / XXE / credential-leak hardened. Hostnames resolving to
 * private / link-local / loopback IPs are rejected, URLs containing
 * userinfo (user:pass@) are rejected, and feed bodies that contain XML
 * `<!DOCTYPE>` / `<!ENTITY>` declarations are rejected before being fed
 * to xml2js to prevent billion-laughs / external entity expansion.
 */
export class RssAtomFeedClient {
  /**
   * Fetch a feed URL and return normalized event objects.
   * @param {string} feedUrl - Absolute http/https URL of the feed
   * @returns {Promise<Array<{type:string,date:string,title:string,url:string}>>}
   */
  async fetchEvents(feedUrl) {
    if (!/^https?:\/\//i.test(feedUrl)) {
      throw new Error('invalid feed URL: scheme must be http or https');
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(feedUrl);
    } catch {
      throw new Error('invalid feed URL');
    }
    if (parsedUrl.username || parsedUrl.password) {
      throw new Error('feed URL must not contain credentials');
    }
    if (await isPrivateHost(parsedUrl.hostname)) {
      throw new Error('feed URL host is not allowed (private / loopback / link-local)');
    }

    const response = await axios.get(feedUrl, {
      timeout: FEED_FETCH_TIMEOUT_MS,
      maxContentLength: FEED_MAX_BYTES,
      maxBodyLength: FEED_MAX_BYTES,
      // Many servers return the feed body differently if axios sends
      // `Accept: application/json,*/*` (the default). Restrict to feed-ish
      // content types and identify ourselves so the request is debuggable.
      headers: {
        'User-Agent': FEED_USER_AGENT,
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml'
      },
      // Treat non-2xx as errors (axios default), but propagate the message
      // so the caller can surface it in the JSON error response.
      responseType: 'text',
      // Re-validate every redirect target so an open redirect on a public
      // host can't bounce us to internal infrastructure.
      maxRedirects: 5,
      beforeRedirect: async (opts) => {
        const next = new URL(opts.href ?? `${opts.protocol}//${opts.hostname}${opts.path}`);
        if (next.username || next.password) {
          throw new Error('redirect target must not contain credentials');
        }
        if (await isPrivateHost(next.hostname)) {
          throw new Error('redirect target host is not allowed');
        }
      }
    });

    // Pre-flight reject DOCTYPE / ENTITY declarations to prevent
    // billion-laughs and external-entity expansion before xml2js sees them.
    // We only inspect the head of the body since these declarations must
    // appear in the prolog.
    const head = String(response.data).slice(0, 4096);
    if (/<!DOCTYPE|<!ENTITY/i.test(head)) {
      throw new Error('feed contains DOCTYPE/ENTITY declarations (rejected for safety)');
    }

    const parsed = await parseStringPromise(response.data, {
      explicitArray: false,
      ignoreAttrs: false
    });
    return this.normalize(parsed);
  }

  /**
   * Dispatch to a format-specific normalizer based on the parsed root.
   * Throws if the document is not a recognized feed shape.
   */
  normalize(parsed) {
    if (parsed.feed) return this.normalizeAtom(parsed.feed);
    if (parsed.rss?.channel) return this.normalizeRss20(parsed.rss.channel);
    if (parsed['rdf:RDF']) return this.normalizeRdf(parsed['rdf:RDF']);
    throw new Error('Unrecognized feed format (expected Atom, RSS 2.0, or RDF)');
  }

  normalizeAtom(feed) {
    const entries = this.toArray(feed.entry);
    let dropped = 0;
    const events = entries
      .map((entry) => {
        const date = this.pickDate(entry.published, entry.updated);
        if (!date) { dropped++; return null; }
        return {
          type: 'article',
          date,
          title: this.text(entry.title) || 'No title',
          url: this.atomLink(entry.link) || ''
        };
      })
      .filter(Boolean);
    if (dropped > 0) console.warn(`atom feed: dropped ${dropped} entries with no parseable date`);
    return events;
  }

  normalizeRss20(channel) {
    const items = this.toArray(channel.item);
    let dropped = 0;
    const events = items
      .map((item) => {
        const date = this.pickDate(item.pubDate, item['dc:date']);
        if (!date) { dropped++; return null; }
        return {
          type: 'article',
          date,
          title: this.text(item.title) || 'No title',
          url: this.text(item.link) || ''
        };
      })
      .filter(Boolean);
    if (dropped > 0) console.warn(`rss feed: dropped ${dropped} items with no parseable date`);
    return events;
  }

  normalizeRdf(rdf) {
    const items = this.toArray(rdf.item);
    let dropped = 0;
    const events = items
      .map((item) => {
        const date = this.pickDate(item['dc:date'], item.pubDate);
        if (!date) { dropped++; return null; }
        return {
          type: 'article',
          date,
          title: this.text(item.title) || 'No title',
          url: this.text(item.link) || ''
        };
      })
      .filter(Boolean);
    if (dropped > 0) console.warn(`rdf feed: dropped ${dropped} items with no parseable date`);
    return events;
  }

  /** Coerce xml2js single-or-many output into an array (empty for null/undefined). */
  toArray(v) {
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
  }

  /**
   * Extract text content from an xml2js node.
   * xml2js with `ignoreAttrs: false` collapses simple text into a string,
   * but a node with attributes becomes `{ _: 'text', $: { ... } }`.
   * For unknown structures (e.g. Atom `type='xhtml'` which embeds a `<div>`)
   * we return '' rather than `String({...})` which would leak `[object Object]`.
   */
  text(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, '_')) {
      return typeof v._ === 'string' ? v._ : '';
    }
    return '';
  }

  /**
   * Try each candidate as a date string and return the first one that parses.
   * Returns an ISO 8601 string in UTC, or `null` if none parsed.
   */
  pickDate(...candidates) {
    for (const c of candidates) {
      if (!c) continue;
      const s = this.text(c);
      if (!s) continue;
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    return null;
  }

  /**
   * Atom <link> can be a single object, an array, or a plain string.
   * Prefer rel="alternate" (canonical entry URL) or no-rel; reject other
   * rels (self / enclosure / via / hub / related etc.) so we don't accidentally
   * surface non-article links as the entry URL.
   */
  atomLink(linkField) {
    if (!linkField) return '';
    const links = this.toArray(linkField);
    const preferred = links.find((l) => {
      const rel = l?.$?.rel;
      return ALLOWED_LINK_RELS.has(rel);
    });
    if (preferred?.$?.href) return preferred.$.href;
    if (typeof links[0] === 'string') return links[0];
    return '';
  }

  /**
   * Match the shape returned by GitHubClient / HatenaBookmarkClient so
   * downstream `data-processor.js` does not need source-specific logic.
   *
   * @param {string} feedUrl - Absolute http/https URL of the feed
   * @param {string} [username] - Display/cache label. Defaults to `feedUrl`.
   * @returns {Promise<{username:string,totalActivity:number,events:Array,fetchedAt:string}>}
   */
  async getComprehensiveActivity(feedUrl, username) {
    const events = await this.fetchEvents(feedUrl);
    if (events.length === 0) {
      throw new Error('feed contained no dated entries');
    }
    events.sort((a, b) => new Date(b.date) - new Date(a.date));
    return {
      username: username || feedUrl,
      totalActivity: events.length,
      events,
      fetchedAt: new Date().toISOString()
    };
  }
}
