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
    const parsed = parseNumberPhrase(tokens, i);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

// "One hundred" is TWO tokens. Returning on the first number word read it as 1,
// so a room counting to 100 asked for 100, heard 1, demanded a correction, and
// stalled at 99 forever. "hundred" is a multiplier over the phrase to its left,
// so the whole phrase has to be consumed before a value is returned.
function parseNumberPhrase(tokens: string[], start: number): number | undefined {
  const head = tokens[start];
  if (head === undefined) return undefined;

  let i = start + 1;
  let value: number;
  if (SMALL[head] !== undefined) {
    value = SMALL[head];
  } else if (TENS[head] !== undefined) {
    value = TENS[head];
    const ones = tokens[i];
    if (ones !== undefined && SMALL[ones] !== undefined && SMALL[ones] > 0 && SMALL[ones] < 10) {
      value += SMALL[ones];
      i += 1;
    }
  } else if (head === "hundred") {
    return 100;
  } else {
    return undefined;
  }

  if (tokens[i] !== "hundred") return value;
  value *= 100;
  i += 1;
  if (tokens[i] === "and") i += 1;
  const remainder = parseNumberPhrase(tokens, i);
  return remainder !== undefined && remainder < 100 ? value + remainder : value;
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
