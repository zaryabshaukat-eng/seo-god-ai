export interface RobotsRule {
  path: string;
  allow: boolean;
}

export interface RobotsGroup {
  userAgents: string[];
  rules: RobotsRule[];
  crawlDelay: number | null;
}

/**
 * Parsed robots.txt. Rule matching follows the common convention: the
 * longest matching path wins, ties favour `Allow`, and unmatched paths are
 * allowed. `*` and a trailing `$` wildcard are supported in rule paths.
 */
export class RobotsTxt {
  private readonly groups: RobotsGroup[];
  private readonly sitemaps: string[];

  private constructor(groups: RobotsGroup[], sitemaps: string[]) {
    this.groups = groups;
    this.sitemaps = sitemaps;
  }

  /** Parses robots.txt content into an immutable rule set. */
  static parse(content: string): RobotsTxt {
    const groups: RobotsGroup[] = [];
    const sitemaps: string[] = [];
    let current: RobotsGroup | null = null;

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line === '' || line.startsWith('#')) continue;

      const colon = line.indexOf(':');
      if (colon === -1) continue;
      const field = line.slice(0, colon).trim();
      const value = line.slice(colon + 1).split('#', 1)[0]!.trim();

      const fieldLower = field.toLowerCase();
      if (fieldLower === 'user-agent') {
        if (current !== null) groups.push(current);
        current = { userAgents: [value.toLowerCase()], rules: [], crawlDelay: null };
        continue;
      }
      if (fieldLower === 'sitemap') {
        sitemaps.push(value);
        continue;
      }
      if (current === null) continue;

      if (fieldLower === 'allow') {
        if (value !== '') current.rules.push({ path: value, allow: true });
      } else if (fieldLower === 'disallow') {
        if (value !== '') current.rules.push({ path: value, allow: false });
      } else if (fieldLower === 'crawl-delay') {
        const delay = Number(value);
        if (Number.isFinite(delay) && delay >= 0) current.crawlDelay = delay;
      }
    }
    if (current !== null) groups.push(current);

    return new RobotsTxt(groups, sitemaps);
  }

  /** An empty rule set: every URL is allowed. */
  static allowAll(): RobotsTxt {
    return new RobotsTxt([], []);
  }

  /** Whether this instance carries any parseable rules. */
  get hasRules(): boolean {
    return this.groups.length > 0;
  }

  /** Sitemap URLs advertised by the file. */
  getSitemaps(): string[] {
    return [...this.sitemaps];
  }

  /** Recommended crawl delay in seconds for the given user agent, or null. */
  crawlDelayFor(userAgent: string): number | null {
    const delaysOf = (groups: RobotsGroup[]): number[] =>
      groups
        .map((group) => group.crawlDelay)
        .filter((delay): delay is number => delay !== null);
    const ua = userAgent.toLowerCase();

    const exactDelays = delaysOf(this.groups.filter((g) => g.userAgents.includes(ua)));
    if (exactDelays.length > 0) return Math.max(...exactDelays);

    const wildcardDelays = delaysOf(this.groups.filter((g) => g.userAgents.includes('*')));
    return wildcardDelays.length === 0 ? null : Math.max(...wildcardDelays);
  }

  /** Whether `urlString` may be fetched under the given user agent. */
  isAllowed(urlString: string, userAgent: string): boolean {
    let path: string;
    try {
      const url = new URL(urlString);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      path = url.pathname + url.search;
    } catch {
      return false;
    }

    const matched = this.matchGroups(userAgent);
    if (matched.length === 0) return true;

    let best: RobotsRule | null = null;
    for (const group of matched) {
      for (const rule of group.rules) {
        if (matchRule(path, rule.path)) {
          if (best === null || rule.path.length > best.path.length) {
            best = rule;
          }
        }
      }
    }
    return best === null ? true : best.allow;
  }

  private matchGroups(userAgent: string): RobotsGroup[] {
    const ua = userAgent.toLowerCase();
    const exact = this.groups.filter((group) => group.userAgents.includes(ua));
    if (exact.length > 0) return exact;
    return this.groups.filter((group) => group.userAgents.includes('*'));
  }
}

function matchRule(path: string, rule: string): boolean {
  const pattern = ruleToRegExp(rule);
  return pattern.test(path);
}

function ruleToRegExp(rule: string): RegExp {
  let pattern = '';
  for (let i = 0; i < rule.length; i++) {
    const ch = rule.charAt(i);
    if (ch === '*') {
      pattern += '.*';
    } else if (ch === '$' && i === rule.length - 1) {
      pattern += '$';
    } else {
      pattern += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${pattern}`);
}

export interface RobotsStoreOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxAgeMs?: number;
  now?: () => number;
}

/**
 * Fetches and caches robots.txt per origin. A fetch failure (network error,
 * timeout, or a non-200 response) results in an allow-all rule set so the
 * crawler never grinds to a halt because of a broken robots file.
 */
export class RobotsStore {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxAgeMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, { robots: RobotsTxt; fetchedAt: number }>();

  constructor(options: RobotsStoreOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.maxAgeMs = options.maxAgeMs ?? 60 * 60 * 1000;
    this.now = options.now ?? (() => Date.now());
  }

  /** Returns the rule set for the origin of `urlString`, fetching if needed. */
  async forUrl(urlString: string, userAgent: string): Promise<RobotsTxt> {
    let origin: string;
    try {
      const url = new URL(urlString);
      origin = `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}`;
    } catch {
      return RobotsTxt.allowAll();
    }

    const cached = this.cache.get(origin);
    if (cached !== undefined && this.now() - cached.fetchedAt < this.maxAgeMs) {
      return cached.robots;
    }

    const robots = await this.fetchRobots(origin, userAgent);
    this.cache.set(origin, { robots, fetchedAt: this.now() });
    return robots;
  }

  /** Drops all cached rule sets (used by tests and long-lived processes). */
  clear(): void {
    this.cache.clear();
  }

  private async fetchRobots(origin: string, userAgent: string): Promise<RobotsTxt> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let robots: RobotsTxt;
    try {
      const response = await this.fetchImpl(`${origin}/robots.txt`, {
        headers: { 'user-agent': userAgent },
        signal: controller.signal,
        redirect: 'follow',
      });
      robots = response.ok ? RobotsTxt.parse(await response.text()) : RobotsTxt.allowAll();
    } catch {
      robots = RobotsTxt.allowAll();
    }
    clearTimeout(timer);
    return robots;
  }
}
