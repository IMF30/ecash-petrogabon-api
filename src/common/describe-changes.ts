/**
 * Décrit les champs modifiés entre l'état précédent d'un enregistrement et un
 * patch partiel, pour un détail d'audit précis (§17 : traçabilité de chaque
 * modification). Ne jamais passer un objet contenant un mot de passe/hash.
 */
export function describeChanges(before: object, patch: object): string {
  const beforeRecord = before as Record<string, unknown>;
  const patchRecord = patch as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(patchRecord)) {
    const newValue = patchRecord[key];
    if (newValue === undefined) continue;
    const oldValue = beforeRecord[key];
    const oldStr = oldValue instanceof Date ? oldValue.toISOString() : String(oldValue);
    const newStr = newValue instanceof Date ? newValue.toISOString() : String(newValue);
    if (oldStr !== newStr) parts.push(`${key}: ${oldStr} → ${newStr}`);
  }
  return parts.length > 0 ? parts.join(", ") : "aucune valeur modifiée";
}
