import { randomInt } from "crypto";

/** Génère `n` codes PIN à 4 chiffres, garantis différents entre eux dans ce lot. */
export function genererCodesPinUniques(n: number): string[] {
  const codes = new Set<string>();
  while (codes.size < n) {
    codes.add(randomInt(0, 10000).toString().padStart(4, "0"));
  }
  return [...codes];
}
