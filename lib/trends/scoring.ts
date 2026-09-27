
export interface ScoringSnapshot {
  capturedAt: Date;
  playCount: number | null;
  likeCount: number | null;
}

export interface ScoringMedia {
  id: string;
  accountKey: string;
  timestamp: Date | null;
  playCount: number | null;
  likeCount: number | null;
  /** Oldest first. */
  snapshots: ScoringSnapshot[];
}

export type MetricKind = "plays" | "likes";

export interface TrendScore {
  id: string;
  kind: MetricKind;
  value: number;
  baseline: number;
  ratio: number;
  ageHours: number;
  momentum: number;
  score: number;
}

export interface ScoringOptions {
  now?: Date;
  windowDays?: number;
  halfLifeHours?: number;
  minRatio?: number;
  baselineSize?: number;
  minBaselineSamples?: number;
}

const DEFAULTS = {
  windowDays: 14,
  halfLifeHours: 5 * 24,
  minRatio: 1.5,
  baselineSize: 20,
  minBaselineSamples: 3,
};

/** Reels are judged on plays; photos (no play count) on likes. */
function metricOf(m: { playCount: number | null; likeCount: number | null }): { kind: MetricKind; value: number } | null {
  if (m.playCount !== null && m.playCount > 0) return { kind: "plays", value: m.playCount };
  if (m.likeCount !== null && m.likeCount > 0) return { kind: "likes", value: m.likeCount };
  return null;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function momentumOf(m: ScoringMedia, kind: MetricKind, value: number, ageHours: number): number {
  const pick = (s: ScoringSnapshot) => (kind === "plays" ? s.playCount : s.likeCount);
  const points = m.snapshots.filter((s) => pick(s) !== null);
  if (points.length < 2 || ageHours <= 0) return 1;
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  const hours = (b.capturedAt.getTime() - a.capturedAt.getTime()) / 3_600_000;
  if (hours < 1) return 1;
  const recentRate = (pick(b)! - pick(a)!) / hours;
  const lifetimeRate = value / ageHours;
  if (lifetimeRate <= 0) return 1;
  return Math.min(2, Math.max(0.5, recentRate / lifetimeRate));
}

export function scoreTrends(media: ScoringMedia[], options: ScoringOptions = {}): TrendScore[] {
  const opts = { ...DEFAULTS, ...options };
  const now = (options.now ?? new Date()).getTime();

  // Baselines: median of each account's most recent posts, per metric kind,
  // with a niche-wide median as fallback for accounts with too little history.
  const byAccountKind = new Map<string, { t: number; v: number }[]>();
  const byKind = new Map<MetricKind, number[]>();
  for (const m of media) {
    const metric = metricOf(m);
    if (!metric) continue;
    const key = `${m.accountKey}|${metric.kind}`;
    const list = byAccountKind.get(key) ?? [];
    list.push({ t: m.timestamp?.getTime() ?? 0, v: metric.value });
    byAccountKind.set(key, list);
    byKind.set(metric.kind, [...(byKind.get(metric.kind) ?? []), metric.value]);
  }
  const baselineFor = (accountKey: string, kind: MetricKind): number | null => {
    const recent = (byAccountKind.get(`${accountKey}|${kind}`) ?? [])
      .sort((a, b) => b.t - a.t)
      .slice(0, opts.baselineSize)
      .map((x) => x.v);
    if (recent.length >= opts.minBaselineSamples) return median(recent);
    const nicheWide = byKind.get(kind) ?? [];
    return nicheWide.length >= opts.minBaselineSamples ? median(nicheWide) : null;
  };

  const scores: TrendScore[] = [];
  for (const m of media) {
    const metric = metricOf(m);
    if (!metric || !m.timestamp) continue;
    const ageHours = Math.max(1, (now - m.timestamp.getTime()) / 3_600_000);
    if (ageHours > opts.windowDays * 24) continue;

    const baseline = baselineFor(m.accountKey, metric.kind);
    if (!baseline || baseline <= 0) continue;
    const ratio = metric.value / baseline;
    if (ratio < opts.minRatio) continue;

    const recency = Math.pow(0.5, ageHours / opts.halfLifeHours);
    const momentum = momentumOf(m, metric.kind, metric.value, ageHours);
    scores.push({
      id: m.id,
      kind: metric.kind,
      value: metric.value,
      baseline,
      ratio,
      ageHours,
      momentum,
      score: ratio * recency * momentum,
    });
  }
  return scores.sort((a, b) => b.score - a.score);
}
