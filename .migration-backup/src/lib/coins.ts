// CENTRAL COIN VALUE CONFIGURATION — single source of truth for the whole app.
// 1 Coin = ₹1 INR. Every screen must import from here; never hardcode prices.
export const COIN_RATE = 1; // ₹ per coin

export const toINR = (coins: number) => Math.round((coins || 0) * COIN_RATE);

export const inr = (coins: number) => `₹${toINR(coins)}`;

// Coin packages — price is always coins × COIN_RATE
export const COIN_PACKAGES = [10, 20, 30, 50, 100, 200, 250, 300, 500].map((coins) => ({
  coins,
  price: toINR(coins),
  label: `${coins} Coins`,
  priceLabel: `₹${toINR(coins)}`,
}));

export const COIN_RATE_TEXT = '1 Coin = ₹1';
