type CardNumberToken =
  | { kind: "number"; value: string }
  | { kind: "text"; value: string };

function tokenizeCardNumber(value: string): CardNumberToken[] {
  return (value.match(/\d+|\D+/g) ?? []).map((token) => {
    if (/^\d+$/.test(token)) {
      return {
        kind: "number",
        value: token.replace(/^0+(?=\d)/, ""),
      };
    }
    return { kind: "text", value: token.toLowerCase() };
  });
}

export function compareCardNumbers(
  leftValue: string | null | undefined,
  rightValue: string | null | undefined,
): number {
  const left = leftValue?.trim() ?? "";
  const right = rightValue?.trim() ?? "";

  if (!left && right) return 1;
  if (left && !right) return -1;

  const leftTokens = tokenizeCardNumber(left);
  const rightTokens = tokenizeCardNumber(right);
  const tokenCount = Math.max(leftTokens.length, rightTokens.length);

  for (let index = 0; index < tokenCount; index++) {
    const leftToken = leftTokens[index];
    const rightToken = rightTokens[index];
    if (!leftToken) return -1;
    if (!rightToken) return 1;

    if (leftToken.kind === "number" && rightToken.kind === "number") {
      if (leftToken.value.length !== rightToken.value.length) {
        return leftToken.value.length - rightToken.value.length;
      }
      if (leftToken.value !== rightToken.value) {
        return leftToken.value < rightToken.value ? -1 : 1;
      }
      continue;
    }

    if (leftToken.kind !== rightToken.kind) {
      return leftToken.kind === "number" ? -1 : 1;
    }

    if (leftToken.value !== rightToken.value) {
      return leftToken.value < rightToken.value ? -1 : 1;
    }
  }

  return left.localeCompare(right);
}