/**
 * Pipeline - enforces Strategy → Risk Checks → Execution order.
 * Strategy must NOT call execution directly; only this pipeline may call placeRestingOrder
 * after riskEngine approves. Calling code cannot accidentally skip risk checks.
 *
 * Abstraction: Market Data (analysis) → Strategy → Signal (decision) → Risk Checks → Execution
 */

import type { MarketAnalysis } from "../analysis/types.js";
import type { Strategy, StrategyContext, StrategyDecision } from "./types.js";
import { checkOrder as defaultCheckOrder, type RiskCheckContext, type RiskResult } from "../risk/riskEngine.js";
import { placeRestingOrder as defaultPlaceRestingOrder, type OrderState, type PlaceResultTagged } from "../ec/orderLifecycle.js";
import type { EcContext } from "@dreamdex-bot-kit/ec-core";
import type { MarketOnchain, UnifiedMarket } from "@somnia-chain/markets-sdk";

export interface PipelineInput {
  readonly analysis: MarketAnalysis;
  readonly strategy: Strategy;
  readonly strategyContext: StrategyContext;
  /** EcContext for execution (signer). Only needed if risk approves. */
  readonly ecCtx: EcContext;
  readonly market: UnifiedMarket;
  readonly onchain: MarketOnchain;
  readonly state: OrderState;
  readonly yesSymbol: string;
}

export interface PipelineOverrides {
  /** Override risk check for testing (spy). Defaults to riskEngine.checkOrder. */
  readonly checkOrderFn?: (decision: StrategyDecision, ctx: RiskCheckContext) => RiskResult;
  /** Override execution for testing (spy). Defaults to orderLifecycle.placeRestingOrder. */
  readonly placeOrderFn?: (params: Parameters<typeof defaultPlaceRestingOrder>[0]) => Promise<PlaceResultTagged>;
}

export interface PipelineResult {
  /** StrategyDecision - DERIVED signal. */
  readonly decision: StrategyDecision;
  /** RiskResult - DERIVED checks, null when strategy SKIPs (short-circuit, not called). */
  readonly risk: RiskResult | null;
  /** Whether execution was attempted and succeeded. */
  readonly executed: boolean;
  /** Place result when executed (LIVE_ONCHAIN). Null otherwise. */
  readonly placeResult: PlaceResultTagged | null;
}

/**
 * Enforced pipeline. Order is hard-wired:
 * 1) strategy.decide(analysis, context) → decision
 * 2) if SKIP → short-circuit, do NOT call risk engine, do NOT execute
 * 3) riskEngine.check(decision, { ...strategyContext, analysis }) → risk
 * 4) if not approved → blocked, do NOT execute
 * 5) only then → placeRestingOrder (execution)
 *
 * This function is the ONLY path that should call execution for a strategy decision.
 */
export async function runPipeline(input: PipelineInput, overrides?: PipelineOverrides): Promise<PipelineResult> {
  const { analysis, strategy, strategyContext, ecCtx, market, onchain, state, yesSymbol } = input;
  const checkOrderFn = overrides?.checkOrderFn ?? defaultCheckOrder;
  const placeOrderFn = overrides?.placeOrderFn ?? defaultPlaceRestingOrder;

  // 1) Strategy decides
  const decision: StrategyDecision = strategy.decide(analysis, strategyContext);

  // 2) Short-circuit on SKIP - risk engine MUST NOT be called in this path
  if (decision.action === "SKIP") {
    return { decision, risk: null, executed: false, placeResult: null };
  }

  // 3) Risk checks - context must carry analysis (LIVE_INDEXER/LIVE_ONCHAIN) plus config/positions/balances
  const riskContext: RiskCheckContext = {
    ...strategyContext,
    analysis,
  };
  const risk: RiskResult = checkOrderFn(decision, riskContext);

  // 4) Blocked if any check rejects
  if (!risk.approved) {
    return { decision, risk, executed: false, placeResult: null };
  }

  // 5) Only approved decisions reach execution - wire to Stage 2's orderLifecycle.
  // Map decision.side YES/NO to ec outcome, side always "buy" (buy that outcome at its mid).
  // Price/size from decision (DERIVED from config/analysis, not hardcoded).
  const outcome = decision.side as "YES" | "NO";
  const price = decision.price as number;
  const size = decision.size as number;

  const placeResult = await placeOrderFn({
    ctx: ecCtx,
    market,
    onchain,
    outcome,
    side: "buy",
    price,
    size,
    yesSymbol,
    state,
  });

  return { decision, risk, executed: true, placeResult };
}

/**
 * Dry-run helper - same as runPipeline but without execution.
 * Useful for src/scripts/strategy-dry-run.ts to print what WOULD happen.
 */
export function dryRunPipeline(params: {
  readonly analysis: MarketAnalysis;
  readonly strategy: Strategy;
  readonly strategyContext: StrategyContext;
  readonly checkOrderFn?: (decision: StrategyDecision, ctx: RiskCheckContext) => RiskResult;
}): { decision: StrategyDecision; risk: RiskResult | null } {
  const { analysis, strategy, strategyContext, checkOrderFn } = params;
  const check = checkOrderFn ?? defaultCheckOrder;
  const decision = strategy.decide(analysis, strategyContext);
  if (decision.action === "SKIP") {
    return { decision, risk: null };
  }
  const riskContext: RiskCheckContext = { ...strategyContext, analysis };
  const risk = check(decision, riskContext);
  return { decision, risk };
}
