export function isQuotaError(message: string): boolean {
  return /rate.?limit|quota|too many requests|usage limit|out of credits|insufficient credits|credits exhausted/i.test(message);
}

export function isAuthError(message: string): boolean {
  return /\b(?:401|403)\b|unauthorized|forbidden|missing bearer|authentication|auth(?:orization)? failed|login required|sign[ -]?in required|invalid (?:api[ -]?key|token)|token (?:expired|revoked)/i.test(message);
}
