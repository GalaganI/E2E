/** Parses the shop's price format ("Rs. 1,500") into an integer amount. */
export function parseRupees(text: string): number {
  const match = /Rs\.\s*([\d,]+)/.exec(text);
  if (!match?.[1]) throw new Error(`Cannot parse price from "${text}"`);
  return Number.parseInt(match[1].replaceAll(',', ''), 10);
}
