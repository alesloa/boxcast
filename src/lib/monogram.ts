// Deterministic colored monogram tile for items without a logo (like the mockup).
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return (name.trim().slice(0, 2) || "?").toUpperCase();
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function monogramGradient(name: string): string {
  const hue = hash(name) % 360;
  const hue2 = (hue + 24) % 360;
  return `linear-gradient(135deg, hsl(${hue} 55% 30%), hsl(${hue2} 60% 45%))`;
}
