import type {
  MetaProvider,
  TargetResolution,
  TargetFetchResult,
  StealthSessionConfig,
  StealthFetchOptions,
} from "./types";
import {
  stealthResolveTarget,
  stealthFetchTargetData,
} from "./stealth-engine-bridge";

export class StealthMetaProvider implements MetaProvider {
  async resolveTarget(username: string): Promise<TargetResolution> {
    return stealthResolveTarget(username);
  }

  async fetchTargetData(params: {
    username: string;
    externalId: string | null;
    accessToken?: string;
    session?: StealthSessionConfig | null;
    options?: StealthFetchOptions;
  }): Promise<TargetFetchResult> {
    return stealthFetchTargetData(params);
  }
}
