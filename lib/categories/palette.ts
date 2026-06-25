// Muted "ledger" palette — desaturated, mid-tone hues that sit on warm paper
// without outshining the ink/green theme. Derived from the approved donut
// mockup. Used to seed system categories and offer on-brand swatches.

export const SYSTEM_CATEGORY_COLORS: Record<string, string> = {
  Groceries: "#5e8c6a",     // sage
  Dining: "#c0683c",        // terracotta
  Transport: "#466585",     // slate blue
  Utilities: "#7a5c7e",     // mauve
  Bills: "#a84f3f",         // brick
  Subscriptions: "#b06a86", // dusty rose
  Shopping: "#c2922f",      // ochre
  Entertainment: "#5a5e94", // indigo
  Health: "#3e8076",        // teal
  Travel: "#3f6e9e",        // denim
  Income: "#1f7a52",        // ledger green
  Transfers: "#8a8d80",     // warm grey
  Fees: "#9a4b2e",          // rust
  Other: "#9c968a",         // taupe
  Uncategorized: "#a6a39a", // grey
};

export const DEFAULT_CATEGORY_COLOR = "#8a8d80";

// Swatches offered when creating a custom category, in a pleasing order.
export const CATEGORY_PALETTE: string[] = [
  "#5e8c6a", "#3e8076", "#1f7a52", "#466585", "#3f6e9e", "#5a5e94",
  "#7a5c7e", "#b06a86", "#c0683c", "#a84f3f", "#9a4b2e", "#c2922f",
  "#8a8d80", "#9c968a",
];
