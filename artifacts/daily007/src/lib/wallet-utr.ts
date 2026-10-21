export function sanitizeWalletUtrInput(value: string): string {
  return value.replace(/[^0-9]/g, '').slice(0, 12);
}

export function isValidWalletUtr(value: string): boolean {
  return /^[0-9]{12}$/.test(value);
}
