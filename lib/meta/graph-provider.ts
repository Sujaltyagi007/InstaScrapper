import type { MetaProvider, TargetResolution, TargetFetchResult } from "./types";

/**
 * Real Instagram Graph API (Business Discovery) implementation.
 *
 * This is intentionally a scaffold, not a finished integration: doing this
 * correctly requires your own Meta Developer App, App Review approval for
 * the relevant permissions, and a decision about exactly which fields your
 * approved use case is allowed to request. Fill in the Graph API calls once
 * you have META_APP_ID / META_APP_SECRET and a verified Business Discovery
 * path (see plan section 4 - Capability Matrix, and Phase 0 of the roadmap).
 *
 * Until then, set MOCK_META_API=true (default) to use `mock-provider.ts`,
 * which implements the exact same `MetaProvider` interface so no other part
 * of the app needs to change when you switch this on.
 */
export class GraphMetaProvider implements MetaProvider {
  private readonly apiVersion: string;

  constructor() {
    this.apiVersion = process.env.META_GRAPH_API_VERSION || "v21.0";
    if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) {
      throw new Error(
        "META_APP_ID and META_APP_SECRET are required when MOCK_META_API=false."
      );
    }
  }

  async resolveTarget(_username: string): Promise<TargetResolution> {
    throw new Error(
      "GraphMetaProvider.resolveTarget is not implemented yet. Verify your Business " +
        "Discovery access (plan Phase 0) and implement the Graph API call here."
    );
  }

  async fetchTargetData(_params: {
    username: string;
    externalId: string | null;
    accessToken: string;
  }): Promise<TargetFetchResult> {
    throw new Error(
      "GraphMetaProvider.fetchTargetData is not implemented yet. Implement the Business " +
        "Discovery field fetch here once your Meta App has verified access."
    );
  }
}
