# xAI Researcher Scraper

Find xAI researchers with public data from GitHub, LinkedIn (company page), OpenAlex, and optional NewsAPI. Exports CSV + summary text.

## What it does
- GitHub API: org members and contributors across xai-org repos
- LinkedIn: xAI company people page filtered to Bay Area engineering (manual login; sets location to Palo Alto, CA)
- OpenAlex: authors with xAI-like affiliation
- NewsAPI (optional): press mentions with xAI employment context
- Dedupes and scores “research-like” titles; outputs `xai_public_researchers.csv` and a summary txt.

## Requirements
- Node.js 16+
- npm
- GitHub API token (recommended for higher limits)
- Optional: `NEWSAPI_KEY` for press mentions
- LinkedIn: you must log in when prompted (CLI) or provide `li_at` cookie (web app); scraping LinkedIn violates their ToS.

## Setup
```bash
npm install
cp .env.example .env   # optional; set GitHub token, NEWSAPI_KEY, etc.
```

## Run the CLI scraper (recommended)
```bash
npm run scrape
```
- A Chromium window opens for LinkedIn. Log in within ~30s; it scrolls and gathers Bay Area engineering profiles.
- GitHub/OpenAlex/NewsAPI run headless.
- Outputs: `xai_public_researchers.csv` and `xai_public_researchers_summary.txt`.

## Web app (self-hosted Node)
Path: `xai-scraper-web/`
```bash
cd xai-scraper-web
npm install
npm run dev
# open http://localhost:3000
```
- Required: GitHub token
- Optional: NewsAPI key
- Optional: LinkedIn `li_at` cookie (copy from browser devtools → Application/Storage → Cookies → linkedin.com -> find li_at and copy token). Only works on self-hosted Node (Playwright); do not use serverless.

## Notes and safety
- Scraping LinkedIn requires authentication and may violate their Terms of Service; use at your own risk.
- The “GitHub-only” old script is ignored from git; the main flow is `npm run scrape`.
- CSV/text outputs are in the repo root.***
- **AI keywords**: Update `aiKeywords` array in line 123
- **Location filter**: Change location string in `getAIResearchersInPaloAlto()` method

### LinkedIn Selectors

If LinkedIn changes their page structure, update the selectors in the `scrapeLinkedInCompany()` method around line 63:
```typescript
const employeeCards = document.querySelectorAll('[data-chameleon-result-urn]');
```

## Important Notes

### Legal & Ethical Considerations

- ⚠️ **LinkedIn Terms of Service**: Scraping LinkedIn may violate their ToS. Use responsibly and only for legitimate purposes.
- 🔒 **Authentication Required**: You must log in to LinkedIn manually during scraping
- 🤖 **Rate Limiting**: The scraper includes delays to be respectful of LinkedIn's servers
- 📜 **Data Privacy**: Handle scraped data responsibly and in compliance with privacy laws

### Limitations

- Requires manual LinkedIn login
- LinkedIn may detect and block automated scraping
- Results depend on LinkedIn's current page structure
- May not capture all employees if they're not listed publicly
- Location data accuracy depends on how employees set their LinkedIn location

## Troubleshooting

### "Browser not initialized" error
Run `npm run scrape` again. Ensure Playwright is properly installed.

### No data scraped
1. Check if you logged in to LinkedIn when prompted
2. LinkedIn may have changed their page structure - update selectors
3. Try running with `headless: false` to debug visually

### LinkedIn blocking
- Add longer delays between actions
- Use a residential IP address
- Consider using LinkedIn's official API instead

## Data Sources Comparison

| Source | Legal? | Automation OK? | Recommended |
|--------|--------|----------------|-------------|
| xAI Website | ✅ Yes | ✅ Yes | ✅ |
| ArXiv Papers | ✅ Yes | ✅ Yes | ✅ |
| GitHub Profiles | ✅ Yes | ✅ Yes | ✅ |
| Enrichment APIs | ✅ Yes | ✅ Yes | ✅ |
| LinkedIn (Manual) | ✅ Yes | ❌ No | ✅ For validation |
| LinkedIn (Scraping) | ❌ Violates ToS | ❌ No | ❌ |

## Next Steps

To improve this MVP:
- [ ] Add error handling and retry logic
- [ ] Implement API-based approach (LinkedIn API, reddit API, Apollo)
- [ ] Add email finding capabilities (Hunter.io)
- [ ] Create a database to store results
- [ ] Add data validation and deduplication
- [ ] Implement pagination for large datasets
- [ ] Add proxy rotation for scalability
- [ ] Create a web interface

## License

ISC

## Disclaimer

This tool is for educational and research purposes. Always respect website terms of service, robots.txt, and privacy laws. Obtain proper authorization before scraping data.
