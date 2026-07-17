/** Singularity ranking + inline calculator. Pure logic, unit tested. */

export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  if (t.startsWith(q)) return 100 - t.length * 0.1;
  const words = t.split(/[\s\-_./]+/);
  for (let i = 0; i < words.length; i++) {
    if (words[i].startsWith(q)) return 80 - i * 2;
  }
  const idx = t.indexOf(q);
  if (idx >= 0) return 60 - idx;
  // Subsequence match, penalised per gap.
  let from = 0;
  let last = -1;
  let gaps = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, from);
    if (found < 0) return null;
    if (last >= 0 && found > last + 1) gaps++;
    from = found + 1;
    last = found;
  }
  return 30 - gaps * 2;
}

export function rank<T>(query: string, items: T[], text: (item: T) => string, boost?: (item: T) => number): T[] {
  return items
    .map((item) => {
      const s = fuzzyScore(query, text(item));
      return s === null ? null : { item, score: s + (boost ? boost(item) : 0) };
    })
    .filter((x): x is { item: T; score: number } => x !== null)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);
}

/* ---- Calculator: + - * / % ^ and parentheses, no eval() ---- */

export function evaluate(expr: string): number | null {
  if (!/^[\d\s+\-*/%^().,]+$/.test(expr) || !/\d/.test(expr)) return null;
  const src = expr.replace(/,/g, ".");
  let i = 0;

  const peek = () => src[i];
  const skip = () => {
    while (i < src.length && src[i] === " ") i++;
  };

  function number(): number | null {
    skip();
    const start = i;
    while (i < src.length && /[\d.]/.test(src[i])) i++;
    if (i === start) return null;
    const n = Number(src.slice(start, i));
    return Number.isFinite(n) ? n : null;
  }

  function primary(): number | null {
    skip();
    if (peek() === "(") {
      i++;
      const v = expression();
      skip();
      if (peek() !== ")") return null;
      i++;
      return v;
    }
    return number();
  }

  function unary(): number | null {
    skip();
    if (peek() === "-") {
      i++;
      const v = unary();
      return v === null ? null : -v;
    }
    if (peek() === "+") {
      i++;
      return unary();
    }
    return primary();
  }

  function power(): number | null {
    const base = unary();
    if (base === null) return null;
    skip();
    if (peek() === "^") {
      i++;
      const exp = power(); // right-associative
      return exp === null ? null : Math.pow(base, exp);
    }
    return base;
  }

  function term(): number | null {
    let v = power();
    if (v === null) return null;
    for (;;) {
      skip();
      const op = peek();
      if (op !== "*" && op !== "/" && op !== "%") return v;
      i++;
      const rhs = power();
      if (rhs === null) return null;
      if (op === "*") v *= rhs;
      else if (op === "/") v /= rhs;
      else v %= rhs;
    }
  }

  function expression(): number | null {
    let v = term();
    if (v === null) return null;
    for (;;) {
      skip();
      const op = peek();
      if (op !== "+" && op !== "-") return v;
      i++;
      const rhs = term();
      if (rhs === null) return null;
      v = op === "+" ? v + rhs : v - rhs;
    }
  }

  const out = expression();
  skip();
  if (out === null || i !== src.length || !Number.isFinite(out)) return null;
  return out;
}

/** Only show the calculator row for real expressions, not bare numbers. */
export function looksLikeMath(query: string): boolean {
  return /\d/.test(query) && /[+\-*/%^]/.test(query.slice(1));
}

export function formatNumber(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return n.toLocaleString("en-US");
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}
