import { chromium, Browser, Page } from 'playwright';
import { createObjectCsvWriter } from 'csv-writer';
import * as fs from 'fs';

interface Researcher {
  name: string;
  title?: string;
  location?: string;
  githubUsername?: string;
  twitterUsername?: string;
  email?: string;
  source: string;
  sourceUrl: string;
  confidence: 'high' | 'medium' | 'low';
  researchArea?: string;
}

class ResearcherFocusedScraper {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private researchers: Researcher[] = [];

  // Exclude executives and founders
  private executiveTitles = [
    'ceo', 'cfo', 'cto', 'chief', 'co-founder', 'founder',
    'president', 'vp', 'vice president', 'head of', 'director'
  ];

  // Focus on research/engineering roles
  private researcherTitles = [
    'research scientist', 'research engineer', 'ml engineer',
    'machine learning engineer', 'ai researcher', 'ai engineer',
    'software engineer', 'applied scientist', 'research intern',
    'phd', 'postdoc', 'member of technical staff'
  ];

  async initialize() {
    console.log('🚀 Initializing browser for researcher search...');
    this.browser = await chromium.launch({
      headless: false,
      slowMo: 50
    });

    const context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    });

    this.page = await context.newPage();
  }

  // 1. Scrape xAI's GitHub organization for Grok contributors
  async scrapeGitHubGrokContributors() {
    if (!this.page) throw new Error('Browser not initialized');

    console.log('\n💻 Scraping GitHub xai-org/grok-1 contributors...');

    try {
      await this.page.goto('https://github.com/xai-org/grok-1/graphs/contributors', {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      await this.page.waitForTimeout(3000);

      const contributors = await this.page.evaluate(() => {
        const results: Array<{ username: string; name: string; contributions: string }> = [];

        // Find contributor elements
        const contribElements = document.querySelectorAll('.contrib-person, [data-hovercard-type="user"]');

        contribElements.forEach((elem: Element) => {
          const link = elem.querySelector('a[data-hovercard-type="user"]');
          const username = link?.getAttribute('href')?.replace('/', '') || '';
          const name = elem.textContent?.trim() || '';

          if (username && username.length > 0) {
            results.push({
              username,
              name,
              contributions: elem.textContent?.trim() || ''
            });
          }
        });

        return results;
      });

      console.log(`✅ Found ${contributors.length} GitHub contributors to Grok-1`);

      // Now get more info about each contributor
      for (const contrib of contributors.slice(0, 20)) { // Limit to avoid rate limits
        try {
          await this.page.goto(`https://github.com/${contrib.username}`, {
            waitUntil: 'networkidle',
            timeout: 15000
          });

          await this.page.waitForTimeout(1500);

          const profileData = await this.page.evaluate(() => {
            const name = document.querySelector('[itemprop="name"]')?.textContent?.trim();
            const bio = document.querySelector('[data-bio-text]')?.textContent?.trim();
            const location = document.querySelector('[itemprop="homeLocation"]')?.textContent?.trim();
            const twitter = document.querySelector('a[href*="twitter.com"], a[href*="x.com"]')?.getAttribute('href');

            return { name, bio, location, twitter };
          });

          // Check if bio mentions xAI
          const bioLower = (profileData.bio || '').toLowerCase();
          if (bioLower.includes('xai') || bioLower.includes('x.ai') || bioLower.includes('grok')) {
            this.researchers.push({
              name: profileData.name || contrib.username,
              location: profileData.location,
              githubUsername: contrib.username,
              twitterUsername: profileData.twitter?.split('/').pop(),
              source: 'GitHub - Grok Contributor',
              sourceUrl: `https://github.com/${contrib.username}`,
              confidence: 'high',
              researchArea: profileData.bio
            });

            console.log(`   ✓ Found: ${profileData.name || contrib.username} (${profileData.location || 'location unknown'})`);
          }

        } catch (e) {
          console.log(`   ⚠️  Could not fetch profile for ${contrib.username}`);
        }
      }

    } catch (error) {
      console.error('❌ Error scraping GitHub:', error);
    }
  }

  // 2. Search Twitter/X for people posting about working at xAI
  async searchTwitterForXAIResearchers() {
    if (!this.page) throw new Error('Browser not initialized');

    console.log('\n🐦 Searching Twitter/X for xAI researchers...');

    try {
      const searchQueries = [
        'working at xAI',
        'joined xAI',
        'xAI team',
        '"@xai" engineer',
        '"@xai" researcher'
      ];

      for (const query of searchQueries) {
        try {
          const url = `https://twitter.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=user`;
          console.log(`   Searching: "${query}"...`);

          await this.page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
          await this.page.waitForTimeout(3000);

          // Note: Twitter requires login for search, so this might not work without auth
          const isLoginRequired = await this.page.url().includes('login');

          if (isLoginRequired) {
            console.log('   ⚠️  Twitter requires login - skipping Twitter search');
            break;
          }

          // Extract user profiles from search results
          const profiles = await this.page.evaluate(() => {
            const results: Array<{ username: string; name: string; bio: string }> = [];

            const userElements = document.querySelectorAll('[data-testid="UserCell"]');

            userElements.forEach((elem: Element) => {
              const username = elem.querySelector('[href^="/"]')?.getAttribute('href')?.replace('/', '');
              const name = elem.querySelector('[dir="ltr"] span')?.textContent?.trim();
              const bio = elem.querySelector('[dir="auto"]')?.textContent?.trim();

              if (username && name) {
                results.push({ username, name, bio: bio || '' });
              }
            });

            return results;
          });

          profiles.forEach(profile => {
            if (!this.researchers.find(r => r.twitterUsername === profile.username)) {
              this.researchers.push({
                name: profile.name,
                twitterUsername: profile.username,
                source: 'Twitter/X',
                sourceUrl: `https://twitter.com/${profile.username}`,
                confidence: 'medium',
                researchArea: profile.bio
              });
            }
          });

          console.log(`   Found ${profiles.length} profiles`);

          await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (e) {
          console.log(`   ⚠️  Could not complete Twitter search`);
        }
      }

    } catch (error) {
      console.log('⚠️  Twitter search requires authentication - skipping');
    }
  }

  // 3. Scrape xAI careers page to understand team structure
  async analyzeXAICareersPage() {
    if (!this.page) throw new Error('Browser not initialized');

    console.log('\n💼 Analyzing xAI careers page for researcher roles...');

    try {
      const researcherTitles = this.researcherTitles;

      await this.page.goto('https://x.ai/careers/open-roles/', {
        waitUntil: 'networkidle',
        timeout: 30000
      });

      await this.page.waitForTimeout(2000);

      const jobData = await this.page.evaluate((titles) => {
        const jobs: Array<{ title: string; location: string; description: string }> = [];

        // Look for job listings
        const jobElements = document.querySelectorAll('[class*="job"], [class*="position"], [class*="opening"]');

        jobElements.forEach((job: Element) => {
          const title = job.querySelector('h3, h4, [class*="title"]')?.textContent?.trim() || '';
          const location = job.textContent?.match(/Palo Alto|San Francisco|Remote/gi)?.[0] || '';
          const description = job.textContent?.trim() || '';

          if (title.length > 5) {
            jobs.push({ title, location, description });
          }
        });

        return jobs;
      }, researcherTitles);

      console.log(`✅ Found ${jobData.length} open positions`);

      // Count researcher positions
      const researcherJobs = jobData.filter(job => {
        const titleLower = job.title.toLowerCase();
        return researcherTitles.some(rt => titleLower.includes(rt));
      });

      console.log(`   ${researcherJobs.length} are researcher/engineer roles`);

      const paloAltoJobs = researcherJobs.filter(job =>
        job.location.toLowerCase().includes('palo alto')
      );

      console.log(`   ${paloAltoJobs.length} researcher roles in Palo Alto`);

      // Print sample roles
      console.log('\n   Sample roles:');
      researcherJobs.slice(0, 5).forEach(job => {
        console.log(`   - ${job.title} (${job.location})`);
      });

    } catch (error) {
      console.log('⚠️  Could not access careers page');
    }
  }

  // 4. Search for xAI researchers on LinkedIn (manual lookup guidance)
  generateLinkedInSearchQueries(): string[] {
    return [
      'xAI Research Scientist Palo Alto',
      'xAI Machine Learning Engineer',
      'xAI AI Researcher',
      'xAI Software Engineer Palo Alto',
      'xAI Member Technical Staff',
      'xAI Applied Scientist'
    ];
  }

  // 5. Check for conference presentations/papers
  async searchForConferencePresentations() {
    if (!this.page) throw new Error('Browser not initialized');

    console.log('\n📚 Searching for xAI researchers at conferences...');

    try {
      // Search for NeurIPS, ICML, ICLR presentations
      const conferences = [
        'NeurIPS 2024 xAI',
        'ICML 2024 xAI',
        'ICLR 2024 xAI'
      ];

      for (const conf of conferences) {
        try {
          await this.page.goto(
            `https://www.google.com/search?q=${encodeURIComponent(conf + ' speakers')}`,
            { waitUntil: 'networkidle', timeout: 15000 }
          );

          await this.page.waitForTimeout(2000);

          console.log(`   Checked: ${conf}`);

        } catch (e) {
          console.log(`   ⚠️  Could not search ${conf}`);
        }
      }

    } catch (error) {
      console.log('⚠️  Conference search not available');
    }
  }

  // Filter out executives
  private isResearcher(title: string): boolean {
    const titleLower = title.toLowerCase();

    // Exclude executives
    if (this.executiveTitles.some(et => titleLower.includes(et))) {
      return false;
    }

    // Include researchers
    return this.researcherTitles.some(rt => titleLower.includes(rt)) ||
           titleLower.includes('engineer') ||
           titleLower.includes('scientist');
  }

  // Filter for Palo Alto
  filterByPaloAlto(): Researcher[] {
    return this.researchers.filter(r =>
      r.location?.toLowerCase().includes('palo alto') ||
      r.location?.toLowerCase().includes('bay area') ||
      !r.location // Include if location unknown (we can verify manually)
    );
  }

  // Deduplicate
  private deduplicateResearchers() {
    const seen = new Map<string, Researcher>();

    for (const researcher of this.researchers) {
      const key = researcher.name.toLowerCase().trim();
      const existing = seen.get(key);

      if (!existing) {
        seen.set(key, researcher);
      } else if (researcher.confidence === 'high' && existing.confidence !== 'high') {
        seen.set(key, researcher);
      }
    }

    this.researchers = Array.from(seen.values());
    console.log(`\n🔄 After deduplication: ${this.researchers.length} unique researchers`);
  }

  // Export results
  async exportResults(filename: string) {
    this.deduplicateResearchers();

    const paloAltoResearchers = this.filterByPaloAlto();

    console.log(`\n📊 Final Summary:`);
    console.log(`   Total people found: ${this.researchers.length}`);
    console.log(`   In/near Palo Alto: ${paloAltoResearchers.length}`);

    // Export to CSV
    const csvWriter = createObjectCsvWriter({
      path: filename,
      header: [
        { id: 'name', title: 'Name' },
        { id: 'title', title: 'Title' },
        { id: 'location', title: 'Location' },
        { id: 'githubUsername', title: 'GitHub' },
        { id: 'twitterUsername', title: 'Twitter/X' },
        { id: 'email', title: 'Email' },
        { id: 'researchArea', title: 'Research Area/Bio' },
        { id: 'source', title: 'Source' },
        { id: 'sourceUrl', title: 'Source URL' },
        { id: 'confidence', title: 'Confidence' },
        { id: 'linkedinValidation', title: 'LinkedIn Validation' }
      ]
    });

    const records = paloAltoResearchers.map(r => ({
      ...r,
      linkedinValidation: '☐ TODO: Search on LinkedIn'
    }));

    await csvWriter.writeRecords(records);
    console.log(`\n✅ Exported to ${filename}`);

    // Create researcher contact list
    const txtFilename = filename.replace('.csv', '_dinner_list.txt');
    const dinnerList = paloAltoResearchers.map((researcher, idx) =>
      `${idx + 1}. ${researcher.name}${researcher.title ? ` - ${researcher.title}` : ''}\n` +
      `   GitHub: ${researcher.githubUsername ? `github.com/${researcher.githubUsername}` : 'N/A'}\n` +
      `   Twitter: ${researcher.twitterUsername ? `@${researcher.twitterUsername}` : 'N/A'}\n` +
      `   Research: ${researcher.researchArea || 'Check their GitHub/profile'}\n` +
      `   Source: ${researcher.source} (${researcher.confidence})\n` +
      `   \n` +
      `   TODO:\n` +
      `   ☐ Search "${researcher.name} xAI" on LinkedIn manually\n` +
      `   ☐ Verify they work at xAI\n` +
      `   ☐ Check if in Palo Alto office\n` +
      `   ☐ Find email (try: ${this.guessEmail(researcher.name)})\n` +
      `   ☐ Send dinner invitation`
    ).join('\n\n');

    const linkedinSearches = this.generateLinkedInSearchQueries();

    fs.writeFileSync(txtFilename,
      `xAI AI RESEARCHERS in Palo Alto - Dinner Invitation List\n` +
      `Generated: ${new Date().toLocaleString()}\n` +
      `Focus: Working-level researchers & engineers (NOT executives)\n` +
      `Total: ${paloAltoResearchers.length} people\n\n` +
      `${'='.repeat(70)}\n\n` +
      `MANUAL LINKEDIN SEARCHES TO TRY:\n\n` +
      linkedinSearches.map((q, i) => `${i + 1}. "${q}"`).join('\n') + '\n\n' +
      `${'='.repeat(70)}\n\n` +
      `RESEARCHERS FOUND:\n\n` +
      dinnerList +
      `\n\n${'='.repeat(70)}\n\n` +
      `TIPS FOR FINDING MORE RESEARCHERS:\n` +
      `1. Search LinkedIn with the queries above (manually, no automation)\n` +
      `2. Look at who's liking/commenting on xAI's posts on Twitter/X\n` +
      `3. Check GitHub issues/PRs on xai-org/grok-1 for contributors\n` +
      `4. Search Twitter for "just joined xAI" or "excited to announce xAI"\n` +
      `5. Look for xAI job postings and note hiring manager names\n` +
      `\n` +
      `DINNER INVITATION TIPS:\n` +
      `- Mention their specific work (GitHub contributions, research area)\n` +
      `- Keep it casual and genuine\n` +
      `- Offer to discuss AI research trends\n` +
      `- Small group (5-8 people) works best for meaningful conversation`
    );

    console.log(`✅ Researcher list created: ${txtFilename}`);

    // Print preview
    console.log(`\n👥 Researchers Found:\n`);
    paloAltoResearchers.slice(0, 10).forEach((researcher, idx) => {
      console.log(`${idx + 1}. ${researcher.name} [${researcher.confidence}]`);
      if (researcher.githubUsername) {
        console.log(`   GitHub: github.com/${researcher.githubUsername}`);
      }
      if (researcher.researchArea) {
        console.log(`   ${researcher.researchArea.substring(0, 60)}...`);
      }
    });

    if (paloAltoResearchers.length > 10) {
      console.log(`\n... and ${paloAltoResearchers.length - 10} more in the files`);
    }

    if (paloAltoResearchers.length === 0) {
      console.log('\n💡 No researchers found automatically.');
      console.log('   Use the LinkedIn search queries in the output file to find them manually.');
    }

    return paloAltoResearchers;
  }

  private guessEmail(name: string): string {
    const parts = name.toLowerCase().split(' ');
    if (parts.length >= 2) {
      return `${parts[0]}@x.ai or ${parts[0]}.${parts[1]}@x.ai`;
    }
    return 'firstname@x.ai';
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      console.log('\n👋 Browser closed');
    }
  }

  getStats() {
    return {
      total: this.researchers.length,
      paloAlto: this.filterByPaloAlto().length,
      withGitHub: this.researchers.filter(r => r.githubUsername).length,
      byConfidence: {
        high: this.researchers.filter(r => r.confidence === 'high').length,
        medium: this.researchers.filter(r => r.confidence === 'medium').length,
        low: this.researchers.filter(r => r.confidence === 'low').length
      }
    };
  }
}

// Main execution
async function main() {
  console.log('🎯 xAI RESEARCHER Finder - Focused on Working-Level AI Researchers');
  console.log('   (Excluding executives, founders, and C-level)');
  console.log('='.repeat(70));

  const scraper = new ResearcherFocusedScraper();

  try {
    await scraper.initialize();

    // Run all scrapers
    await scraper.scrapeGitHubGrokContributors();
    await scraper.searchTwitterForXAIResearchers();
    await scraper.analyzeXAICareersPage();
    await scraper.searchForConferencePresentations();

    // Export results
    const results = await scraper.exportResults('xai_researchers_only.csv');

    console.log('\n' + '='.repeat(70));
    console.log('🎉 Search complete!');
    console.log('='.repeat(70));

    const stats = scraper.getStats();
    console.log(`\n📈 Statistics:`);
    console.log(`   Total researchers found: ${stats.total}`);
    console.log(`   In/near Palo Alto: ${stats.paloAlto}`);
    console.log(`   With GitHub profiles: ${stats.withGitHub}`);
    console.log(`\n   By Confidence:`);
    console.log(`   High: ${stats.byConfidence.high}`);
    console.log(`   Medium: ${stats.byConfidence.medium}`);
    console.log(`   Low: ${stats.byConfidence.low}`);

    console.log('\n📋 Next Steps:');
    console.log('   1. Open xai_researchers_only.csv in Excel/Sheets');
    console.log('   2. Review xai_researchers_only_dinner_list.txt');
    console.log('   3. Use the LinkedIn search queries to find more researchers');
    console.log('   4. Manually validate each person');
    console.log('   5. Send personalized dinner invitations');

    console.log('\n💡 Pro Tips:');
    console.log('   - Focus on GitHub contributors first (high confidence)');
    console.log('   - Check who stars/watches xai-org/grok-1 repo');
    console.log('   - Look for people discussing xAI on Twitter/X');
    console.log('   - Search "Member of Technical Staff xAI" on LinkedIn');

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await scraper.close();
  }
}

if (require.main === module) {
  main();
}

export { ResearcherFocusedScraper, Researcher };
