export function formatTitle(title: string | null | undefined): string {
  if (!title) return '';
  
  const trimmed = title.trim();
  if (!trimmed) return '';
  
  const parts = trimmed.split(/(\s+)/);
  
  return parts.map((part, index) => {
    if (/^\s+$/.test(part)) return part;
    
    if (/^[A-Z]{2,}(-[A-Z]+)*$/.test(part)) {
      return part;
    }
    
    if (/^[A-Z][A-Z0-9-]+$/.test(part) && part.includes('-')) {
      return part;
    }
    
    if (/^\d/.test(part)) {
      const match = part.match(/^(\d+)(.*)$/);
      if (match) {
        const [, digits, rest] = match;
        if (rest && rest.length > 0) {
          return digits + rest.charAt(0).toUpperCase() + rest.slice(1);
        }
        return part;
      }
    }
    
    if (part.length > 0 && /^[a-z]/.test(part)) {
      return part.charAt(0).toUpperCase() + part.slice(1);
    }
    
    return part;
  }).join('');
}

export function formatSetName(name: string | null | undefined): string {
  return formatTitle(name);
}

export function formatCardName(name: string | null | undefined): string {
  return formatTitle(name);
}
