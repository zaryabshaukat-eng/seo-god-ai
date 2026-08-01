import { Prisma, type PrismaClient, type Severity } from '@prisma/client';

export interface SeoIssueInput {
  pageId: string;
  rule: string;
  severity?: Severity;
  message?: string;
  details?: Prisma.InputJsonValue;
}

/**
 * Persistence for SEO issues produced by the SEO engine on a page.
 */
export class SeoIssueRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Bulk-inserts issues. Returns the number of rows written. */
  async createMany(inputs: SeoIssueInput[]): Promise<number> {
    if (inputs.length === 0) return 0;
    const result = await this.prisma.seoIssue.createMany({
      data: inputs.map((input) => ({
        pageId: input.pageId,
        rule: input.rule,
        severity: input.severity ?? 'MEDIUM',
        message: input.message,
        details: input.details ?? Prisma.JsonNull,
      })),
    });
    return result.count;
  }

  async countByPage(pageId: string): Promise<number> {
    return this.prisma.seoIssue.count({ where: { pageId } });
  }
}
