import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config();

export interface Person {
  name: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  email?: string;
  emailStatus?: 'verified' | 'guessed' | 'generic' | 'unavailable';
  phone?: string;
  location?: string;
  city?: string;
  state?: string;
  country?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  twitterUrl?: string;
  company?: string;
  previousCompanies?: string[];
  education?: string[];
  skills?: string[];
  seniority?: string;
  department?: string;
  source: string;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Hunter.io API Client
 * Free tier: 25 searches/month
 * Best for: Finding emails at a domain (x.ai)
 */
export class HunterClient {
  private apiKey: string;
  private baseUrl = 'https://api.hunter.io/v2';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.HUNTER_API_KEY || '';
  }

  hasKey(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Domain Search - Find all emails at a domain
   * Free tier: Limited to 10 emails per domain
   */
  async domainSearch(domain: string = 'x.ai', limit: number = 10): Promise<Person[]> {
    if (!this.hasKey()) {
      console.log('⚠️  Hunter.io API key not found, skipping...');
      return [];
    }

    try {
      console.log(`🔍 Hunter: Searching emails at ${domain}...`);

      const response = await axios.get(`${this.baseUrl}/domain-search`, {
        params: {
          domain,
          api_key: this.apiKey,
          limit
        }
      });

      const emails = response.data.data.emails || [];
      console.log(`✅ Hunter found ${emails.length} emails at ${domain}`);

      return emails.map((email: any) => ({
        name: `${email.first_name || ''} ${email.last_name || ''}`.trim(),
        firstName: email.first_name,
        lastName: email.last_name,
        email: email.value,
        emailStatus: email.type === 'personal' ? 'verified' : 'generic',
        title: email.position,
        department: email.department,
        seniority: email.seniority,
        linkedinUrl: email.linkedin,
        twitterUrl: email.twitter,
        company: 'xAI',
        source: 'Hunter.io',
        confidence: email.confidence > 90 ? 'high' : email.confidence > 70 ? 'medium' : 'low'
      }));
    } catch (error: any) {
      console.error('❌ Hunter error:', error.response?.data?.errors?.[0]?.details || error.message);
      return [];
    }
  }

  /**
   * Email Finder - Find specific person's email
   */
  async findEmail(firstName: string, lastName: string, domain: string = 'x.ai'): Promise<string | null> {
    if (!this.hasKey()) return null;

    try {
      const response = await axios.get(`${this.baseUrl}/email-finder`, {
        params: {
          domain,
          first_name: firstName,
          last_name: lastName,
          api_key: this.apiKey
        }
      });

      return response.data.data.email || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check remaining credits
   */
  async getCredits(): Promise<{ requests: number; limit: number }> {
    if (!this.hasKey()) return { requests: 0, limit: 0 };

    try {
      const response = await axios.get(`${this.baseUrl}/account`, {
        params: { api_key: this.apiKey }
      });

      return {
        requests: response.data.data.requests.searches.used || 0,
        limit: response.data.data.requests.searches.available || 0
      };
    } catch (error) {
      return { requests: 0, limit: 0 };
    }
  }
}

/**
 * PeopleDataLabs API Client
 * Free tier: 100 credits
 * Best for: Finding people at specific companies with rich data
 */
export class PeopleDataLabsClient {
  private apiKey: string;
  private baseUrl = 'https://api.peopledatalabs.com/v5';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.PDL_API_KEY || '';
  }

  hasKey(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Person Search - Find people at a company
   */
  async searchPeople(params: {
    company?: string;
    location?: string[];
    jobTitles?: string[];
    seniority?: string[];
    size?: number;
  }): Promise<Person[]> {
    if (!this.hasKey()) {
      console.log('⚠️  PeopleDataLabs API key not found, skipping...');
      return [];
    }

    try {
      console.log('🔍 PeopleDataLabs: Searching for people...');

      // Build search query
      const query: any = {};

      if (params.company) {
        query.job_company_name = params.company;
      }

      if (params.location && params.location.length > 0) {
        query.location_name = params.location;
      }

      if (params.jobTitles && params.jobTitles.length > 0) {
        query.job_title_role = params.jobTitles;
      }

      if (params.seniority && params.seniority.length > 0) {
        query.job_title_levels = params.seniority;
      }

      const response = await axios.get(`${this.baseUrl}/person/search`, {
        params: {
          api_key: this.apiKey,
          sql: this.buildSQL(query),
          size: params.size || 50,
          pretty: true
        }
      });

      const people = response.data.data || [];
      console.log(`✅ PeopleDataLabs found ${people.length} people`);

      return people.map((p: any) => ({
        name: p.full_name,
        firstName: p.first_name,
        lastName: p.last_name,
        email: p.work_email || p.emails?.[0]?.address,
        emailStatus: p.work_email ? 'verified' : 'guessed',
        phone: p.phone_numbers?.[0],
        location: p.location_name,
        city: p.location_locality,
        state: p.location_region,
        country: p.location_country,
        linkedinUrl: p.linkedin_url,
        githubUrl: p.github_url,
        twitterUrl: p.twitter_url,
        title: p.job_title,
        company: p.job_company_name,
        seniority: p.job_title_levels?.[0],
        department: p.job_title_role,
        previousCompanies: p.experience?.slice(0, 3).map((e: any) => e.company?.name).filter(Boolean),
        education: p.education?.map((e: any) => e.school?.name).filter(Boolean),
        skills: p.skills,
        source: 'PeopleDataLabs',
        confidence: 'high'
      }));
    } catch (error: any) {
      console.error('❌ PeopleDataLabs error:', error.response?.data?.error?.message || error.message);
      return [];
    }
  }

  /**
   * Build SQL query for PDL
   */
  private buildSQL(query: any): string {
    const conditions: string[] = [];

    if (query.job_company_name) {
      conditions.push(`job_company_name='${query.job_company_name}'`);
    }

    if (query.location_name) {
      const locations = Array.isArray(query.location_name) ? query.location_name : [query.location_name];
      const locConditions = locations.map((l: string) => `location_name:'${l}'`).join(' OR ');
      conditions.push(`(${locConditions})`);
    }

    if (query.job_title_role) {
      const roles = Array.isArray(query.job_title_role) ? query.job_title_role : [query.job_title_role];
      const roleConditions = roles.map((r: string) => `job_title_role:'${r}'`).join(' OR ');
      conditions.push(`(${roleConditions})`);
    }

    if (query.job_title_levels) {
      const levels = Array.isArray(query.job_title_levels) ? query.job_title_levels : [query.job_title_levels];
      const levelConditions = levels.map((l: string) => `job_title_levels:'${l}'`).join(' OR ');
      conditions.push(`(${levelConditions})`);
    }

    return `SELECT * FROM person WHERE ${conditions.join(' AND ')}`;
  }

  /**
   * Enrich person by email or name
   */
  async enrichPerson(params: { email?: string; name?: string; company?: string }): Promise<Person | null> {
    if (!this.hasKey()) return null;

    try {
      const response = await axios.get(`${this.baseUrl}/person/enrich`, {
        params: {
          api_key: this.apiKey,
          ...params,
          pretty: true
        }
      });

      const p = response.data.data;
      if (!p) return null;

      return {
        name: p.full_name,
        firstName: p.first_name,
        lastName: p.last_name,
        email: p.work_email || p.emails?.[0]?.address,
        emailStatus: p.work_email ? 'verified' : 'guessed',
        phone: p.phone_numbers?.[0],
        location: p.location_name,
        city: p.location_locality,
        state: p.location_region,
        linkedinUrl: p.linkedin_url,
        githubUrl: p.github_url,
        title: p.job_title,
        company: p.job_company_name,
        previousCompanies: p.experience?.slice(0, 3).map((e: any) => e.company?.name).filter(Boolean),
        education: p.education?.map((e: any) => e.school?.name).filter(Boolean),
        source: 'PeopleDataLabs',
        confidence: 'high'
      };
    } catch (error) {
      return null;
    }
  }
}

/**
 * Multi-API Coordinator
 * Combines Hunter, PeopleDataLabs, and GitHub
 */
export class MultiAPIClient {
  public hunter: HunterClient;
  public pdl: PeopleDataLabsClient;

  constructor() {
    this.hunter = new HunterClient();
    this.pdl = new PeopleDataLabsClient();
  }

  async checkAllCredits(): Promise<void> {
    console.log('💳 Checking API Credits:\n');

    if (this.hunter.hasKey()) {
      const hunterCredits = await this.hunter.getCredits();
      console.log(`   Hunter.io: ${hunterCredits.limit - hunterCredits.requests}/${hunterCredits.limit} searches remaining`);
    } else {
      console.log('   Hunter.io: No API key (get free 25 searches at hunter.io)');
    }

    if (this.pdl.hasKey()) {
      console.log('   PeopleDataLabs: API key found (100 free credits)');
    } else {
      console.log('   PeopleDataLabs: No API key (get free 100 credits at peopledatalabs.com)');
    }

    console.log();
  }

  /**
   * Find xAI researchers using all available APIs
   */
  async findXAIResearchers(): Promise<Person[]> {
    const allPeople: Person[] = [];

    // 1. Hunter - Find emails at x.ai domain
    if (this.hunter.hasKey()) {
      const hunterResults = await this.hunter.domainSearch('x.ai', 100);
      allPeople.push(...hunterResults);
    }

    // 2. PeopleDataLabs - Search for xAI employees
    if (this.pdl.hasKey()) {
      const pdlResults = await this.pdl.searchPeople({
        company: 'xAI',
        location: ['Palo Alto, CA', 'San Francisco Bay Area'],
        jobTitles: ['software', 'engineer', 'research', 'scientist', 'machine learning'],
        seniority: ['entry', 'mid', 'senior'], // Exclude executives
        size: 100
      });
      allPeople.push(...pdlResults);
    }

    return allPeople;
  }
}
