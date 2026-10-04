// CENTRAL COIN VALUE CONFIGURATION — single source of truth for the whole app.
// 1 Coin = ₹1 INR. Every screen must import from here; never hardcode prices.
export const COIN_RATE = 1; // ₹ per coin

export const toINR = (coins: number, rate = COIN_RATE) =>
  Math.round((coins || 0) * rate * 100) / 100;

export const formatInrAmount = (amount: number) =>
  `₹${toINR(amount, 1).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const inr = (coins: number, rate = COIN_RATE) =>
  formatInrAmount(toINR(coins, rate));

export const depositAmountInr = (
  coins: number,
  storedAmount: unknown,
  rate = COIN_RATE,
) => {
  const amount = Number(storedAmount);
  return storedAmount !== null && storedAmount !== undefined && Number.isFinite(amount) && amount > 0
    ? formatInrAmount(amount)
    : inr(coins, rate);
};

// Coin packages — price is always coins × COIN_RATE
export const COIN_PACKAGES = [10, 20, 30, 50, 100, 200, 250, 300, 500].map((coins) => ({
  coins,
  price: toINR(coins),
  label: `${coins} Coins`,
  priceLabel: `₹${toINR(coins)}`,
}));

export const COIN_RATE_TEXT = '1 Coin = ₹1';
