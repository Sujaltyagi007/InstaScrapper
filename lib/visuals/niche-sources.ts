/**
 * Which footage libraries suit a niche. Pexels and Pixabay (modern, polished,
 * mostly generic) are searched for every niche. Specialist archives are added
 * only where they're the better match: NASA for space and science, Wikimedia
 * Commons for nature and science, Internet Archive and Europeana for history.
 * Specialists also get a small ranking bonus, so a real rocket launch beats a
 * generic clip for a space reel. Matching is on the niche's name and
 * description, so it needs no AI request.
 */
import type { ClipSource } from "./types";

interface Rule {
  label: string;
  words: RegExp;
  sources: ClipSource[];
}

const RULES: Rule[] = [
  {
    label: "space",
    words: /\b(space|astronom\w*|astro\w*|planets?|planetary|galax\w*|cosmos|cosmic|cosmology|rockets?|nasa|universe|orbit\w*|mars|moon|lunar|solar|telescopes?|satellites?|spacecraft|astronaut\w*)\b/i,
    sources: ["nasa", "wikimedia"],
  },
  {
    label: "science",
    words: /\b(science|scientific|physics|biolog\w*|chemi\w*|geolog\w*|climate|volcano\w*|dinosaur\w*|fossils?|evolution|ecolog\w*|lab|experiments?|engineering)\b/i,
    sources: ["wikimedia", "nasa"],
  },
  {
    label: "nature",
    words: /\b(nature|wildlife|animals?|birds?|forests?|ocean|sea|marine|mountains?|landscapes?|plants?|flowers?|insects?|rivers?|desert|jungle|earth)\b/i,
    sources: ["wikimedia"],
  },
  {
    label: "history",
    words: /\b(history|histor\w*|ancient|vintage|retro|nostalgi\w*|wars?|wwii|ww2|medieval|empires?|archiv\w*|heritage|museum|civili[sz]ation\w*|19[0-9]0s|18\d\ds)\b/i,
    sources: ["archive", "europeana", "wikimedia"],
  },
];

export interface NicheLike {
  name: string;
  description?: string | null;
}

export interface NicheSources {
  /** Every library to search, in priority order. */
  sources: ClipSource[];
  /** The niche-specific ones (they get a ranking bonus). */
  specialists: ClipSource[];
  /** Which topics matched, for logging. */
  matched: string[];
}

export function sourcesForNiche(niche: NicheLike): NicheSources {
  const text = `${niche.name} ${niche.description ?? ""}`;
  const matched = RULES.filter((r) => r.words.test(text));
  const specialists = [...new Set(matched.flatMap((r) => r.sources))];
  return {
    sources: ["pexels", "pixabay", ...specialists],
    specialists,
    matched: matched.map((r) => r.label),
  };
}
