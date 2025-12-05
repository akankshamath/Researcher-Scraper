import { PublicResearcher } from './types';
const GITHUB_ORG = 'xai-org';

export async function fetchOrgContributors(githubToken?: string): Promise<PublicResearcher[]> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

  // 1) Get a small list of repos in xai-org (you can restrict by topic later)
  const reposRes = await fetch(
    `https://api.github.com/orgs/${GITHUB_ORG}/repos?per_page=10`,
    { headers }
  );
  if (!reposRes.ok) throw new Error(`GitHub repos error: ${reposRes.statusText}`);
  const repos: Array<{ name: string }> = await reposRes.json();

  const seenUsers = new Set<string>();
  const people: PublicResearcher[] = [];

  for (const repo of repos) {
    const contribRes = await fetch(
      `https://api.github.com/repos/${GITHUB_ORG}/${repo.name}/contributors?per_page=50`,
      { headers }
    );
    if (!contribRes.ok) continue;
    const contributors: Array<{ login: string }> = await contribRes.json();

    for (const c of contributors) {
      if (seenUsers.has(c.login)) continue;
      seenUsers.add(c.login);

      const userRes = await fetch(`https://api.github.com/users/${c.login}`, { headers });
      if (!userRes.ok) continue;
      const user: any = await userRes.json();

      const bio = (user.bio || '').toLowerCase();
      const name = (user.name || c.login).trim();
      const location = (user.location || '').trim();

      const isResearchLike = /research|scientist|ml|ai|deep learning|nlp|vision|robotics/.test(bio);
      const researchScore = isResearchLike ? 0.6 : 0.3; // conservative

      const person: PublicResearcher = {
        name,
        title: undefined,
        company: 'xAI', // inferred
        location: location || undefined,
        locationConfidence: location
          ? (location.toLowerCase().includes('palo alto') ? 'high' : 'medium')
          : 'low',
        githubUrl: user.html_url,
        openAlexUrl: undefined,
        homepageUrl: user.blog || undefined,
        xaiPageUrl: undefined,
        otherSources: [user.html_url],
        isResearchLike,
        researchScore,
        notes: `GitHub contributor to xai-org/${repo.name}`
      };

      people.push(person);
      await new Promise(r => setTimeout(r, 300)); // be nice to GitHub
    }
  }

  return people;
}
