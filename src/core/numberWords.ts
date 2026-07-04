const SMALL: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

export function extractNumber(text: string): number | undefined {
  const normalized = text.toLowerCase().replace(/[,.!?]/g, " ").replace(/-/g, " ").trim();
  const digit = normalized.match(/\b(\d{1,3})\b/);
  if (digit?.[1]) return Number(digit[1]);

  const tokens = normalized.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token) continue;
    if (SMALL[token] !== undefined) return SMALL[token];
    if (TENS[token] !== undefined) {
      const next = tokens[i + 1];
      if (next && SMALL[next] !== undefined && SMALL[next] > 0 && SMALL[next] < 10) {
        return TENS[token] + SMALL[next];
      }
      return TENS[token];
    }
    if (token === "hundred") return 100;
  }
  return undefined;
}

export function numberToWords(n: number): string {
  const smallEntries = Object.entries(SMALL).find(([, value]) => value === n);
  if (smallEntries) return capitalize(smallEntries[0]);
  const tensEntries = Object.entries(TENS).sort((a, b) => b[1] - a[1]);
  for (const [word, value] of tensEntries) {
    if (n === value) return capitalize(word);
    if (n > value && n < value + 10) {
      const ones = Object.entries(SMALL).find(([, v]) => v === n - value)?.[0];
      if (ones) return `${capitalize(word)}-${ones}`;
    }
  }
  if (n === 100) return "One hundred";
  return String(n);
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
