/**
 * ROI calculator helpers — restoration, flip, hold.
 * Auction fee defaults: BaT 5% buyer premium (cap $7.5k), C&B 4.5% (cap $4.5k).
 * Storage default: $200/mo, insurance: $80/mo.
 */

export const FEES = {
  bat: { rate: 0.05, cap: 7500 },
  carsAndBids: { rate: 0.045, cap: 4500 },
};

export const HOLD_COSTS = {
  storagePerMonth: 200,
  insurancePerMonth: 80,
};

export type AuctionChannel = "bat" | "cars-and-bids" | "private";

export function buyerPremium(price: number, channel: AuctionChannel): number {
  if (channel === "bat") return Math.min(price * FEES.bat.rate, FEES.bat.cap);
  if (channel === "cars-and-bids")
    return Math.min(price * FEES.carsAndBids.rate, FEES.carsAndBids.cap);
  return 0;
}

export interface RestorationInput {
  purchasePriceUsd: number;
  restorationCostUsd: number;
  postRestoMarketValueUsd: number;
  monthsToComplete: number;
  saleChannel: AuctionChannel;
}

export interface RestorationResult {
  totalInUsd: number;
  feesUsd: number;
  netSaleUsd: number;
  profitUsd: number;
  roiPct: number;
  annualizedRoiPct: number;
}

export function calcRestoration(i: RestorationInput): RestorationResult {
  const totalIn = i.purchasePriceUsd + i.restorationCostUsd + HOLD_COSTS.storagePerMonth * i.monthsToComplete;
  const fees = buyerPremium(i.postRestoMarketValueUsd, i.saleChannel);
  const netSale = i.postRestoMarketValueUsd - fees;
  const profit = netSale - totalIn;
  const roi = totalIn > 0 ? profit / totalIn : 0;
  const years = Math.max(i.monthsToComplete / 12, 1 / 12);
  const annualized = totalIn > 0 ? Math.pow(1 + roi, 1 / years) - 1 : 0;
  return {
    totalInUsd: Math.round(totalIn),
    feesUsd: Math.round(fees),
    netSaleUsd: Math.round(netSale),
    profitUsd: Math.round(profit),
    roiPct: roi,
    annualizedRoiPct: annualized,
  };
}

export interface FlipInput {
  purchasePriceUsd: number;
  cosmeticBudgetUsd: number;
  expectedSaleUsd: number;
  monthsToFlip: number;
  saleChannel: AuctionChannel;
}

export function calcFlip(i: FlipInput): RestorationResult {
  return calcRestoration({
    purchasePriceUsd: i.purchasePriceUsd,
    restorationCostUsd: i.cosmeticBudgetUsd,
    postRestoMarketValueUsd: i.expectedSaleUsd,
    monthsToComplete: i.monthsToFlip,
    saleChannel: i.saleChannel,
  });
}

export interface HoldInput {
  currentValueUsd: number;
  cagrPct: number; // forecasted annual appreciation
  yearsHeld: number;
  monthlyStorageUsd?: number;
  monthlyInsuranceUsd?: number;
  saleChannel: AuctionChannel;
}

export interface HoldResult {
  futureValueUsd: number;
  totalCostsUsd: number;
  feesUsd: number;
  netSaleUsd: number;
  netProfitUsd: number;
  netRoiPct: number;
  annualizedNetRoiPct: number;
}

export function calcHold(i: HoldInput): HoldResult {
  const future = i.currentValueUsd * Math.pow(1 + i.cagrPct, i.yearsHeld);
  const months = i.yearsHeld * 12;
  const storage = (i.monthlyStorageUsd ?? HOLD_COSTS.storagePerMonth) * months;
  const insurance = (i.monthlyInsuranceUsd ?? HOLD_COSTS.insurancePerMonth) * months;
  const totalCosts = storage + insurance;
  const fees = buyerPremium(future, i.saleChannel);
  const netSale = future - fees;
  const netProfit = netSale - i.currentValueUsd - totalCosts;
  const roi = i.currentValueUsd > 0 ? netProfit / i.currentValueUsd : 0;
  const annualized = i.yearsHeld > 0 ? Math.pow(1 + roi, 1 / i.yearsHeld) - 1 : 0;
  return {
    futureValueUsd: Math.round(future),
    totalCostsUsd: Math.round(totalCosts),
    feesUsd: Math.round(fees),
    netSaleUsd: Math.round(netSale),
    netProfitUsd: Math.round(netProfit),
    netRoiPct: roi,
    annualizedNetRoiPct: annualized,
  };
}
