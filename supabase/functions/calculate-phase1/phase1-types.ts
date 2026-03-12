// ============================================================
// PHASE 1 TYPES & DISCLOSURE REGISTRY
// Aircraft Engine Green Time & LLP Evaluation Model
// ============================================================

// ---- ENUMS ----

export type EvaluationIntent =
  | "Financing"
  | "Purchase / Sale"
  | "Lease Placement"
  | "Distressed / Downside Case";

export type AdvancedToggle = "ON" | "OFF";

export type BaselineType = "Explicit" | "Validated" | "Inferred" | "None";

export type BindingConstraint = "DISK" | "LLP";

export type ConfidenceBand = "MEDIUM" | "LOW" | "VERY LOW";

export type DisclosureCode =
  | "D-INF-BASE"
  | "D-VAL-BASE"
  | "D-CONF-BASE"
  | "D-NO-SHOP"
  | "D-SCENARIO"
  | "D-ASSUMP-DEFAULT"
  | "D-AGGR-SCEN"
  | "D-LLP-CAP"
  | "D-LIMIT-PROX"
  | "D-GT-ZERO"
  | "D-LOW-CONF"
  | "D-MODEL-LIM";

// ---- DISCLOSURE REGISTRY (Fixed language — non-negotiable) ----

export interface DisclosureEntry {
  code: DisclosureCode;
  language: string;
  mandatory: boolean;
}

export const DISCLOSURE_REGISTRY: Record<DisclosureCode, DisclosureEntry> = {
  "D-INF-BASE": {
    code: "D-INF-BASE",
    language:
      "The post-shop baseline used in this evaluation has been inferred from consistent LLP 'Cycles Used' values due to the absence of an explicit since-shop counter. This inferred baseline does not confirm the scope of maintenance performed and is subject to confirmation with additional documentation.",
    mandatory: false,
  },
  "D-VAL-BASE": {
    code: "D-VAL-BASE",
    language:
      "A quantified since-shop counter has been used; however, the scope of the associated maintenance event could not be fully validated. Results should be interpreted conservatively until supporting documentation is provided.",
    mandatory: false,
  },
  "D-CONF-BASE": {
    code: "D-CONF-BASE",
    language:
      "Conflicting since-shop counters were identified in the documentation provided. A defensible post-shop baseline could not be established, and the evaluation has been limited accordingly. This is a hard-stop condition.",
    mandatory: false,
  },
  "D-NO-SHOP": {
    code: "D-NO-SHOP",
    language:
      "No qualifying Performance Restoration or Heavy Shop Visit could be confirmed based on the documents provided. Green Time has therefore been evaluated conservatively.",
    mandatory: false,
  },
  "D-SCENARIO": {
    code: "D-SCENARIO",
    language:
      "Green Time results are scenario-based and depend on the operating assumptions selected for this evaluation.",
    mandatory: false,
  },
  "D-ASSUMP-DEFAULT": {
    code: "D-ASSUMP-DEFAULT",
    language:
      "Default operating assumptions have been applied in this evaluation based on the selected evaluation intent. Results reflect standardized, conservative planning parameters rather than user-defined inputs.",
    mandatory: false,
  },
  "D-AGGR-SCEN": {
    code: "D-AGGR-SCEN",
    language:
      "Certain operating assumptions selected for this evaluation are more aggressive than conservative or market-standard norms, which may increase outcome sensitivity.",
    mandatory: false,
  },
  "D-LLP-CAP": {
    code: "D-LLP-CAP",
    language:
      "Green Time has been capped by the remaining life of the limiting LLP, which represents a hard-life constraint.",
    mandatory: false,
  },
  "D-LIMIT-PROX": {
    code: "D-LIMIT-PROX",
    language:
      "Certain LLPs are approaching certified life limits, which may constrain future operation and marketability.",
    mandatory: false,
  },
  "D-GT-ZERO": {
    code: "D-GT-ZERO",
    language:
      "Green Time has been calculated as zero because the engine has already accumulated more cycles since the established baseline than the planning runway assumed in this evaluation.",
    mandatory: false,
  },
  "D-LOW-CONF": {
    code: "D-LOW-CONF",
    language:
      "This evaluation carries a low confidence level due to limited documentation and reliance on inferred assumptions.",
    mandatory: false,
  },
  "D-MODEL-LIM": {
    code: "D-MODEL-LIM",
    language:
      "This evaluation is not a certification of airworthiness and does not replace OEM maintenance planning documents or regulatory requirements.",
    mandatory: true,
  },
};

// ---- INPUT TYPES ----

export interface Phase1UserInputs {
  engine_id: string;
  evaluation_intent: EvaluationIntent;
  advanced_toggle: AdvancedToggle;
  // Advanced options (only used when advanced_toggle = "ON")
  target_fh?: number;
  fh_per_cycle?: number;
  engine_status?: "Serviceable" | "Unserviceable";
  qec_status?: "Full QEC" | "Neutral / Unknown";
  utilization_profile?: "Short-haul / High-cycle" | "Typical mixed operation" | "Longer sector / Low-cycle";
  monthly_utilization?: "Low" | "Medium" | "High";
  safety_buffer?: "Conservative (15%)" | "Market standard (10%)" | "Aggressive (5%)";
  harsh_environment?: boolean;
}

export interface LlpRow {
  part_id?: string;
  part_name: string;
  module?: string;
  group_name?: string;
  limit_cycles: number | null;      // DB column (was: life_limit)
  cycles_since_new: number | null;  // DB column (was: cycles_used)
  remaining_cycles: number | null;
}

export interface TechData {
  csn?: number | null;           // Cycles Since New
  cspr?: number | null;          // Cycles Since Performance Restoration (Explicit)
  tspr?: number | null;          // Time Since Performance Restoration (Explicit)
  cso?: number | null;           // Cycles Since Overhaul (Validated)
  tso?: number | null;           // Time Since Overhaul (Validated)
  cslv?: number | null;          // Cycles Since Last Visit (Validated)
  ecslv?: number | null;         // Engine Cycles Since Last Visit (Validated)
  tslv?: number | null;          // Time Since Last Visit (Validated)
  etslv?: number | null;         // Engine Time Since Last Visit (Validated)
  cycles_since_shop?: number | null; // Generic (Validated)
  [key: string]: unknown;
}

// ---- INTERNAL RECORD TYPES (Audit Trace) ----

export interface BaselineRecord {
  baseline_type: BaselineType;
  counter_used: string | null;
  cycles_since_shop: number | null;
  acceptance_reason: string;
  confidence_impact: number;
}

export interface DiskScenarioRunwayRecord {
  evaluation_intent: EvaluationIntent;
  advanced_toggle: AdvancedToggle;
  target_fh: number;
  fh_per_cycle: number;
  target_cycles: number;
  cycles_since_shop: number | null;
  gt_disk: number;
}

export interface LlpLimiterRecord {
  limiting_part_id: string;
  limiting_module: string;
  life_limit: number;
  remaining_cycles: number;
  remaining_pct: number;
  gt_llp: number;
}

export interface ConstraintEntry {
  constraint_type: "DISK" | "LLP";
  constraint_value: number;
  active: boolean;
  source: string;
}

export interface DisclosureRecord {
  code: DisclosureCode;
  trigger_step: string;
  language: string;
  mandatory: boolean;
}

export interface ConfidenceRecord {
  base_score: number;
  adjustments: Array<{ reason: string; delta: number }>;
  final_score: number;
  confidence_band: ConfidenceBand;
}

export interface BlockRecord {
  blocked: true;
  reason: string;
  trigger_step: string;
  required_to_proceed: string;
}

export interface AuditRecords {
  baseline_record: BaselineRecord;
  disk_scenario_runway_record?: DiskScenarioRunwayRecord;
  llp_limiter_record?: LlpLimiterRecord;
  constraint_stack: ConstraintEntry[];
  disclosure_record_list: DisclosureRecord[];
  confidence_record?: ConfidenceRecord;
  block_record?: BlockRecord;
}

// ---- OUTPUT TYPES ----

export interface Phase1BlockedOutput {
  engine_id: string;
  blocked: true;
  block_reason: string;
  trigger_step: string;
  required_to_proceed: string;
  disclosures: DisclosureRecord[];
  audit_records: Partial<AuditRecords>;
  // Computed fields — present when block occurs after Step 1 (LLP data valid)
  baseline_type?: BaselineType;
  baseline_cycles?: number | null;
  gt_disk?: number;
  gt_llp?: number;
  gt_base?: number;
  binding_constraint?: BindingConstraint;
  limiting_llp?: string;
  limiting_module?: string;
  confidence_band?: ConfidenceBand;
}

export interface Phase1SuccessOutput {
  engine_id: string;
  blocked: false;
  baseline_type: BaselineType;
  baseline_cycles: number | null;
  gt_disk: number;
  gt_llp: number;
  gt_base: number;
  binding_constraint: BindingConstraint;
  limiting_llp: string;
  limiting_module: string;
  disclosures: DisclosureRecord[];
  confidence_band: ConfidenceBand;
  audit_records: AuditRecords;
}

export type Phase1Output = Phase1SuccessOutput | Phase1BlockedOutput;

// ---- SCENARIO DEFAULTS ----

export const DEFAULT_SCENARIOS: Record<EvaluationIntent, { target_fh: number; fh_per_cycle: number }> = {
  "Financing": { target_fh: 12000, fh_per_cycle: 1.8 },
  "Purchase / Sale": { target_fh: 15000, fh_per_cycle: 1.8 },
  "Lease Placement": { target_fh: 18000, fh_per_cycle: 1.8 },
  "Distressed / Downside Case": { target_fh: 12000, fh_per_cycle: 1.6 },
};

export const GOVERNANCE_BOUNDS = {
  target_fh: { min: 12000, max: 22000 },
  fh_per_cycle: { min: 1.4, max: 2.4 },
};

// LLP remaining % threshold below which D-LIMIT-PROX triggers
export const LLP_PROXIMITY_THRESHOLD_PCT = 15;
