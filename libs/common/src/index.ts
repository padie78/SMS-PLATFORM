/** Utilidades agnósticas: types, utils (contracts + validation), logging. */

export { Result } from './types/result.js';
export type { Result as ResultType, PagedResult } from './types/index.js';
export * from './logging/index.js';

export {
  EntityType,
  EntityTypeSchema,
  ENTITY_TYPE_VALUES,
  isEntityType,
  ENTITY_TYPE_I18N,
  getEntityTypeI18nKey,
  ENERGY_SERVICE_TYPE_I18N,
  getEnergyServiceTypeI18nKey,
  type EntityTypeI18nKey,
  type EnergyServiceTypeI18nKey
} from './utils/contracts/shared/i18n/index.js';

export { SmsIdSchema, type SmsId } from './utils/validation/schemas/sms-id.schema';

export { type SmsEntityTag } from './utils/contracts/shared/sms-entity-tag';

export {
  AssetTypeSchema,
  MeterTypeSchema,
  UserRoleSchema,
  ASSET_TYPE_TO_PERSISTENCE,
  METER_TYPE_TO_PERSISTENCE,
  type AssetType,
  type MeterType,
  type UserRole
} from './utils/contracts/shared/domain-enums';

export { SmsDomainError, RegionDomainError } from './utils/contracts/shared/sms-domain-error';

export {
  AddressDTOSchema,
  type AddressDTO
} from './utils/contracts/shared/address.dto';

export {
  GeoCoordinatesDTOSchema,
  type GeoCoordinatesDTO
} from './utils/contracts/shared/geo.dto';

export {
  ROLE_TO_CODE,
  decodeAssetType,
  decodeMeterType,
  decodeRole
} from './utils/contracts/shared/persistence-codecs';

export {
  RegionDTOSchema,
  RegionalManagerDTOSchema,
  ClimateZoneSchema,
  CarbonMarketTypeSchema,
  MaturityLevelSchema,
  EconomicAreaSchema,
  parseRegionDTO,
  safeParseRegionDTO,
  RegionDTO,
  type RegionDTOInput,
  type ClimateZone,
  type CarbonMarketType,
  type MaturityLevel,
  type EconomicArea
} from './utils/contracts/region/index';

export {
  BranchDTOSchema,
  BranchStatusSchema,
  BranchTypeSchema,
  OwnershipTypeSchema,
  BackupPowerTypeSchema,
  OperatingHoursDTOSchema,
  BranchManagerDTOSchema,
  parseBranchDTO,
  safeParseBranchDTO,
  BranchDTO,
  type BranchDTOInput,
  type BranchStatus,
  type BranchType,
  type OwnershipType,
  type BackupPowerType
} from './utils/contracts/branch/index';

export {
  BuildingDTOSchema,
  parseBuildingDTO,
  safeParseBuildingDTO,
  BuildingDTO,
  type BuildingDTOInput,
  BuildingInsulationQualitySchema,
  BuildingRoofTypeSchema,
  BuildingMaintenanceStatusSchema,
  BuildingLightingTechnologySchema,
  BuildingDataGranularitySchema,
  BuildingSubmeteringTopologySchema,
  type BuildingInsulationQuality,
  type BuildingRoofType,
  type BuildingMaintenanceStatus,
  type BuildingLightingTechnology,
  type BuildingDataGranularity,
  type BuildingSubmeteringTopology
} from './utils/contracts/building/index';

export {
  CostCenterDTOSchema,
  parseCostCenterDTO,
  safeParseCostCenterDTO,
  CostCenterDTO,
  type CostCenterDTOInput,
  CostCenterTypeSchema,
  CostCenterForecastModelSchema,
  type CostCenterType,
  type CostCenterForecastModel
} from './utils/contracts/cost-center/index';

export {
  AssetDTOSchema,
  parseAssetDTO,
  safeParseAssetDTO,
  AssetDTO,
  type AssetDTOInput,
  AssetCriticalitySchema,
  AssetEnergySourceSchema,
  AssetGhgScopeSchema,
  AssetEmissionSourceCategorySchema,
  AssetConditionIndexSchema,
  AssetRedundancyLevelSchema,
  type AssetCriticality,
  type AssetEnergySource,
  type AssetGhgScope,
  type AssetEmissionSourceCategory,
  type AssetConditionIndex,
  type AssetRedundancyLevel
} from './utils/contracts/asset/index';

export {
  MeterDTOSchema,
  parseMeterDTO,
  safeParseMeterDTO,
  MeterDTO,
  type MeterDTOInput,
  MeterServiceTypeSchema,
  MeterUnitSchema,
  MeterAccuracyClassSchema,
  MeterCommunicationStatusSchema,
  type MeterServiceType,
  type MeterUnit,
  type MeterAccuracyClass,
  type MeterCommunicationStatus
} from './utils/contracts/meter/index';

export {
  UserDTOSchema,
  parseUserDTO,
  safeParseUserDTO,
  type UserDTO
  } from './utils/contracts/user/index';

export {
  InvoiceDTOSchema,
  parseInvoiceDTO,
  safeParseInvoiceDTO,
  type InvoiceDTO,
  InvoiceProcessingSkeletonSchema,
  buildInvoiceProcessingSkeleton,
  type InvoiceProcessingSkeleton,
  type BuildInvoiceProcessingSkeletonParams,
  InvoiceLifecycleStatusSchema,
  InvoiceCalculationMethodSchema,
  InvoiceBillingPeriodSchema,
  InvoiceExtractedDataSchema,
  InvoiceThoughtProcessSchema,
  InvoiceAiAnalysisSchema,
  InvoiceAnalyticsDimensionsSchema,
  InvoiceClimatiqResultSchema,
  InvoiceMetadataSchema,
  InvoiceDdbItemSchema,
  InvoiceConfirmPayloadSchema,
  parseInvoiceDdbItem,
  safeParseInvoiceDdbItem,
  parseInvoiceConfirmPayload,
  safeParseInvoiceConfirmPayload,
  type InvoiceLifecycleStatus,
  type InvoiceCalculationMethod,
  type InvoiceBillingPeriod,
  type InvoiceExtractedData,
  type InvoiceThoughtProcess,
  type InvoiceAiAnalysis,
  type InvoiceAnalyticsDimensions,
  type InvoiceClimatiqResult,
  type InvoiceMetadata,
  type InvoiceDdbItem,
  type InvoiceConfirmPayload,
  InvoiceAuditActorSchema,
  InvoiceAuditActionSchema,
  InvoiceAuditSourceSchema,
  InvoiceAuditEntrySchema,
  InvoiceAuditTrailSchema,
  buildInitialAuditEntry,
  type InvoiceAuditActor,
  type InvoiceAuditAction,
  type InvoiceAuditSource,
  type InvoiceAuditEntry,
  type InvoiceAuditTrail,
  InvoiceIaTechnicalExtractionSchema,
  InvoiceIaExtractionSqsBodySchema,
  parseInvoiceIaExtractionSqsBody,
  buildInitialInvoiceIaTechnicalExtraction,
  // ── State machine v2 (25 estados) ───────────────────────────────────────
  InvoiceLifecycleStateSchema,
  INVOICE_LIFECYCLE_STATE_VALUES,
  TERMINAL_INVOICE_STATES,
  PUBLISHABLE_INVOICE_STATES,
  VALID_INVOICE_STATE_TRANSITIONS,
  ALLOWED_FROM_STATES_FOR,
  INVOICE_STATE_OWNER,
  isValidInvoiceStateTransition,
  type InvoiceLifecycleState,
  // ── Confidence per-field ────────────────────────────────────────────────
  INVOICE_CONFIDENCE_THRESHOLDS,
  InvoiceConfidenceLevelSchema,
  InvoiceConfidenceFieldSchema,
  InvoiceExtractionWarningSchema,
  InvoiceSuspiciousValueSchema,
  classifyConfidence,
  buildConfidenceField,
  InvoiceBoundingBoxSchema,
  InvoiceFieldGeometrySchema,
  type InvoiceBoundingBox,
  type InvoiceFieldGeometry,
  type InvoiceConfidenceLevel,
  type InvoiceConfidenceField,
  type InvoiceExtractionWarning,
  type InvoiceSuspiciousValue,
  INVOICE_LOOKUP_PK_PREFIX,
  InvoiceLookupRefItemSchema,
  buildInvoiceLookupPk,
  buildInvoiceLookupRefItem,
  type InvoiceLookupRefItem,
  // ── Extraction draft ────────────────────────────────────────────────────
  InvoiceExtractionDraftSchema,
  computeOverallConfidence,
  type InvoiceExtractionDraft,
  type InvoiceExtractionParty,
  type InvoiceExtractionEnergyType,
  // ── Mutation inputs ────────────────────────────────────────────────────
  ConfirmInvoiceExtractionInputSchema,
  CreateInvoiceDraftInputSchema,
  RejectInvoiceInputSchema,
  RetryInvoiceProcessingInputSchema,
  InvoiceFieldCorrectionSchema,
  parseConfirmInvoiceExtractionInput,
  safeParseConfirmInvoiceExtractionInput,
  type ConfirmInvoiceExtractionInput,
  type CreateInvoiceDraftInput,
  type RejectInvoiceInput,
  type RetryInvoiceProcessingInput,
  type InvoiceFieldCorrection,
  // ── Lifecycle item META + SK helpers ───────────────────────────────────
  InvoiceIngestionChannelSchema,
  InvoiceItemPointersSchema,
  InvoiceMetaSnapshotSchema,
  InvoiceLifecycleItemSchema,
  DEFAULT_INVOICE_WIP_TTL_SECONDS,
  computeWipTtl,
  buildInvoicePartitionKey,
  buildInvoiceMetaSk,
  buildInvoiceExtractionSk,
  buildInvoiceGoldenSk,
  buildInvoiceAuditSk,
  buildLifecycleGsiAttributes,
  type InvoiceIngestionChannel,
  type InvoiceItemPointers,
  type InvoiceMetaSnapshot,
  type InvoiceLifecycleItem,
  // ── Commit lifecycle (payload final del wizard) ────────────────────────
  CommitInvoiceLifecycleInputSchema,
  parseCommitInvoiceLifecycleInput,
  safeParseCommitInvoiceLifecycleInput,
  type CommitInvoiceLifecycleInput,
  // ── Audit entry items v2 (item-per-entry, append-only) ────────────────
  InvoiceAuditActorTypeSchema,
  InvoiceAuditEventSchema,
  InvoiceAuditActorV2Schema,
  InvoiceAuditEntryItemSchema,
  buildAuditEntryItem,
  type InvoiceAuditActorType,
  type InvoiceAuditEvent,
  type InvoiceAuditActorV2,
  type InvoiceAuditEntryItem
} from './utils/contracts/invoice/index';

export type { InvoiceIaTechnicalExtraction, InvoiceIaExtractionSqsBody } from './utils/contracts/invoice/index';

export {
  PresignedUploadUrlInputSchema,
  parsePresignedUploadUrlInput,
  safeParsePresignedUploadUrlInput,
  PresignedUploadUrlResultSchema,
  parsePresignedUploadUrlResult,
  type PresignedUploadUrlInput,
  type PresignedUploadUrlResult
} from './utils/contracts/presigned-upload/index';

export {
  IndustrySectorSchema,
  CurrencyCodeSchema,
  ReportingCurrencyCodeSchema,
  SubscriptionPlanSchema,
  FacilityTypeSchema,
  IanaTimezoneSchema,
  BuildingUsageTypeSchema,
  OperationalStatusSchema,
  HvacTypeSchema,
  CostAllocationMethodSchema,
  UserLanguageSchema,
  EnergyServiceTypeSchema,
  TariffPricingModelSchema,
  ProductionUnitTypeSchema,
  ProductionShiftModeSchema,
  MeterProtocolSchema,
  LifecycleStatusSchema,
  AssetLifecycleStatusSchema,
  MeterOperationalStatusSchema,
  TariffLifecycleStatusSchema,
  MainFuelTypeSchema,
  type IndustrySector,
  type CurrencyCode,
  type ReportingCurrencyCode,
  type SubscriptionPlan,
  type FacilityType,
  type IanaTimezone,
  type BuildingUsageType,
  type OperationalStatus,
  type HvacType,
  type CostAllocationMethod,
  type UserLanguage,
  type EnergyServiceType,
  type TariffPricingModel,
  type ProductionUnitType,
  type ProductionShiftMode,
  type MeterProtocol,
  type LifecycleStatus,
  type AssetLifecycleStatus,
  type MeterOperationalStatus,
  type TariffLifecycleStatus,
  type MainFuelType
} from './utils/contracts/shared/graphql-setup-enums';

export {
  OrgConfigDTOSchema,
  parseOrgConfigDTO,
  safeParseOrgConfigDTO,
  type OrgConfigDTO,
  OrganizationDTOSchema,
  parseOrganizationDTO,
  safeParseOrganizationDTO,
  OrganizationDTO,
  type OrganizationDTOInput
} from './utils/contracts/org-config/index';

export {
  AlertRuleDTOSchema,
  parseAlertRuleDTO,
  safeParseAlertRuleDTO,
  AlertRuleDTO,
  generateAlertRuleId,
  AlertRuleEntityTypeSchema,
  AlertRuleDetectionTypeSchema,
  AlertRuleThresholdOperatorSymbolSchema,
  AlertRuleAggregationMethodSchema,
  AlertRulePrioritySchema,
  AlertRuleRuleStatusSchema,
  AlertRuleMonitorScopeSchema,
  AlertRuleNotificationChannelSchema,
  type AlertRuleDTOInput
} from './utils/contracts/alert-rule/index';

export {
  TariffDTOSchema,
  parseTariffDTO,
  safeParseTariffDTO,
  TariffDTO,
  TariffDemandChargeUnitSchema,
  TariffSeasonSchema,
  TariffTierRatePairSchema,
  generateTariffId,
  type TariffDTOInput,
  type TariffDemandChargeUnit,
  type TariffSeason,
  type TariffTierRatePair
} from './utils/contracts/tariff/index';

export {
  ProductionLogDTOSchema,
  parseProductionLogDTO,
  safeParseProductionLogDTO,
  type ProductionLogDTO
} from './utils/contracts/production-log/index';

export {
  EmissionFactorDTOSchema,
  parseEmissionFactorDTO,
  safeParseEmissionFactorDTO,
  EmissionFactorDTO,
  generateEmissionFactorId,
  EmissionFactorActivityTypeSchema,
  EmissionFactorScopeNumberSchema,
  EmissionFactorPhysicalUnitSchema,
  EmissionFactorCalculationMethodSchema,
  EmissionFactorGwpReferenceSchema,
  EmissionFactorCatalogStatusSchema,
  EmissionFactorDataQualityTierSchema,
  type EmissionFactorDTOInput
} from './utils/contracts/emission-factor/index';

export { InvoiceSkSchema, type InvoiceSk } from './utils/validation/schemas/invoice-sk.schema.js';
