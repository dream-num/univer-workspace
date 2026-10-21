export function usernameKey(value: string): string {
  // SQLite NOCASE folds ASCII only; Unicode case variants can belong to different users.
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}
