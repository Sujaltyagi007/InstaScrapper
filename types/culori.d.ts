declare module "culori" {
  export interface Oklch {
    mode: "oklch";
    l: number;
    c: number;
    h?: number;
    alpha?: number;
  }

  export function converter(mode: "oklch"): (color: string) => Oklch | undefined;
  export function wcagContrast(a: string, b: string): number;
}
