export function pricingUrl(intent: string): string {
  return `https://yaak.app/pricing?intent=${encodeURIComponent(intent)}`;
}
