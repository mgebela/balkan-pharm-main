/*
 * Shared retry classification for mint/market queue workers.
 * Permanent fail only on definitive on-chain / validation errors.
 */

export function isRetryableChainError(err) {
  const msg = String(err && err.message ? err.message : err);
  if (/Payment transaction failed on-chain|Payment too low|Payment does not debit|Invalid growth stage|Journal proof failed|missing buyerPubkey|missing paymentSignature/i.test(msg)) {
    return false;
  }
  return /block height exceeded|has expired|429|Too Many Requests|Payment transaction not found|not found on devnet|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|network|timeout|temporar|unavailable|503|502|504|gateway|rate limit|503 Service|502 Bad|Incorrect account owner|0x39|custom program error: 0x39|Simulation failed/i.test(
    msg
  );
}
