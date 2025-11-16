import axios from 'axios';

export class GitHubClient {
  constructor() {
    this.token = process.env.GITHUB_TOKEN;
    this.baseURL = 'https://api.github.com';

    this.client = axios.create({
      baseURL: this.baseURL,
      headers: this.token ? {
        'Authorization': `token ${this.token}`,
        'Accept': 'application/vnd.github.v3+json'
      } : {
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!this.token) {
      console.warn('⚠️  No GitHub token provided. Rate limits will be restrictive.');
    }
  }

  /**
   * Get user's public events
   * @param {string} username - GitHub username
   * @param {number} pages - Number of pages to fetch (max 10)
   * @returns {Promise<Array>} Array of events
   */
  async getUserEvents(username, pages = 3) {
    try {
      const events = [];

      for (let page = 1; page <= Math.min(pages, 10); page++) {
        const response = await this.client.get(`/users/${username}/events/public`, {
          params: { per_page: 100, page }
        });

        if (response.data.length === 0) break;
        events.push(...response.data);
      }

      console.log(`📊 Fetched ${events.length} events for ${username}`);
      return events;
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error(`User "${username}" not found on GitHub`);
      }
      throw new Error(`Failed to fetch GitHub events: ${error.message}`);
    }
  }

  /**
   * Get user's commit activity for the last year
   * @param {string} username - GitHub username
   * @returns {Promise<Array>} Array of repositories with commit data
   */
  async getUserActivity(username) {
    try {
      // Get user's repositories
      const reposResponse = await this.client.get(`/users/${username}/repos`, {
        params: { per_page: 100, sort: 'updated' }
      });

      const repos = reposResponse.data.slice(0, 20); // Limit to top 20 repos
      const activity = [];

      // Get commit activity for each repo
      for (const repo of repos) {
        try {
          const commitsResponse = await this.client.get(
            `/repos/${username}/${repo.name}/commits`,
            {
              params: {
                author: username,
                per_page: 100,
                since: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()
              }
            }
          );

          activity.push(...commitsResponse.data.map(commit => ({
            type: 'commit',
            repo: repo.name,
            date: commit.commit.author.date,
            message: commit.commit.message
          })));
        } catch (error) {
          // Skip repos with no commits or access issues
          continue;
        }
      }

      console.log(`📈 Fetched ${activity.length} commits for ${username}`);
      return activity;
    } catch (error) {
      if (error.response?.status === 404) {
        throw new Error(`User "${username}" not found on GitHub`);
      }
      throw new Error(`Failed to fetch GitHub activity: ${error.message}`);
    }
  }

  /**
   * Get comprehensive user data including events and commits
   * @param {string} username - GitHub username
   * @returns {Promise<Object>} User activity data
   */
  async getComprehensiveActivity(username) {
    try {
      const [events, commits] = await Promise.all([
        this.getUserEvents(username, 3),
        this.getUserActivity(username)
      ]);

      // Combine and format data
      const allActivity = [
        ...events.map(event => ({
          type: event.type,
          date: event.created_at,
          repo: event.repo?.name || 'unknown'
        })),
        ...commits
      ];

      // Sort by date
      allActivity.sort((a, b) => new Date(b.date) - new Date(a.date));

      return {
        username,
        totalActivity: allActivity.length,
        events: allActivity,
        fetchedAt: new Date().toISOString()
      };
    } catch (error) {
      throw error;
    }
  }
}
