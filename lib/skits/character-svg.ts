/**
 * A flat 2D cartoon character drawn from a handful of parameters. Every pose is
 * the same drawing with different eyes, brows and mouth, so a character stays
 * identical across shots and reels (which image generation can't promise).
 * Canvas: 800x1100, waist-up, transparent background.
 */
import type { CharacterLook, Expression, Mouth } from "./types";

export const CHARACTER_WIDTH = 800;
export const CHARACTER_HEIGHT = 1100;
/** Centre of the face on the canvas, used to aim the camera at it. */
export const FACE_CENTER = { x: 400, y: 440 };

export interface Pose {
  expression: Expression;
  mouth: Mouth;
  blink: boolean;
  /** -1 looks left, 1 looks right. */
  look: number;
}

const INK = "#2a2233";
const STROKE = 6;

interface ExpressionShape {
  /** Brow offsets in px (negative = raised): inner and outer end, per side. */
  browL: [number, number];
  browR: [number, number];
  /** 1 = normal eye opening, <1 heavy lids, >1 wide. */
  eyeOpen: number;
  /** Mouth curve: 1 smile, -1 frown. */
  smile: number;
  /** Eyes squeezed into happy arcs. */
  happyEyes?: boolean;
  blush?: boolean;
  sweat?: boolean;
  /** A resting mouth that's still open (laughing, gasping). */
  restMouth?: Mouth;
  /** Mouth pushed to one side (confused, smug). */
  mouthShift?: number;
  pupil?: number;
}

const SHAPES: Record<Expression, ExpressionShape> = {
  neutral: { browL: [0, 0], browR: [0, 0], eyeOpen: 1, smile: 0.2 },
  happy: { browL: [-8, -6], browR: [-8, -6], eyeOpen: 0.9, smile: 1, blush: true },
  laugh: { browL: [-12, -4], browR: [-12, -4], eyeOpen: 1, smile: 1.2, happyEyes: true, blush: true, restMouth: "D" },
  surprised: { browL: [-26, -20], browR: [-26, -20], eyeOpen: 1.3, smile: 0, restMouth: "E", pupil: 12 },
  confused: { browL: [-22, -14], browR: [10, 4], eyeOpen: 1, smile: -0.3, mouthShift: 18 },
  annoyed: { browL: [16, -6], browR: [16, -6], eyeOpen: 0.6, smile: -0.6 },
  sad: { browL: [-16, 8], browR: [-16, 8], eyeOpen: 0.85, smile: -0.8 },
  smug: { browL: [4, 2], browR: [-18, -12], eyeOpen: 0.55, smile: 0.7, mouthShift: 14 },
  nervous: { browL: [-12, 2], browR: [-12, 2], eyeOpen: 1.1, smile: -0.15, sweat: true, pupil: 13 },
  deadpan: { browL: [4, 4], browR: [4, 4], eyeOpen: 0.5, smile: 0 },
};

/** Darkens (amount < 0) or lightens a #rrggbb colour. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.replace("#", "").padEnd(6, "0").slice(0, 6), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function safeColor(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function hairBack(look: CharacterLook, hair: string): string {
  switch (look.hairStyle) {
    case "long":
      return `<path d="M215 420 Q205 250 400 215 Q595 250 585 420 L600 760 Q400 800 200 760 Z" fill="${hair}" stroke="${INK}" stroke-width="${STROKE}"/>`;
    case "ponytail":
      return `<path d="M560 330 Q700 360 680 560 Q670 660 610 700 Q640 560 560 430 Z" fill="${hair}" stroke="${INK}" stroke-width="${STROKE}"/>`;
    case "bun":
      return `<circle cx="400" cy="205" r="72" fill="${hair}" stroke="${INK}" stroke-width="${STROKE}"/>`;
    default:
      return "";
  }
}

function hairFront(look: CharacterLook, hair: string): string {
  const cap = `<path d="M226 440 Q215 230 400 212 Q585 230 574 440 Q560 330 480 300 Q430 335 360 305 Q280 320 226 440 Z" fill="${hair}" stroke="${INK}" stroke-width="${STROKE}" stroke-linejoin="round"/>`;
  switch (look.hairStyle) {
    case "bald":
      return `<path d="M228 470 Q222 400 245 360" fill="none" stroke="${hair}" stroke-width="22" stroke-linecap="round"/><path d="M572 470 Q578 400 555 360" fill="none" stroke="${hair}" stroke-width="22" stroke-linecap="round"/>`;
    case "spiky":
      return `<path d="M226 440 L230 300 L270 330 L285 220 L335 290 L370 190 L410 280 L450 185 L480 285 L530 215 L535 320 L575 300 L574 440 Q555 335 400 320 Q260 330 226 440 Z" fill="${hair}" stroke="${INK}" stroke-width="${STROKE}" stroke-linejoin="round"/>`;
    case "curly": {
      const curls = [
        [240, 380], [250, 310], [295, 255], [355, 225], [420, 218], [485, 235], [540, 275], [565, 340], [570, 400],
        [320, 300], [400, 280], [470, 295],
      ]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="48" fill="${hair}" stroke="${INK}" stroke-width="${STROKE}"/>`)
        .join("");
      // Second pass without outlines hides the inner strokes, leaving one bumpy silhouette.
      const fill = [
        [250, 370], [270, 300], [320, 260], [400, 250], [470, 262], [530, 300], [555, 370], [330, 305], [400, 290], [470, 305],
      ]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="44" fill="${hair}"/>`)
        .join("");
      return curls + fill;
    }
    case "long":
      return `${cap}<path d="M232 430 Q220 560 250 650" fill="none" stroke="${hair}" stroke-width="34" stroke-linecap="round"/><path d="M568 430 Q580 560 550 650" fill="none" stroke="${hair}" stroke-width="34" stroke-linecap="round"/>`;
    default:
      return cap;
  }
}

function accessory(look: CharacterLook, hair: string, top: string): { back: string; front: string } {
  switch (look.accessory) {
    case "glasses":
      return {
        back: "",
        front: `<g fill="rgba(255,255,255,0.18)" stroke="${INK}" stroke-width="7"><rect x="272" y="378" width="116" height="88" rx="30"/><rect x="412" y="378" width="116" height="88" rx="30"/></g><path d="M388 412 Q400 400 412 412" fill="none" stroke="${INK}" stroke-width="7"/>`,
      };
    case "beard":
      return {
        back: "",
        front: `<path d="M235 470 Q250 640 400 650 Q550 640 565 470 Q540 560 470 575 Q400 555 330 575 Q260 560 235 470 Z" fill="${hair}" stroke="${INK}" stroke-width="${STROKE}" stroke-linejoin="round"/>`,
      };
    case "earrings":
      return {
        back: `<circle cx="222" cy="500" r="11" fill="#f4c542" stroke="${INK}" stroke-width="4"/><circle cx="578" cy="500" r="11" fill="#f4c542" stroke="${INK}" stroke-width="4"/>`,
        front: "",
      };
    case "cap": {
      const c = shade(top, -0.25);
      return {
        back: "",
        front: `<path d="M222 360 Q230 205 400 200 Q570 205 578 360 Z" fill="${c}" stroke="${INK}" stroke-width="${STROKE}"/><path d="M222 360 Q400 330 640 372 Q620 395 570 385 Q400 360 222 360 Z" fill="${shade(c, -0.2)}" stroke="${INK}" stroke-width="${STROKE}" stroke-linejoin="round"/>`,
      };
    }
    default:
      return { back: "", front: "" };
  }
}

function eye(cx: number, cy: number, shape: ExpressionShape, pose: Pose, skin: string, id: string): string {
  if (pose.blink) {
    return `<path d="M${cx - 34} ${cy} Q${cx} ${cy + 14} ${cx + 34} ${cy}" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`;
  }
  if (shape.happyEyes) {
    return `<path d="M${cx - 32} ${cy + 8} Q${cx} ${cy - 26} ${cx + 32} ${cy + 8}" fill="none" stroke="${INK}" stroke-width="8" stroke-linecap="round"/>`;
  }
  const rx = 38;
  const ry = 45 * Math.min(shape.eyeOpen, 1.3);
  const pupilR = (shape.pupil ?? 17) * 1.12;
  const px = cx + pose.look * 11;
  const lidTop = cy - ry;
  // Heavy lids: a skin-coloured band over the top of the eye, with a flat lid line.
  const lidDepth = shape.eyeOpen < 1 ? 2 * ry * (1 - shape.eyeOpen) + ry * 0.2 : 0;
  const lid = lidDepth
    ? `<rect x="${cx - rx - 4}" y="${lidTop - 4}" width="${2 * rx + 8}" height="${lidDepth + 4}" fill="${skin}"/><line x1="${cx - rx}" y1="${lidTop + lidDepth}" x2="${cx + rx}" y2="${lidTop + lidDepth}" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>`
    : "";
  return (
    `<clipPath id="${id}"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/></clipPath>` +
    `<g clip-path="url(#${id})"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#fff"/>` +
    `<circle cx="${px}" cy="${cy + 4}" r="${pupilR}" fill="${INK}"/><circle cx="${px + 6}" cy="${cy - 3}" r="5" fill="#fff"/>${lid}</g>` +
    `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${INK}" stroke-width="${STROKE}"/>`
  );
}

function brow(cx: number, cy: number, inner: number, outer: number, side: -1 | 1, hair: string): string {
  // side -1 = character's right (viewer's left): inner end is on the right.
  const innerX = cx - side * 34;
  const outerX = cx + side * 38;
  return `<path d="M${outerX} ${cy + outer} Q${cx} ${cy - 8 + (inner + outer) / 2} ${innerX} ${cy + inner}" fill="none" stroke="${shade(hair, -0.35)}" stroke-width="13" stroke-linecap="round"/>`;
}

interface MouthGeometry {
  w: number;
  h: number;
  teeth: boolean;
  tongue: boolean;
}

const MOUTHS: Record<Exclude<Mouth, "X" | "A">, MouthGeometry> = {
  B: { w: 102, h: 20, teeth: true, tongue: false },
  C: { w: 113, h: 46, teeth: true, tongue: true },
  D: { w: 124, h: 68, teeth: true, tongue: true },
  E: { w: 84, h: 49, teeth: false, tongue: true },
  F: { w: 52, h: 35, teeth: false, tongue: false },
  G: { w: 96, h: 20, teeth: true, tongue: false },
  H: { w: 102, h: 58, teeth: true, tongue: true },
};

function mouth(shape: ExpressionShape, pose: Pose): string {
  const cx = 400 + (shape.mouthShift ?? 0);
  const cy = 548;
  const s = shape.smile;
  const m: Mouth = pose.mouth === "X" && shape.restMouth ? shape.restMouth : pose.mouth;

  if (m === "X" || m === "A") {
    const w = m === "A" ? 90 : 106;
    const y0 = cy - s * 12;
    return `<path d="M${cx - w / 2} ${y0} Q${cx} ${cy + s * 16} ${cx + w / 2} ${y0}" fill="none" stroke="${INK}" stroke-width="${m === "A" ? 9 : 7}" stroke-linecap="round"/>`;
  }

  const g = MOUTHS[m];
  const y0 = cy - s * 12;
  const topCtrl = y0 + s * 8 - g.h * 0.15;
  const bottomCtrl = y0 + g.h * 2 + s * 10;
  const path = `M${cx - g.w / 2} ${y0} Q${cx} ${topCtrl} ${cx + g.w / 2} ${y0} Q${cx} ${bottomCtrl} ${cx - g.w / 2} ${y0} Z`;
  const id = `mouth-${m}`;
  const teeth = g.teeth ? `<rect x="${cx - g.w}" y="${Math.min(topCtrl, y0) - 20}" width="${g.w * 2}" height="${20 + Math.max(10, g.h * 0.32)}" fill="#fff"/>` : "";
  const tongue = g.tongue ? `<ellipse cx="${cx}" cy="${y0 + g.h * 1.05 + s * 5}" rx="${g.w * 0.32}" ry="${g.h * 0.36}" fill="#e56b7a"/>` : "";
  return (
    `<clipPath id="${id}"><path d="${path}"/></clipPath>` +
    `<path d="${path}" fill="#5a1b2b"/><g clip-path="url(#${id})">${teeth}${tongue}</g>` +
    `<path d="${path}" fill="none" stroke="${INK}" stroke-width="${STROKE}" stroke-linejoin="round"/>`
  );
}

export function characterSvg(look: CharacterLook, pose: Pose, scale = 1): string {
  const skin = safeColor(look.skin, "#e8b48f");
  const hair = safeColor(look.hair, "#3b2a20");
  const top = safeColor(look.top, "#4a7bd0");
  const shape = SHAPES[pose.expression] ?? SHAPES.neutral;
  const acc = accessory(look, hair, top);

  const body =
    `<path d="M370 600 L370 700 L430 700 L430 600 Z" fill="${shade(skin, -0.12)}" stroke="${INK}" stroke-width="${STROKE}"/>` +
    `<path d="M70 1110 Q60 760 250 700 Q330 680 400 720 Q470 680 550 700 Q740 760 730 1110 Z" fill="${top}" stroke="${INK}" stroke-width="${STROKE}" stroke-linejoin="round"/>` +
    `<path d="M330 690 L400 780 L470 690" fill="none" stroke="${shade(top, -0.3)}" stroke-width="10" stroke-linejoin="round"/>` +
    `<path d="M200 820 Q210 950 205 1100" fill="none" stroke="${shade(top, -0.25)}" stroke-width="7"/><path d="M600 820 Q590 950 595 1100" fill="none" stroke="${shade(top, -0.25)}" stroke-width="7"/>`;

  const head =
    `<circle cx="226" cy="455" r="32" fill="${skin}" stroke="${INK}" stroke-width="${STROKE}"/>` +
    `<circle cx="574" cy="455" r="32" fill="${skin}" stroke="${INK}" stroke-width="${STROKE}"/>` +
    acc.back +
    `<ellipse cx="400" cy="430" rx="175" ry="200" fill="${skin}" stroke="${INK}" stroke-width="${STROKE}"/>`;

  const face =
    (shape.blush
      ? `<ellipse cx="290" cy="505" rx="34" ry="18" fill="#ff7a8a" opacity="0.45"/><ellipse cx="510" cy="505" rx="34" ry="18" fill="#ff7a8a" opacity="0.45"/>`
      : "") +
    eye(330, 420, shape, pose, skin, "eye-l") +
    eye(470, 420, shape, pose, skin, "eye-r") +
    brow(330, 355, shape.browL[0], shape.browL[1], -1, hair) +
    brow(470, 355, shape.browR[0], shape.browR[1], 1, hair) +
    `<path d="M395 455 Q378 495 400 500" fill="none" stroke="${shade(skin, -0.35)}" stroke-width="6" stroke-linecap="round"/>` +
    mouth(shape, pose);

  const w = Math.round(CHARACTER_WIDTH * scale);
  const h = Math.round(CHARACTER_HEIGHT * scale);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${CHARACTER_WIDTH} ${CHARACTER_HEIGHT}">` +
    hairBack(look, hair) +
    body +
    head +
    face +
    hairFront(look, hair) +
    acc.front +
    // Drawn last so hair never hides it.
    (shape.sweat
      ? `<path d="M592 370 Q572 410 592 425 Q612 410 592 370 Z" fill="#8fd3ff" stroke="${INK}" stroke-width="4"/>`
      : "") +
    `</svg>`
  );
}
