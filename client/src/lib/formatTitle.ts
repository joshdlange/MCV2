const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'so', 'the', 'to', 'up', 'yet', 'vs', 'via'
]);

const KNOWN_ACRONYMS = new Set([
  'XMEN', 'X-MEN', 'USA', 'UK', 'DC', 'MCU', 'CGC', 'PSA', 'BGS', 'SP', 'SSP', 'UD', 'XL', 'MVP', 'VIP', 'NYC', 'LA', 'SF', 'HQ', 'ID', 'TV', 'DVD', 'CD', 'DJ', 'AI', 'NFL', 'NBA', 'NHL', 'MLB', 'WWE', 'UFC', 'TKO', 'KO'
]);

function removeBrackets(text: string): string {
  return text.replace(/[\[\]]/g, '');
}

function normalizeSpacing(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function isAcronym(word: string): boolean {
  const upper = word.toUpperCase();
  if (KNOWN_ACRONYMS.has(upper)) return true;
  if (/^[A-Z]{2,}(-[A-Z]+)*$/.test(word)) return true;
  if (/^[A-Z][A-Z0-9-]+$/.test(word) && word.includes('-')) return true;
  return false;
}

function hasMixedCase(word: string): boolean {
  if (word.length < 2) return false;
  const hasLower = /[a-z]/.test(word);
  const hasUpper = /[A-Z]/.test(word);
  if (!hasLower || !hasUpper) return false;
  if (/^[A-Z][a-z]+$/.test(word)) return false;
  if (/^Mc[A-Z][a-z]+$/.test(word)) return true;
  if (/^[a-z]+[A-Z]/.test(word)) return true;
  if (/[A-Z][a-z]+[A-Z]/.test(word)) return true;
  return false;
}

function isAlreadyProperlyCapitalized(word: string): boolean {
  if (word.length < 2) return false;
  if (/^[A-Z][a-z]+$/.test(word)) return true;
  if (hasMixedCase(word)) return true;
  return false;
}

function capitalizeWord(word: string, isFirst: boolean): string {
  if (!word) return word;
  
  if (isAcronym(word)) return word;
  
  if (hasMixedCase(word)) return word;
  
  const lowerWord = word.toLowerCase();
  
  if (!isFirst && SMALL_WORDS.has(lowerWord)) {
    return lowerWord;
  }
  
  if (/^\d/.test(word)) {
    const match = word.match(/^(\d+)(.*)$/);
    if (match) {
      const [, digits, rest] = match;
      if (rest && rest.length > 0) {
        if (hasMixedCase(rest)) return digits + rest;
        return digits + rest.charAt(0).toUpperCase() + rest.slice(1).toLowerCase();
      }
      return word;
    }
  }
  
  if (word.includes('-')) {
    return word.split('-').map((part, idx) => capitalizeWord(part, idx === 0 || isFirst)).join('-');
  }
  
  if (word.includes(':')) {
    return word.split(':').map((part, idx) => capitalizeWord(part, idx === 0 || isFirst)).join(':');
  }
  
  if (word.includes("'")) {
    const parts = word.split("'");
    return parts.map((part, idx) => {
      if (idx === 0) return capitalizeWord(part, isFirst);
      return part.length === 1 ? part.toLowerCase() : capitalizeWord(part, false);
    }).join("'");
  }
  
  if (isAlreadyProperlyCapitalized(word)) return word;
  
  if (/^[a-z]+$/.test(word)) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
  
  if (/^[A-Z]+$/.test(word) && word.length > 1) {
    return word;
  }
  
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function formatTitle(title: string | null | undefined): string {
  if (!title) return '';
  
  let cleaned = removeBrackets(title);
  cleaned = normalizeSpacing(cleaned);
  
  if (!cleaned) return '';
  
  const words = cleaned.split(' ');
  
  return words.map((word, index) => {
    const isFirst = index === 0;
    return capitalizeWord(word, isFirst);
  }).join(' ');
}

export function formatSetName(name: string | null | undefined): string {
  return formatTitle(name);
}

export function formatCardName(name: string | null | undefined): string {
  return formatTitle(name);
}
