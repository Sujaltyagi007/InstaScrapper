/**
 * Local test for animated skits. Usage:
 *   npx tsx --env-file=.env scripts/skit-spike.ts <outDir> "<premise>"
 *   npx tsx --env-file=.env scripts/skit-spike.ts <outDir> --skit skit.json --voice dialogue.wav
 * The second form re-renders an existing scene without spending Gemini quota.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { produceSkit } from "@/lib/skits/produce";
import { normalizeSkit } from "@/lib/skits/writer";

async function main() {
  const [outDir, ...rest] = process.argv.slice(2);
  if (!outDir) throw new Error("Usage: skit-spike.ts <outDir> \"<premise>\" | --skit file --voice file");
  await mkdir(outDir, { recursive: true });
  const flag = (name: string) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const skitFile = flag("--skit");
  const voiceFile = flag("--voice");
  const started = Date.now();
  const result = await produceSkit({
    workDir: path.resolve(outDir),
    premise: skitFile ? undefined : rest.join(" "),
    skit: skitFile ? normalizeSkit(JSON.parse(await readFile(skitFile, "utf8"))) : undefined,
    voiceWav: voiceFile ? await readFile(voiceFile) : undefined,
  });
  await writeFile(path.join(outDir, "skit.json"), JSON.stringify(result.skit, null, 2));
  console.log(JSON.stringify({ ...result, skit: result.skit.title, totalMs: Date.now() - started }, null, 2));
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
