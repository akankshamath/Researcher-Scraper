export interface PublicResearcher {
  name: string;
  title?: string;
  company?: string;
  location?: string;
  locationConfidence: 'low' | 'medium' | 'high';

  githubUrl?: string;
  openAlexUrl?: string;
  homepageUrl?: string;
  xaiPageUrl?: string;
  otherSources: string[];

  isResearchLike: boolean;
  researchScore: number; // 0–1
  notes?: string;
}


