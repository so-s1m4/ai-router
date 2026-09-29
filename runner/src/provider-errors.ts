export function isQuotaError(message: string): boolean {
  return /rate.?limit|quota|too many requests|usage limit|out of credits|insufficient credits|credits exhausted/i.test(message);
}
