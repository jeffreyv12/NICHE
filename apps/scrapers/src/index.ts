// @nichefinder/scrapers — Hetzner-hosted cron + agent runners.
// Real CLI entry (jobs/, registrars/, lib/) lands in Phase 2.2+.

export * as dataforseo from "./sources/dataforseo/index.js";
export * as bol from "./sources/bol/index.js";
export * as awin from "./sources/awin/index.js";
export * as daisycon from "./sources/daisycon/index.js";
export * as youtube from "./sources/youtube/index.js";
export * as wikipedia from "./sources/wikipedia/index.js";
export * as euipo from "./sources/euipo/index.js";

export { runDiscoveryJob } from "./jobs/discovery.js";
export type {
  RunDiscoveryJobOptions,
  RunDiscoveryJobResult,
  DiscoverySignal,
  SignalGatherer,
  EuipoAdapter,
} from "./jobs/discovery.js";
export { runScoringJob } from "./jobs/scoring.js";
export type { RunScoringJobOptions, RunScoringJobResult } from "./jobs/scoring.js";
export { runTestPageDraftJob } from "./jobs/test-page-draft.js";
export type {
  RunTestPageDraftJobOptions,
  RunTestPageDraftJobResult,
  DraftedTestPage,
} from "./jobs/test-page-draft.js";
export { runTestPageDraftSweep } from "./jobs/test-page-draft-sweep.js";
export type {
  RunTestPageDraftSweepOptions,
  RunTestPageDraftSweepResult,
} from "./jobs/test-page-draft-sweep.js";
export { planTestPages, type TestPagePlanItem } from "./jobs/planTestPages.js";
export { runValidationJob } from "./jobs/validation.js";
export type {
  RunValidationJobOptions,
  RunValidationJobResult,
  ValidationJobOutcome,
} from "./jobs/validation.js";
export {
  buildValidationInput,
  emptyAnalyticsAdapter,
  type AnalyticsAdapter,
  type NicheAnalytics,
  type BuildValidationInputOptions,
} from "./jobs/validationMetrics.js";
export {
  buildDefaultPrefetch,
  type ScoringPrefetch,
  type AffiliateSignalAdapter,
  type KeywordSignalAdapter,
  type PrefetchContext,
} from "./jobs/prefetch.js";
export {
  runReconciliationJob,
  createDefaultReportingAdapter,
  normalizeBolTransaction,
  normalizeAwinTransaction,
  normalizeDaisyconTransaction,
  RECONCILIATION_NETWORKS,
  type ReportingAdapter,
  type ReportingWindow,
  type RunReconciliationJobOptions,
  type RunReconciliationJobResult,
  type NetworkReconResult,
} from "./jobs/reconciliation.js";
export { createDrizzleConversionStore } from "./jobs/conversionStore.js";
export { runContentPolishJob } from "./jobs/content-polish.js";
export type {
  RunContentPolishJobOptions,
  RunContentPolishJobResult,
  PolishedPage,
} from "./jobs/content-polish.js";
export { runKillScanJob, createDefaultKillMetricsAdapter } from "./jobs/killScan.js";
export type {
  RunKillScanJobOptions,
  RunKillScanJobResult,
  KillScanOutcome,
  KillMetricsAdapter,
  NicheKillMetrics,
} from "./jobs/killScan.js";
export {
  runOrchestratorJob,
  createDefaultSnapshotAdapter,
} from "./jobs/orchestrator.js";
export type {
  RunOrchestratorJobOptions,
  RunOrchestratorJobResult,
  PortfolioSnapshotAdapter,
} from "./jobs/orchestrator.js";
export { runPromotionJob, createStubDomainAdapter } from "./jobs/promotion.js";
export type {
  RunPromotionJobOptions,
  RunPromotionJobResult,
  PromotionJobNicheResult,
  CandidateDomainAdapter,
} from "./jobs/promotion.js";
export { runMigration, STEP_NAMES } from "./jobs/migration.js";
export type {
  RunMigrationOptions,
  RunMigrationResult,
  MigrationAdapters,
  CloudflareAdapter,
  TransipAdapter,
  VercelAdapter,
} from "./jobs/migration.js";
export { CloudflareClient, createCloudflareClient } from "./registrars/cloudflare/client.js";
export type {
  CloudflareClientOptions,
  DomainAvailability,
  RegisteredDomain,
  DnsZone,
  DnsRecord,
} from "./registrars/cloudflare/client.js";
export { TransipClient, createTransipClient } from "./registrars/transip/client.js";
export type {
  TransipClientOptions,
  TransipDomainAvailability,
  TransipWhoisResult,
} from "./registrars/transip/client.js";
export { VercelClient, createVercelClient } from "./registrars/vercel/client.js";
export type {
  VercelClientOptions,
  VercelDomainAttachment,
  VercelSslStatus,
} from "./registrars/vercel/client.js";
