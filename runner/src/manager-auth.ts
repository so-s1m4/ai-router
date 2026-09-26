import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

export const MANAGEMENT_KDF_ITERATIONS = 210_000;

export class ManagementPasswordGate {
  private readonly salt = randomBytes(16);
  private readonly key: Buffer;
  private readonly challenges = new Map<string, number>();
  private failures = 0;
  private blockedUntil = 0;

  constructor(password: string) {
    if (password.length < 16) throw new Error('RUNNER_MANAGER_PASSWORD must have at least 16 characters');
    this.key = pbkdf2Sync(password, this.salt, MANAGEMENT_KDF_ITERATIONS, 32, 'sha256');
  }

  challenge() {
    if (Date.now() < this.blockedUntil) throw new Error('Слишком много попыток. Повторите позже.');
    for (const [nonce, until] of this.challenges) if (until < Date.now()) this.challenges.delete(nonce);
    if (this.challenges.size >= 100) this.challenges.delete(this.challenges.keys().next().value!);
    const nonce = randomBytes(24).toString('base64url');
    this.challenges.set(nonce, Date.now() + 60_000);
    return { nonce, salt: this.salt.toString('base64url'), iterations: MANAGEMENT_KDF_ITERATIONS };
  }

  verify(nonce: string, proof: string, op: string, payload: Record<string, unknown>): boolean {
    const expires = this.challenges.get(nonce);
    this.challenges.delete(nonce);
    if (!expires || expires < Date.now() || Date.now() < this.blockedUntil) return false;
    const expected = createHmac('sha256', this.key).update(JSON.stringify({ nonce, op, payload })).digest();
    const actual = Buffer.from(proof, 'base64url');
    const valid = actual.length === expected.length && timingSafeEqual(actual, expected);
    if (valid) this.failures = 0;
    else if (++this.failures >= 5) { this.failures = 0; this.blockedUntil = Date.now() + 60_000; }
    return valid;
  }
}
