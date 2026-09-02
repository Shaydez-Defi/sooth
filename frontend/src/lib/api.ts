// Typed fetch client for Sooth Fastify API — mirrors src/api/routes/* shapes exactly.
// Base URL is env var, not hardcoded. No silent catches: every fetch throws typed ApiError on failure.

export type DataIntegrityTag =
  | "LIVE_ONCHAIN"
  | "LIVE_INDEXER"
  | "DERIVED"
  | "HISTORICAL"
  | "ESTIMATED"
  | "LIVE_INDEXER/LIVE_ONCHAIN"
  | "HISTORICAL/DERIVED"
  | "HISTORICAL/ESTIMATED/DERIVED"
  | "DERIVED (persisted bot_events)"
  | "DERIVED (persisted)"
  | string;

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:3000";

export class ApiError extends Error {
  public readonly status: number;
  public readonly dataIntegrity: DataIntegrityTag | null;
  public readonly body: unknown;
  constructor(message: string, status: number, dataIntegrity: DataIntegrityTag | null, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.dataIntegrity = dataIntegrity;
    this.body = body;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      ...init,
    });
  } catch (err) {
    const hint =
      (err as Error).message.includes("Failed to fetch") || (err as Error).message.includes("NetworkError")
        ? ` — API not reachable at ${API_BASE}. Is the backend running? In a separate terminal run: npm run api  (from repo root, port 3000). If using a different URL, set VITE_API_BASE_URL in frontend/.env and restart vite.`
        : "";
    throw new ApiError(`Network error fetching ${path}: ${(err as Error).message}${hint}`, 0, null, null);
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      body !== null && typeof body === "object" && "error" in (body as Record<string, unknown>)
        ? String((body as Record<string, unknown>).error)
        : `HTTP ${res.status} ${res.statusText} for ${path}`;
    const di =
      body !== null && typeof body === "object" && "dataIntegrity" in (body as Record<string, unknown>)
        ? String((body as Record<string, unknown>).dataIntegrity)
        : null;
    throw new ApiError(msg, res.status, di, body);
  }
  return body as T;
}

// ── Market / Analysis ────────────────────────────────────────────────────────

export interface MarketSummary {
  marketId: string; // LIVE_ONCHAIN
  symbol: string; // LIVE_INDEXER
  asset: string; // LIVE_INDEXER
  expiry: string | null; // LIVE_ONCHAIN (stringified bigint)
  venueId: string; // LIVE_ONCHAIN
  dataIntegrity: { marketId: DataIntegrityTag; symbol: DataIntegrityTag; asset: DataIntegrityTag; expiry: DataIntegrityTag };
}

export interface MarketsResponse {
  data: MarketSummary[];
  dataIntegrity: DataIntegrityTag;
  count: number;
}

export function getMarkets(): Promise<MarketsResponse> {
  return apiFetch<MarketsResponse>("/markets");
}

export interface MarketDetailInfo {
  marketId: string;
  asset?: string;
  intervalSec?: number;
  expiry?: number | string;
  venueId?: string;
  [k: string]: unknown;
}

export interface MarketDetailResponse {
  data: {
    unified: { symbol: string; info: MarketDetailInfo; dataIntegrity: DataIntegrityTag };
    onchain: Record<string, unknown> & { dataIntegrity: DataIntegrityTag };
  };
  dataIntegrity: DataIntegrityTag;
}

export function getMarketById(id: string): Promise<MarketDetailResponse> {
  return apiFetch<MarketDetailResponse>(`/markets/${encodeURIComponent(id)}`);
}

export interface OrderbookResponse {
  data: {
    marketId: string;
    symbol: string;
    yesSymbol: string;
    bids: [number, number][];
    asks: [number, number][];
  };
  dataIntegrity: { marketId: DataIntegrityTag; symbol: DataIntegrityTag; bids: DataIntegrityTag; asks: DataIntegrityTag };
}

export function getOrderbook(id: string, depth = 3): Promise<OrderbookResponse> {
  return apiFetch<OrderbookResponse>(`/markets/${encodeURIComponent(id)}/orderbook?depth=${depth}`);
}

// Mirrors src/analysis/types.ts MarketAnalysis exactly
export interface MarketAnalysis {
  readonly marketId: string; // LIVE_ONCHAIN
  readonly symbol: string; // LIVE_INDEXER
  readonly direction: "YES" | "NO" | "NONE"; // DERIVED
  readonly marketProbability: number; // LIVE_INDEXER
  readonly estimatedProbability: number; // DERIVED
  readonly edge: number; // DERIVED
  readonly liquidity: number; // DERIVED
  readonly spread: number; // DERIVED
  readonly spreadBps: number; // DERIVED
  readonly timeRemaining: number; // LIVE_ONCHAIN
  readonly signalStrength: number; // DERIVED
  readonly recommendation: "TRADE" | "NO_TRADE"; // DERIVED
  readonly reasons: string[]; // DERIVED
  readonly imbalance: number; // DERIVED
}

export interface AnalysisResponse {
  data: MarketAnalysis;
  dataIntegrity: { analysis: DataIntegrityTag; marketProbability: DataIntegrityTag; timeRemaining: DataIntegrityTag };
}

export function getAnalysis(id: string): Promise<AnalysisResponse> {
  return apiFetch<AnalysisResponse>(`/markets/${encodeURIComponent(id)}/analysis`);
}

// POST /strategies/analyze — single or all
export interface AnalyzeRequest {
  marketId?: string;
  symbol?: string;
  all?: boolean;
}
export interface AnalyzeResponse {
  data: Array<{ marketId: string; symbol: string; analysis: MarketAnalysis; dataIntegrity: unknown }>;
  dataIntegrity: DataIntegrityTag;
  count: number;
}
export function postAnalyze(body: AnalyzeRequest): Promise<AnalyzeResponse> {
  return apiFetch<AnalyzeResponse>("/strategies/analyze", { method: "POST", body: JSON.stringify(body) });
}

// ── Backtest ─────────────────────────────────────────────────────────────────

export interface BacktestTrade {
  readonly marketId: string;
  readonly symbol: string;
  readonly direction: "YES" | "NO";
  readonly entryPrice: number;
  readonly estimatedProbability: number;
  readonly edge: number;
  readonly imbalance: number;
  readonly size: number;
  readonly winningOutcome: number | null;
  readonly voided: boolean;
  readonly pnl: number;
  readonly won: boolean;
  readonly bookTag: string;
}
export interface BacktestMetrics {
  readonly totalMarkets: number;
  readonly tradableMarkets: number;
  readonly numberOfTrades: number;
  readonly winningTrades: number;
  readonly losingTrades: number;
  readonly winRate: number;
  readonly totalPnL: number;
  readonly averageReturn: number;
  readonly maximumDrawdown: number;
  readonly averageEdge: number;
  readonly tradeFrequency: number;
  readonly startingCapital: number;
  readonly endingCapital: number;
  readonly trades: readonly BacktestTrade[];
}
export interface BacktestResponse {
  data: {
    metrics: BacktestMetrics | null;
    count: number;
    dataIntegrity: { marketId: DataIntegrityTag; winningOutcome: DataIntegrityTag; book: DataIntegrityTag; metrics: DataIntegrityTag };
    thresholdsOverride: Record<string, number> | null;
    note?: string;
  };
  dataIntegrity: DataIntegrityTag;
}
export function postBacktest(body: { limit?: number; startingCapital?: number; sizePerTrade?: number; thresholds?: Record<string, number> } = {}): Promise<BacktestResponse> {
  return apiFetch<BacktestResponse>("/strategies/backtest", { method: "POST", body: JSON.stringify(body) });
}

// ── Positions / Orders / Portfolio ───────────────────────────────────────────

export interface BotPositionRow {
  readonly marketId: string;
  readonly symbol: string;
  readonly side: "YES" | "NO";
  readonly netPosition: number;
  readonly totalSize: number;
  readonly avgEntryPrice: number | null;
  readonly realizedPnL: number;
  readonly status: "OPEN" | "CLOSED";
  readonly realizationSource: "SETTLEMENT" | "EARLY_CLOSE" | null;
  readonly realizedAtUnix: number | null;
  readonly updatedAtUnix: number;
}
export interface PositionsResponse {
  data: { positions: BotPositionRow[]; totalRealizedPnL: number; count: number };
  dataIntegrity: { positions: DataIntegrityTag; totalRealizedPnL: DataIntegrityTag };
}
export function getPositions(): Promise<PositionsResponse> {
  return apiFetch<PositionsResponse>("/positions");
}

export interface OrdersResponse {
  data: Array<{ marketId: string; symbol: string; yesSymbol: string; orders: unknown[]; dataIntegrity: string }>;
  dataIntegrity: DataIntegrityTag;
}
export function getOrders(): Promise<OrdersResponse> {
  return apiFetch<OrdersResponse>("/orders");
}

export interface PortfolioResponse {
  data: {
    balances: { nativeWei: string; tUsdcRaw: string; nativeHuman: number; tUsdcHuman: number; collateral: string; dataIntegrity: string } | null;
    balancesDataIntegrity: string;
    positions: BotPositionRow[];
    totalRealizedPnL: number;
    positionsCount: number;
  };
  dataIntegrity: { balances: string; positions: DataIntegrityTag; totalRealizedPnL: DataIntegrityTag };
}
export function getPortfolio(): Promise<PortfolioResponse> {
  return apiFetch<PortfolioResponse>("/portfolio");
}

export interface PlaceOrderRequest {
  marketId?: string;
  symbol?: string;
  side: "YES" | "NO";
  price: number;
  size: number;
}
export interface PlaceOrderResponse {
  data: { txHash: string; blockNumber: string; orderId: string; price: number; size: number; symbol: string; marketId: string };
  dataIntegrity: { txHash: DataIntegrityTag; blockNumber: DataIntegrityTag; orderId: DataIntegrityTag; price: DataIntegrityTag; size: DataIntegrityTag };
  risk: { approved: boolean; rejectionReasons: string[] };
}
export function postOrder(body: PlaceOrderRequest): Promise<PlaceOrderResponse> {
  return apiFetch<PlaceOrderResponse>("/orders", { method: "POST", body: JSON.stringify(body) });
}

export interface CancelOrderResponse {
  data: { txHash: string; blockNumber: string; orderId: string; stillOpen: boolean };
  dataIntegrity: { txHash: DataIntegrityTag; blockNumber: DataIntegrityTag; orderId: DataIntegrityTag };
}
export function cancelOrder(orderId: string, marketId?: string): Promise<CancelOrderResponse> {
  const body = marketId ? { marketId } : {};
  return apiFetch<CancelOrderResponse>(`/orders/${encodeURIComponent(orderId)}/cancel`, { method: "POST", body: JSON.stringify(body) });
}

// ── Bots ─────────────────────────────────────────────────────────────────────

export interface BotListItem {
  id: string;
  config: unknown;
  status: "running" | "stopped";
  tickCount: number;
  dataIntegrity: { config: DataIntegrityTag; status: DataIntegrityTag; tickCount: DataIntegrityTag };
}
export interface BotsResponse {
  data: BotListItem[];
  dataIntegrity: DataIntegrityTag;
  note: string;
  knownLimitation: string;
}
export function getBots(): Promise<BotsResponse> {
  return apiFetch<BotsResponse>("/bots");
}

export interface BotPerformanceMetrics {
  readonly grossPnL: number;
  readonly gasCost: number;
  readonly netPnL: number;
  readonly winRate: number | null;
  readonly tradeCount: number;
  readonly winningTrades: number | null;
  readonly losingTrades: number | null;
  readonly resolvedTrades: number;
  readonly openPositions: number;
  readonly averageEdge: number | null;
  readonly realizedEdge: number | null;
  readonly maximumDrawdown: number | null;
  readonly executionQuality: number | null;
  readonly adverseSelection: number | null;
  readonly insufficientDataReason: string | null;
  readonly gaps: string[];
}
export interface BotPerformanceResponse {
  data: {
    status: "ok" | "insufficient_data";
    dataIntegrity: { fills: DataIntegrityTag; positions: DataIntegrityTag; edgeAtDecision: DataIntegrityTag; snapshots: DataIntegrityTag; computed: DataIntegrityTag };
    metrics: BotPerformanceMetrics | null;
    fillsCount: number;
    positionsCount: number;
  };
  dataIntegrity: { fills: DataIntegrityTag; positions: DataIntegrityTag; edgeAtDecision: DataIntegrityTag; snapshots: DataIntegrityTag; computed: DataIntegrityTag };
}
export function getBotPerformance(id = "default"): Promise<BotPerformanceResponse> {
  return apiFetch<BotPerformanceResponse>(`/bots/${encodeURIComponent(id)}/performance`);
}

export interface BotEventRow {
  readonly id: number;
  readonly createdAtUnix: number;
  readonly createdAtIso: string;
  readonly marketId: string | null;
  readonly symbol: string | null;
  readonly eventType: string;
  readonly data: string;
  readonly blockNumber: number | null;
  readonly dataJson?: unknown;
}
export interface BotEventsResponse {
  data: BotEventRow[];
  pagination: { limit: number; offset: number; total: number };
  dataIntegrity: DataIntegrityTag;
}
export function getBotEvents(id = "default", params: { limit?: number; offset?: number; eventType?: string } = {}): Promise<BotEventsResponse> {
  const qs = new URLSearchParams();
  if (params.limit !== undefined) qs.set("limit", String(params.limit));
  if (params.offset !== undefined) qs.set("offset", String(params.offset));
  if (params.eventType !== undefined) qs.set("eventType", params.eventType);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return apiFetch<BotEventsResponse>(`/bots/${encodeURIComponent(id)}/events${suffix}`);
}

export interface HealthResponse {
  status: string;
  dataIntegrity: DataIntegrityTag;
  timestamp: string;
}
export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/health");
}

export { API_BASE };
