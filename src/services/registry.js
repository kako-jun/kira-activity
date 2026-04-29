import { GitHubClient } from './github.js';
import { HatenaBookmarkClient } from './hatena.js';
import { RssAtomFeedClient } from './rss.js';

/**
 * @typedef {Object} ActivityEvent
 * @property {string} date - ISO 8601 timestamp
 * @property {string} type - Event type label (e.g., 'commit', 'bookmark', 'article')
 * @property {string} [title]
 * @property {string} [url]
 * @property {string} [repo]
 * @property {object} [meta]
 */

/**
 * @typedef {Object} NormalizedActivity
 * @property {string} username
 * @property {number} totalActivity
 * @property {ActivityEvent[]} events
 * @property {string} fetchedAt
 */

/**
 * @typedef {Object} ActivityProvider
 * @property {string} source - Source identifier matching VALID_SOURCES
 * @property {(params: { user: string, feed?: string }) => Promise<NormalizedActivity>} fetchActivity
 * @property {(params: { user: string, feed?: string }) => string} [inflightIdentity]
 *   Optional. Returns the value used to dedupe in-flight requests. Defaults to
 *   `${user}\0${feed}`. Override when, for example, two requests should share
 *   an upstream fetch even if their `user` labels differ (rss).
 */

const githubClient = new GitHubClient();
const hatenaClient = new HatenaBookmarkClient();
const rssClient = new RssAtomFeedClient();

/**
 * Provider implementations.
 *
 * Each adapter wraps the underlying service client (which still has its own
 * domain-specific shape) into the common `fetchActivity({ user, feed })`
 * contract that returns NormalizedActivity. Adding a new source = adding one
 * entry here, not touching the renderer/route layer.
 *
 * Note: the per-client `events[]` shapes are already compatible enough with
 * the documented target shape ({ date, type, title?, url?, repo?, meta? })
 * that the renderer / data-processor consume them via the existing
 * `event.message || event.title || event.comment || 'Activity'` fallback.
 * The target shape is the forward-looking guideline; we do not rewrite
 * existing client output here to preserve backward compatibility.
 */
const PROVIDERS = {
  github: {
    source: 'github',
    fetchActivity: async ({ user }) => {
      return await githubClient.getComprehensiveActivity(user);
    }
  },
  hatena: {
    source: 'hatena',
    fetchActivity: async ({ user }) => {
      return await hatenaClient.getComprehensiveActivity(user);
    }
  },
  rss: {
    source: 'rss',
    fetchActivity: async ({ user, feed }) => {
      if (!feed) throw new Error('feed URL required for source=rss');
      return await rssClient.getComprehensiveActivity(feed, user);
    },
    // For rss, `user` is a display label only (it is not part of the cache
    // key in server.js either), so two parallel requests for the same feed
    // with different labels should share one upstream fetch.
    inflightIdentity: ({ feed }) => `feed:${feed ?? ''}`
  }
};

/**
 * Lookup a provider by its source key. Returns null when unknown so callers
 * can produce clean 4xx-style errors.
 */
export function getProvider(source) {
  return PROVIDERS[source] ?? null;
}

/**
 * In-flight deduplication: when multiple concurrent requests target the same
 * (source, user, feed) tuple — typically the embed pre-warming kira/month/week
 * in parallel — we collapse them onto a single upstream fetch. Each entry is
 * removed in `finally` so that errors do not poison the cache.
 */
const inFlight = new Map();

function defaultInflightIdentity({ user, feed }) {
  return `${user}\0${feed ?? ''}`;
}

/**
 * Fetch normalized activity. Dispatch + dedup live here so the renderer never
 * sees source-specific branches.
 *
 * @param {string} source
 * @param {{ user: string, feed?: string }} params
 * @returns {Promise<NormalizedActivity>}
 */
export async function fetchActivity(source, params = {}) {
  const provider = getProvider(source);
  if (!provider) throw new Error(`Unknown source: ${source}`);
  if (!params.user) throw new Error(`user required for source=${source}`);

  const identity = (provider.inflightIdentity ?? defaultInflightIdentity)(params);
  const key = `${source}\0${identity}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      return await provider.fetchActivity(params);
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, promise);
  return promise;
}

export const SUPPORTED_SOURCES = Object.freeze(Object.keys(PROVIDERS));
