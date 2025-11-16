import axios from 'axios';
import { parseStringPromise } from 'xml2js';

export class HatenaBookmarkClient {
  constructor() {
    this.baseURL = 'https://b.hatena.ne.jp';
  }

  /**
   * Get user's bookmarks via RSS/Atom feed
   * @param {string} username - Hatena username
   * @param {number} limit - Number of bookmarks to fetch
   * @returns {Promise<Array>} Array of bookmarks
   */
  async getUserBookmarks(username, limit = 100) {
    try {
      // Hatena Bookmark provides RSS feed
      const url = `${this.baseURL}/${username}/rss`;
      const response = await axios.get(url);

      // Parse RSS XML
      const result = await parseStringPromise(response.data);
      const items = result.rdf?.RDF?.item || result.rss?.channel?.[0]?.item || [];

      const bookmarks = items.slice(0, limit).map(item => {
        // Extract date from dc:date or pubDate
        const date = item['dc:date']?.[0] || item.pubDate?.[0] || new Date().toISOString();
        const title = item.title?.[0] || 'No title';
        const link = item.link?.[0] || '';
        const description = item.description?.[0] || '';

        return {
          type: 'bookmark',
          date: date,
          title: title,
          url: link,
          comment: description
        };
      });

      console.log(`🔖 Fetched ${bookmarks.length} bookmarks for ${username}`);
      return bookmarks;
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error(`Hatena user "${username}" not found or has no public bookmarks`);
      }
      throw new Error(`Failed to fetch Hatena bookmarks: ${error.message}`);
    }
  }

  /**
   * Get comprehensive bookmark data
   * @param {string} username - Hatena username
   * @returns {Promise<Object>} User bookmark data
   */
  async getComprehensiveActivity(username) {
    try {
      const bookmarks = await this.getUserBookmarks(username, 200);

      // Sort by date
      bookmarks.sort((a, b) => new Date(b.date) - new Date(a.date));

      return {
        username,
        totalActivity: bookmarks.length,
        events: bookmarks,
        fetchedAt: new Date().toISOString()
      };
    } catch (error) {
      throw error;
    }
  }
}
