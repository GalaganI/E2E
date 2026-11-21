/** Narrows away null/undefined with a readable failure, keeping branching out of test bodies. */
export function defined<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${what} to be present`);
  return value;
}
