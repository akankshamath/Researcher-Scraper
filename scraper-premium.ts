import { chromium, Browser, Page } from 'playwright';
import { createObjectCsvWriter } from 'csv-writer';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { fetchOrgContributors } from './githubReposScraper';
import { PublicResearcher } from './types';

dotenv.config();

class XAIPublicResearcherMapper {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private people: PublicResearcher[] = [];

  private githubToken = process.env.GITHUB_TOKEN || '';
  private newsApiKey = process.env.NEWSAPI_KEY || '';
  private twitterToken = process.env.TWITTER_BEARER_TOKEN || '';
  private redditClientId = process.env.REDDIT_CLIENT_ID || '';
  private redditClientSecret = process.env.REDDIT_CLIENT_SECRET || '';

  async initialize() {
    console.log('🚀 xAI Public Researcher Mapper');
    console.log('   Sources: xAI site + GitHub + OpenAlex + News + Social Media');
    console.log('='.repeat(70) + '\n');

    this.browser = await chromium.launch({
      headless: false,
      slowMo: 100
    });

    const context = await this.browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    });

    this.page = await context.newPage();
  }

  /**
   * SOURCE 1: xAI official site (team / about / news)
   * NOTE: You must inspect the actual DOM structure and adjust selectors.
   */
  async scrapeXAISite() {
    if (!this.page) return;

    console.log('🌐 XAI SITE: Scraping public team / about info...\n');

    const urls = [
      'https://x.ai',          // main page
      'https://x.ai/company'   // hypothetical about/company page
    ];

    for (const url of urls) {
      try {
        await this.page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });

        await this.page.waitForTimeout(2000);

        const pagePeople = await this.page.evaluate((sourceUrl) => {
          const results: PublicResearcher[] = [];

          // TODO: adjust selectors after inspecting x.ai DOM structure
          const cards = document.querySelectorAll('.team-member, .profile-card');

          cards.forEach((card) => {
            const name =
              (card.querySelector('.name, h3, h2')?.textContent || '').trim();
            const title =
              (card.querySelector('.title, .role')?.textContent || '').trim();

            if (!name) return;

            const person: PublicResearcher = {
              name,
              title: title || undefined,
              company: 'xAI',
              location: undefined,
              locationConfidence: 'low',
              xaiPageUrl: sourceUrl,
              otherSources: [sourceUrl],
              githubUrl: undefined,
              openAlexUrl: undefined,
              homepageUrl: undefined,
              isResearchLike: false,
              researchScore: 0,
              notes: 'Found on xAI public site'
            };

            results.push(person);
          });

          return results;
        }, url);

        console.log(`   From ${url}: ${pagePeople.length} people`);
        this.people.push(...pagePeople);
      } catch (err) {
        console.warn(`   ⚠️ Could not scrape ${url}:`, (err as Error).message);
      }
    }

    console.log();
  }

  /**
   * SOURCE 2: GitHub API - contributors to xAI repositories
   * Uses official REST API instead of UI scraping.
   */
  async fetchGitHubContributors() {
    console.log('💻 GITHUB API: Fetching contributors from xAI repos...\n');

    const repos = [
      'xai-org/grok-1',
      'xai-org/grok-prompts',
      'xai-org/xai-sdk-python',
      'xai-cookbook',
    ];

    try {
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github+json'
      };
      if (this.githubToken) {
        headers.Authorization = `Bearer ${this.githubToken}`;
      }

      let totalProcessed = 0;

      for (const repo of repos) {
        console.log(`\n   📦 ${repo}...`);

        const res = await fetch(
          `https://api.github.com/repos/${repo}/contributors?per_page=100`,
          { headers }
        );

        if (!res.ok) {
          if (res.status === 404) {
            console.log(`   ⚠️  Not found (may be private or renamed)`);
          } else {
            console.error(` ❌ Error: ${res.status} ${res.statusText}`);
          }
          continue;
        }

        const contributors: Array<{ login: string; contributions: number }> = await res.json();
        console.log(`   Found ${contributors.length} contributors`);

        for (const contrib of contributors.slice(0, 50)) {
          const userRes = await fetch(
            `https://api.github.com/users/${contrib.login}`,
            { headers }
          );
          if (!userRes.ok) continue;

          const user = await userRes.json() as any;

          const name = (user.name || contrib.login).trim();
          const location = (user.location || '').trim();
          const bio = (user.bio || '').toLowerCase();

          const person: PublicResearcher = {
            name,
            title: undefined,
            company: 'xAI',
            location: location || undefined,
            locationConfidence: this.assessLocationConfidence(location),
            githubUrl: user.html_url,
            openAlexUrl: undefined,
            homepageUrl: user.blog || undefined,
            xaiPageUrl: undefined,
            otherSources: [user.html_url],
            isResearchLike: this.isResearchLike(bio),
            researchScore: this.computeResearchScore(bio),
            notes: `Contributor to ${repo} (${contrib.contributions} commits)`
          };

          console.log(`   ✓ ${person.name}`);
          this.people.push(person);
          totalProcessed++;

          await new Promise((r) => setTimeout(r, 400));
        }

        await new Promise((r) => setTimeout(r, 1000)); // Pause between repos
      }

      console.log(`\n📊 Processed ${totalProcessed} contributors from ${repos.length} repos\n`);
    } catch (err) {
      console.error('❌ GitHub API error:', (err as Error).message);
    }
  }

  async fetchGitHubSources() {
    console.log('💻 GITHUB: Fetching contributors across xai-org repos...\n');
    try {
      const ghPeople = await fetchOrgContributors(this.githubToken);
      this.people.push(...ghPeople);
      console.log(`   Added ${ghPeople.length} people from GitHub\n`);
    } catch (err) {
      console.error('❌ Error fetching GitHub sources:', (err as Error).message);
    }
  }

  /**
   * SOURCE 2B: GitHub Organization Members
   * Fetches public members of the xai-org organization
   */
  async fetchGitHubOrgMembers() {
    console.log('💻 GITHUB: Fetching xai-org org members…\n');

    const headers: any = { Accept: 'application/vnd.github+json' };
    if (this.githubToken) headers.Authorization = `Bearer ${this.githubToken}`;

    const res = await fetch(`https://api.github.com/orgs/xai-org/members`, { headers });
    if (!res.ok) {
      console.error('❌ GitHub org members error:', res.statusText);
      return;
    }

    const members: Array<{ login: string }> = await res.json();

    for (const m of members) {
      const userRes = await fetch(`https://api.github.com/users/${m.login}`, { headers });
      if (!userRes.ok) continue;
      const user: any = await userRes.json();

      this.people.push({
        name: user.name || m.login,
        title: undefined,
        company: 'xAI',
        location: user.location ?? undefined,
        locationConfidence: user.location
          ? (user.location.toLowerCase().includes('palo alto') ? 'high' : 'medium')
          : 'low',
        githubUrl: user.html_url,
        openAlexUrl: undefined,
        homepageUrl: undefined,
        xaiPageUrl: undefined,
        isResearchLike: this.isResearchLike(user.bio?.toLowerCase() ?? ''),
        researchScore: this.computeResearchScore(user.bio?.toLowerCase() ?? ''),
        otherSources: [user.html_url],
        notes: 'GitHub org member'
      });

      console.log(`✓ ${user.name || m.login}`);
      await new Promise(r => setTimeout(r, 300));
    }

    console.log();
  }

  /**
   * Helper method to assess location confidence based on Bay Area keywords
   */
  private assessLocationConfidence(location: string): 'low' | 'medium' | 'high' {
    if (!location) return 'low';

    const loc = location.toLowerCase();

    // High confidence - specific Bay Area cities
    const highConfidenceKeywords = [
      'palo alto', 'menlo park', 'mountain view', 'sunnyvale',
      'san francisco', 'sf,', 'redwood city', 'cupertino'
    ];

    // Medium confidence - broader Bay Area
    const mediumConfidenceKeywords = [
      'bay area', 'silicon valley', 'san jose', 'california', 'ca',
      'oakland', 'berkeley', 'fremont', 'santa clara'
    ];

    if (highConfidenceKeywords.some(k => loc.includes(k))) {
      return 'high';
    }

    if (mediumConfidenceKeywords.some(k => loc.includes(k))) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * SOURCE 3: OpenAlex - authors with xAI affiliation
   * This uses only public metadata (no contact info).
   */
  async fetchOpenAlexResearchers() {
    console.log('📚 OPENALEX: Fetching authors with xAI-like affiliation...\n');
  
    try {
      const perPage = 50;
      const searchUrl =
        `https://api.openalex.org/authors?search=xai&per-page=${perPage}`;
  
      const res = await fetch(searchUrl);
      if (!res.ok) {
        console.error('❌ OpenAlex error:', res.status, res.statusText);
        return;
      }
  
      const json: any = await res.json();
      const authors = json.results || [];
  
      console.log(`   Found ${authors.length} authors (raw search)\n`);
  
      for (const author of authors) {
        const name: string = author.display_name;
        const worksCount: number = author.works_count || 0;
        const affiliations: any[] = author.affiliations || [];
  
        const xaiAffils = affiliations.filter((aff) => {
          const instName: string | undefined = aff.institution?.display_name;
          if (!instName) return false;
          const lower = instName.toLowerCase();
          return lower.includes('xai') || lower.includes('x.ai');
        });
  
        if (xaiAffils.length === 0) {
          // skip authors whose institutions don't look like xAI
          continue;
        }
  
        const instName = xaiAffils[0].institution?.display_name as string | undefined;
        const country = xaiAffils[0].institution?.country_code as string | undefined;
        const openAlexUrl: string = author.id;
  
        const isResearch = true;
        const researchScore =
          Math.min(1, 0.3 + Math.log10(worksCount + 1) / 2); // simple heuristic
  
        const person: PublicResearcher = {
          name,
          title: undefined,
          company: instName || 'xAI',
          location: country || undefined,
          locationConfidence: country ? 'medium' : 'low',
          githubUrl: undefined,
          openAlexUrl,
          homepageUrl: undefined,
          xaiPageUrl: undefined,
          otherSources: [openAlexUrl],
          isResearchLike: isResearch,
          researchScore,
          notes: `OpenAlex author with xAI-like institution (works: ${worksCount})`
        };
  
        console.log(`   ✓ ${name} (${instName || 'unknown inst.'})`);
        this.people.push(person);
      }
  
      console.log();
    } catch (err) {
      console.error('❌ OpenAlex error:', (err as Error).message);
    }
  }

  /**
   * SOURCE 4: Press Mentions via NewsAPI
   * Fetches news articles mentioning xAI to extract names with context validation
   */
  async fetchPressMentions() {
    console.log('📰 NEWS: Fetching press mentions of xAI...\n');

    if (!this.newsApiKey) {
      console.log('⚠️  No NEWSAPI_KEY found. Skipping press mentions.');
      console.log('   Get free key at: https://newsapi.org/\n');
      return;
    }

    try {
      const queries = ['xAI employee', 'xAI researcher', 'xAI engineer', 'xAI team'];
      const allArticles: any[] = [];

      for (const query of queries) {
        const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=en&sortBy=publishedAt&pageSize=30&apiKey=${this.newsApiKey}`;

        const res = await fetch(url);
        if (!res.ok) {
          console.error(`❌ NewsAPI error for "${query}":`, res.statusText);
          continue;
        }

        const data = await res.json();
        if (data.articles) {
          allArticles.push(...data.articles);
        }

        await new Promise(r => setTimeout(r, 500)); // Rate limiting
      }

      console.log(`   Found ${allArticles.length} articles total\n`);

      // Extract names with context validation
      const namePattern = /([A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/g;
      const mentionedNames = new Map<string, { count: number; sources: string[]; contexts: string[] }>();

      // Context keywords that indicate someone works at xAI
      const employeeContexts = [
        'xai researcher', 'xai engineer', 'xai scientist', 'xai employee',
        'works at xai', 'working at xai', 'joined xai', 'at xai',
        'xai team member', 'xai staff', 'hired by xai'
      ];

      const excludePatterns = [
        'elon musk', 'sam altman', 'mark zuckerberg', 'sundar pichai',
        'satya nadella', 'jeff bezos', 'bill gates', 'larry page',
        'openai', 'google', 'microsoft', 'meta', 'anthropic'
      ];

      for (const article of allArticles) {
        const text = `${article.title} ${article.description || ''} ${article.content || ''}`;
        const textLower = text.toLowerCase();
        const matches = text.match(namePattern) || [];

        for (const name of matches) {
          const nameLower = name.toLowerCase();

          // Skip obvious false positives
          if (name.length < 6 || name.split(' ').length > 3) continue;
          if (excludePatterns.some(pattern => nameLower.includes(pattern))) continue;

          // Check if name appears near xAI context keywords
          const nameIndex = textLower.indexOf(nameLower);
          if (nameIndex === -1) continue;

          const contextWindow = textLower.substring(
            Math.max(0, nameIndex - 100),
            Math.min(textLower.length, nameIndex + 100)
          );

          const hasEmployeeContext = employeeContexts.some(ctx => contextWindow.includes(ctx));

          if (hasEmployeeContext) {
            if (!mentionedNames.has(name)) {
              mentionedNames.set(name, { count: 0, sources: [], contexts: [] });
            }
            const entry = mentionedNames.get(name)!;
            entry.count++;
            if (!entry.sources.includes(article.url)) {
              entry.sources.push(article.url);
            }
            // Store context snippet
            const contextSnippet = text.substring(
              Math.max(0, nameIndex - 50),
              Math.min(text.length, nameIndex + name.length + 50)
            );
            entry.contexts.push(contextSnippet.replace(/\n/g, ' ').trim());
          }
        }
      }

      // Add high-confidence mentions (mentioned 2+ times with employee context)
      let addedCount = 0;
      for (const [name, data] of mentionedNames.entries()) {
        if (data.count >= 2) {
          this.people.push({
            name,
            title: undefined,
            company: 'xAI',
            location: undefined,
            locationConfidence: 'low',
            githubUrl: undefined,
            openAlexUrl: undefined,
            homepageUrl: undefined,
            xaiPageUrl: undefined,
            otherSources: data.sources.slice(0, 3),
            isResearchLike: true,
            researchScore: 0.5,
            notes: `Mentioned as xAI employee in ${data.count} news articles | Context: ${data.contexts[0].substring(0, 80)}...`
          });
          console.log(`   ✓ ${name} (${data.count} mentions with employee context)`);
          addedCount++;
        }
      }

      console.log(`\n   Added ${addedCount} people from press mentions (context-validated)\n`);

      if (addedCount === 0) {
        console.log('   💡 Tip: Press mentions work best for companies with recent news coverage.\n');
      }
    } catch (err) {
      console.error('❌ NewsAPI error:', (err as Error).message);
    }
  }

  /**
   * SOURCE 5: Hacker News discussions
   * Fetches comments/submissions mentioning xAI (free API, no auth needed)
   */
  async fetchHackerNewsDiscussions() {
    console.log('🔶 HACKER NEWS: Searching for xAI discussions...\n');

    try {
      // Use Algolia HN Search API
      const queries = ['xAI', 'x.ai', 'Grok'];
      const mentionedUsers = new Map<string, { karma: number; submissions: string[] }>();

      for (const query of queries) {
        const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=50`;

        const res = await fetch(url);
        if (!res.ok) continue;

        const data = await res.json();

        for (const hit of data.hits || []) {
          if (hit.author) {
            if (!mentionedUsers.has(hit.author)) {
              mentionedUsers.set(hit.author, { karma: 0, submissions: [] });
            }
            mentionedUsers.get(hit.author)!.submissions.push(hit.url || hit.objectID);
          }
        }

        await new Promise(r => setTimeout(r, 300));
      }

      console.log(`   Found ${mentionedUsers.size} HN users discussing xAI\n`);

      // Fetch user details for active contributors
      let addedCount = 0;
      for (const [username, data] of mentionedUsers.entries()) {
        if (data.submissions.length >= 2) {
          const userRes = await fetch(`https://hacker-news.firebaseio.com/v0/user/${username}.json`);
          if (userRes.ok) {
            const userData = await userRes.json();

            this.people.push({
              name: username,
              title: undefined,
              company: 'xAI',
              location: undefined,
              locationConfidence: 'low',
              githubUrl: undefined,
              openAlexUrl: undefined,
              homepageUrl: undefined,
              xaiPageUrl: undefined,
              otherSources: [`https://news.ycombinator.com/user?id=${username}`],
              isResearchLike: true,
              researchScore: 0.4,
              notes: `Active on HN discussing xAI (${userData.karma || 0} karma, ${data.submissions.length} posts)`
            });
            console.log(`   ✓ ${username} (${userData.karma || 0} karma)`);
            addedCount++;
          }
          await new Promise(r => setTimeout(r, 200));
        }
      }

      console.log(`\n   Added ${addedCount} people from Hacker News\n`);
    } catch (err) {
      console.error('❌ Hacker News error:', (err as Error).message);
    }
  }

  /**
   * SOURCE 6: Reddit discussions
   * Fetches posts/comments about xAI from relevant subreddits
   */
  async fetchRedditDiscussions() {
    console.log('🔴 REDDIT: Searching for xAI discussions...\n');

    if (!this.redditClientId || !this.redditClientSecret) {
      console.log('⚠️  No Reddit API credentials found. Skipping Reddit.');
      console.log('   Get free credentials at: https://www.reddit.com/prefs/apps\n');
      return;
    }

    try {
      // Get OAuth token
      const authRes = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${this.redditClientId}:${this.redditClientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
      });

      if (!authRes.ok) {
        console.error('❌ Reddit auth failed:', authRes.statusText);
        return;
      }

      const authData = await authRes.json();
      const accessToken = authData.access_token;

      // Search relevant subreddits
      const subreddits = ['MachineLearning', 'artificial', 'singularity', 'LocalLLaMA'];
      const queries = ['xAI', 'x.ai', 'Grok AI'];

      let totalPosts = 0;
      for (const subreddit of subreddits) {
        for (const query of queries) {
          const url = `https://oauth.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&limit=25&sort=relevance`;

          const res = await fetch(url, {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'User-Agent': 'xAI-Researcher-Mapper/1.0'
            }
          });

          if (res.ok) {
            const data = await res.json();
            const posts = data.data?.children || [];
            totalPosts += posts.length;

            for (const post of posts) {
              const author = post.data.author;
              if (author && author !== '[deleted]' && author !== 'AutoModerator') {
                this.people.push({
                  name: author,
                  title: undefined,
                  company: 'xAI',
                  location: undefined,
                  locationConfidence: 'low',
                  githubUrl: undefined,
                  openAlexUrl: undefined,
                  homepageUrl: undefined,
                  xaiPageUrl: undefined,
                  otherSources: [`https://reddit.com/u/${author}`],
                  isResearchLike: true,
                  researchScore: 0.3,
                  notes: `Posted about xAI on r/${subreddit}`
                });
              }
            }
          }

          await new Promise(r => setTimeout(r, 1000)); // Reddit rate limit: 60/min
        }
      }

      console.log(`   Found ${totalPosts} Reddit posts about xAI\n`);
    } catch (err) {
      console.error('❌ Reddit error:', (err as Error).message);
    }
  }

  /**
   * SOURCE 7: Twitter/X mentions (web scraping fallback if no API token)
   */
  async scrapeTwitterMentions() {
    if (!this.page) return;

    console.log('🐦 TWITTER/X: Searching for xAI mentions...\n');

    if (this.twitterToken) {
      // Use Twitter API if token available
      await this.fetchTwitterAPI();
    } else {
      // Web scraping fallback
      console.log('⚠️  No Twitter API token. Using web scraping (limited results).\n');

      try {
        const searchUrl = 'https://twitter.com/search?q=xAI%20OR%20%22x.ai%22&src=typed_query&f=live';
        await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await this.page.waitForTimeout(3000);

        const tweets = await this.page.evaluate(() => {
          const results: Array<{ author: string; text: string; url: string }> = [];
          const articles = document.querySelectorAll('article[data-testid="tweet"]');

          articles.forEach(article => {
            const authorEl = article.querySelector('[data-testid="User-Name"] a');
            const textEl = article.querySelector('[data-testid="tweetText"]');

            if (authorEl && textEl) {
              const author = authorEl.getAttribute('href')?.replace('/', '') || '';
              const text = textEl.textContent || '';
              const url = authorEl.getAttribute('href') || '';

              if (author && text.toLowerCase().includes('xai')) {
                results.push({ author, text, url: `https://twitter.com${url}` });
              }
            }
          });

          return results;
        });

        console.log(`   Found ${tweets.length} tweets mentioning xAI\n`);

        for (const tweet of tweets.slice(0, 20)) {
          this.people.push({
            name: tweet.author,
            title: undefined,
            company: 'xAI',
            location: undefined,
            locationConfidence: 'low',
            githubUrl: undefined,
            openAlexUrl: undefined,
            homepageUrl: undefined,
            xaiPageUrl: undefined,
            otherSources: [tweet.url],
            isResearchLike: false,
            researchScore: 0.2,
            notes: 'Tweeted about xAI'
          });
          console.log(`   ✓ @${tweet.author}`);
        }

        console.log();
      } catch (err) {
        console.warn('⚠️  Twitter scraping failed:', (err as Error).message);
        console.log('   Consider getting Twitter API access or skip this source.\n');
      }
    }
  }

  /**
   * Twitter API implementation (if bearer token available)
   */
  private async fetchTwitterAPI() {
    try {
      const queries = ['xAI', 'x.ai', 'Grok AI'];
      let totalTweets = 0;

      for (const query of queries) {
        const url = `https://api.twitter.com/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=100&tweet.fields=author_id&expansions=author_id&user.fields=username,name,location`;

        const res = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${this.twitterToken}`,
            'User-Agent': 'xAI-Researcher-Mapper/1.0'
          }
        });

        if (!res.ok) {
          console.error(`❌ Twitter API error for "${query}":`, res.statusText);
          continue;
        }

        const data = await res.json();
        const users = data.includes?.users || [];
        totalTweets += data.data?.length || 0;

        for (const user of users) {
          this.people.push({
            name: user.name || user.username,
            title: undefined,
            company: 'xAI',
            location: user.location || undefined,
            locationConfidence: user.location ? 'medium' : 'low',
            githubUrl: undefined,
            openAlexUrl: undefined,
            homepageUrl: undefined,
            xaiPageUrl: undefined,
            otherSources: [`https://twitter.com/${user.username}`],
            isResearchLike: false,
            researchScore: 0.3,
            notes: 'Tweeted about xAI'
          });
          console.log(`   ✓ @${user.username}`);
        }

        await new Promise(r => setTimeout(r, 1000));
      }

      console.log(`\n   Processed ${totalTweets} tweets\n`);
    } catch (err) {
      console.error('❌ Twitter API error:', (err as Error).message);
    }
  }

  /**
   * Simple keyword-based research classifier.
   */
  private isResearchLike(text: string): boolean {
    const keywords = [
      'research',
      'scientist',
      'machine learning',
      'ml',
      'ai',
      'deep learning',
      'nlp',
      'vision',
      'robotics'
    ];

    return keywords.some((k) => text.includes(k));
  }

  private computeResearchScore(text: string): number {
    const keywords = [
      'research',
      'scientist',
      'machine learning',
      'ml',
      'ai',
      'deep learning',
      'nlp',
      'vision',
      'robotics'
    ];

    const hits = keywords.filter((k) => text.includes(k)).length;
    return Math.min(1, hits / keywords.length + 0.2);
  }

  /**
   * Deduplicate and merge by name + GitHub/OpenAlex URLs.
   */
  private deduplicatePeople() {
    const seen = new Map<string, PublicResearcher>();

    for (const person of this.people) {
      const key =
        person.githubUrl ||
        person.openAlexUrl ||
        person.name.toLowerCase().trim();

      const existing = seen.get(key);

      if (!existing) {
        seen.set(key, person);
      } else {
        const merged: PublicResearcher = {
          ...existing
        };

        // Prefer more specific data
        merged.title = merged.title || person.title;
        merged.company = merged.company || person.company;
        merged.location = merged.location || person.location;

        // Location confidence: pick higher
        const confRank: Record<PublicResearcher['locationConfidence'], number> = {
          low: 0,
          medium: 1,
          high: 2
        };
        if (confRank[person.locationConfidence] > confRank[merged.locationConfidence]) {
          merged.locationConfidence = person.locationConfidence;
        }

        merged.githubUrl = merged.githubUrl || person.githubUrl;
        merged.openAlexUrl = merged.openAlexUrl || person.openAlexUrl;
        merged.homepageUrl = merged.homepageUrl || person.homepageUrl;
        merged.xaiPageUrl = merged.xaiPageUrl || person.xaiPageUrl;

        // Merge sources
        merged.otherSources = Array.from(
          new Set([...(merged.otherSources || []), ...(person.otherSources || [])])
        );

        // Raise researchScore if multiple sources agree
        merged.researchScore = Math.min(
          1,
          Math.max(merged.researchScore, person.researchScore) + 0.1
        );
        merged.isResearchLike = merged.isResearchLike || person.isResearchLike;

        merged.notes = [merged.notes, person.notes]
          .filter(Boolean)
          .join(' | ');

        seen.set(key, merged);
      }
    }

    this.people = Array.from(seen.values());
    console.log(`🔄 After deduplication: ${this.people.length} unique people\n`);
  }

  /**
   * Export results (no PII, only public metadata)
   */
  async exportResults(filename: string) {
    this.deduplicatePeople();

    // Enhanced Bay Area filter - includes more cities
    const bayAreaKeywords = [
      'palo alto', 'bay area', 'san francisco', 'mountain view', 'menlo park',
      'sunnyvale', 'redwood city', 'cupertino', 'silicon valley', 'san jose',
      'oakland', 'berkeley', 'fremont', 'santa clara', 'sf,', 'california', 'ca'
    ];
    const bayAreaPeople = this.people.filter((p) => {
      const loc = (p.location || '').toLowerCase();
      return bayAreaKeywords.some((k) => loc.includes(k));
    });

    console.log('📊 FINAL SUMMARY:');
    console.log('='.repeat(70));
    console.log(`   Total public profiles: ${this.people.length}`);
    console.log(`   Likely Bay Area: ${bayAreaPeople.length}`);
    console.log(
      `   Marked research-like: ${this.people.filter((p) => p.isResearchLike).length}`
    );
    console.log('='.repeat(70) + '\n');

    const csvWriter = createObjectCsvWriter({
      path: filename,
      header: [
        { id: 'name', title: 'Name' },
        { id: 'title', title: 'Title' },
        { id: 'company', title: 'Company' },
        { id: 'location', title: 'Location' },
        { id: 'locationConfidence', title: 'Location Confidence' },
        { id: 'githubUrl', title: 'GitHub' },
        { id: 'openAlexUrl', title: 'OpenAlex' },
        { id: 'xaiPageUrl', title: 'xAI Page' },
        { id: 'homepageUrl', title: 'Homepage' },
        { id: 'isResearchLike', title: 'Research-like' },
        { id: 'researchScore', title: 'Research Score' },
        { id: 'otherSourcesStr', title: 'Sources' },
        { id: 'notes', title: 'Notes' }
      ]
    });

    const records = this.people.map((p) => ({
      ...p,
      otherSourcesStr: (p.otherSources || []).join(' | ')
    }));

    await csvWriter.writeRecords(records);

    console.log(`✅ Exported public researcher map to ${filename}\n`);

    // Optional: write a README-style txt summary for the VC / organiser
    const txtFile = filename.replace('.csv', '_summary.txt');
    const content =
      `xAI PUBLIC RESEARCHER MAP (NO CONTACT DATA)\n` +
      `Generated: ${new Date().toISOString()}\n\n` +
      `Total public profiles: ${this.people.length}\n` +
      `Likely Bay Area: ${bayAreaPeople.length}\n\n` +
      `This file intentionally excludes emails and phone numbers.\n` +
      `It is designed as a discovery layer only. Any outreach must be\n` +
      `done manually or via compliant third-party services.\n`;

    fs.writeFileSync(txtFile, content);
    console.log(`✅ Summary: ${txtFile}\n`);
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      console.log('👋 Browser closed\n');
    }
  }
}

// CLI entrypoint
async function main() {
  const mapper = new XAIPublicResearcherMapper();

  try {
    await mapper.initialize();

    // Technical sources
    await mapper.scrapeXAISite();
    await mapper.fetchGitHubOrgMembers();
    await mapper.fetchGitHubContributors();
    await mapper.fetchOpenAlexResearchers();

    // Social media & press sources (optional - skip if no API keys)
    // NOTE: These find people DISCUSSING xAI, not necessarily employees
    await mapper.fetchPressMentions();              // NewsAPI - context-validated employee mentions

    // Uncomment below if you want social media discussions (NOT employees, just interested people)
    // await mapper.fetchHackerNewsDiscussions();   // Free, no auth needed
    // await mapper.fetchRedditDiscussions();       // Reddit API
    // await mapper.scrapeTwitterMentions();        // Twitter/X

    await mapper.exportResults('xai_public_researchers.csv');

    console.log('🎉 Done! Check your CSV and summary files.\n');
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  } finally {
    await mapper.close();
  }
}

if (require.main === module) {
  main();
}

export { XAIPublicResearcherMapper };
