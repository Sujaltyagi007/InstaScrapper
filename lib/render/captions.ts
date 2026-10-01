import type { CaptionCue } from "./timing";
import { CAPTION_FONT_NAME } from "./ffmpeg";

export interface CaptionStyle {
  width: number;
  height: number;
  fontName: string;
  fontSize: number;
  /** Distance of the caption baseline from the bottom edge, in pixels. */
  marginBottom: number;
  outline: number;
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  width: 1080,
  height: 1920,
  fontName: CAPTION_FONT_NAME,
  fontSize: 104,
  // Keeps captions clear of Instagram's own caption/username overlay (bottom 35% = 672 px).
  marginBottom: 700,
  outline: 7,
};

function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

function assText(text: string): string {
  // Braces start override blocks and backslashes start escapes in ASS.
  return text.replace(/[{}\\]/g, "").replace(/\r?\n/g, "\\N").toUpperCase();
}

export function buildAssSubtitles(cues: CaptionCue[], style: CaptionStyle = DEFAULT_CAPTION_STYLE): string {
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${style.width}`,
    `PlayResY: ${style.height}`,
    "ScaledBorderAndShadow: yes",
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${style.fontName},${style.fontSize},&H00FFFFFF,&H0000FFFF,&H00000000,&H64000000,0,0,0,0,100,100,1,0,1,${style.outline},3,2,90,90,${style.marginBottom},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events = cues
    .filter((c) => c.end > c.start && c.text.trim())
    .map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${assText(c.text)}`);
  return [...header, ...events, ""].join("\n");
}
