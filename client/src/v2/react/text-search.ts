export interface TextMatch {
  start: number;
  end: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Finds a textarea match without cloning the full document into React state. */
export function findTextMatch(
  text: string,
  query: string,
  from: number,
  direction: "next" | "previous",
): TextMatch | null {
  if (!query) return null;
  const expression = new RegExp(escapeRegExp(query), "giu");
  const boundary = Math.max(0, Math.min(from, text.length));

  if (direction === "next") {
    expression.lastIndex = boundary;
    let match = expression.exec(text);
    if (!match && boundary > 0) {
      expression.lastIndex = 0;
      match = expression.exec(text);
    }
    return match ? { start: match.index, end: match.index + match[0].length } : null;
  }

  let previous: RegExpExecArray | null = null;
  let match = expression.exec(text);
  while (match && match.index < boundary) {
    previous = match;
    match = expression.exec(text);
  }
  if (!previous && boundary < text.length) {
    expression.lastIndex = 0;
    match = expression.exec(text);
    while (match) {
      previous = match;
      match = expression.exec(text);
    }
  }
  return previous ? { start: previous.index, end: previous.index + previous[0].length } : null;
}
