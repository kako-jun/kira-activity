import axios from 'axios';
import { parseStringPromise } from 'xml2js';

const FEED_FETCH_TIMEOUT_MS = 15000;
const FEED_USER_AGENT = 'kira-activity/1.0 (+https://github.com/kako-jun/kira-activity)';
const FEED_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

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
 */
export class RssAtomFeedClient {
  /**
   * Fetch a feed URL and return normalized event objects.
   * @param {string} feedUrl - Absolute http/https URL of the feed
   * @returns {Promise<Array<{type:string,date:string,title:string,url:string}>>}
   */
  async fetchEvents(feedUrl) {
    if (!/^https?:\/\//i.test(feedUrl)) {
      throw new Error(`Invalid feed URL: ${feedUrl}`);
    }
    const response = await axios.get(feedUrl, {
      timeout: FEED_FETCH_TIMEOUT_MS,
      maxContentLength: FEED_MAX_BYTES,
      // Many servers return the feed body differently if axios sends
      // `Accept: application/json,*/*` (the default). Restrict to feed-ish
      // content types and identify ourselves so the request is debuggable.
      headers: {
        'User-Agent': FEED_USER_AGENT,
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml'
      },
      // Treat non-2xx as errors (axios default), but propagate the message
      // so the caller can surface it in the JSON error response.
      responseType: 'text'
    });
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
    return entries
      .map((entry) => ({
        type: 'article',
        date: this.pickDate(entry.published, entry.updated),
        title: this.text(entry.title) || 'No title',
        url: this.atomLink(entry.link) || ''
      }))
      .filter((e) => e.date);
  }

  normalizeRss20(channel) {
    const items = this.toArray(channel.item);
    return items
      .map((item) => ({
        type: 'article',
        date: this.pickDate(item.pubDate, item['dc:date']),
        title: this.text(item.title) || 'No title',
        url: this.text(item.link) || ''
      }))
      .filter((e) => e.date);
  }

  normalizeRdf(rdf) {
    const items = this.toArray(rdf.item);
    return items
      .map((item) => ({
        type: 'article',
        date: this.pickDate(item['dc:date'], item.pubDate),
        title: this.text(item.title) || 'No title',
        url: this.text(item.link) || ''
      }))
      .filter((e) => e.date);
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
   */
  text(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'object' && '_' in v) return v._;
    return String(v);
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
   * Prefer rel="alternate" (canonical entry URL); fall back to the first
   * link with no rel; then any href; then the bare string form.
   */
  atomLink(linkField) {
    if (!linkField) return '';
    const links = this.toArray(linkField);
    const preferred = links.find((l) => l?.$ && (l.$.rel === 'alternate' || !l.$.rel));
    if (preferred?.$?.href) return preferred.$.href;
    if (links[0]?.$?.href) return links[0].$.href;
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
    events.sort((a, b) => new Date(b.date) - new Date(a.date));
    return {
      username: username || feedUrl,
      totalActivity: events.length,
      events,
      fetchedAt: new Date().toISOString()
    };
  }
}
