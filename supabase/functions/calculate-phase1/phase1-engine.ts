// ============================================================
// PHASE 1 EVALUATION ENGINE
// Aircraft Engine Green Time & LLP Evaluation Model
// Phase 1: Disk Sheet Core Evaluation Engine
// ============================================================

import {
  Phase1UserInputs,
  Phase1Output,
  Phase1SuccessOutput,
  Phase1BlockedOutput,
  LlpRow,
  TechData,
  BaselineRecord,
  BaselineType,
  DiskScenarioRunwayRecord,
  LlpLimiterRecord,
  ConstraintEntry,
  DisclosureRecord,
  DisclosureCode,
  ConfidenceRecord,
  ConfidenceBand,
  AuditRecords,
  BlockRecord,
  DISCLOSURE_REGISTRY,
  DEFAULT_SCENARIOS,
  GOVERNANCE_BOUNDS,
  LLP_PROXIMITY_THRESHOLD_PCT,
} from "./phase1-types.ts";

// ============================================================
// DISCLOSURE HELPER
// ============================================================

function makeDisclosureRecord(code: DisclosureCode, step: string): DisclosureRecord {
  const entry = DISCLOSURE_REGISTRY[code];
  return {
    code,
    trigger_step: step,
    language: entry.language,
    mandatory: entry.mandatory,
  };
}

// ============================================================
// STEP 1 — DISK SHEET VALIDATION
// ============================================================

interface ValidationResult {
  valid: boolean;
  block?: BlockRecord;
}

function validateDiskSheet(techData: TechData, llps: LlpRow[]): ValidationResult {
  if (techData.csn === null || techData.csn === undefined) {
    return {
      valid: false,
      block: {
        blocked: true,
        reason: "CSN (Cycles Since New) is missing from the disk sheet.",
        trigger_step: "Step 1A — Required Fields",
        required_to_proceed: "Provide a valid CSN value on the disk sheet.",
      },
    };
  }

  if (!llps || llps.length === 0) {
    return {
      valid: false,
      block: {
        blocked: true,
        reason: "LLP table is missing or contains no rows.",
        trigger_step: "Step 1A — Required Fields",
        required_to_proceed: "Provide a complete LLP status sheet with at least one LLP row.",
      },
    };
  }

  for (const llp of llps) {
    if (llp.limit_cycles === null || llp.limit_cycles === undefined) {
      return {
        valid: false,
        block: {
          blocked: true,
          reason: `LLP row "${llp.part_name}" is missing a Life Limit value.`,
          trigger_step: "Step 1B — Hard Stop Validation",
          required_to_proceed: "Provide the certified life limit for all LLP rows.",
        },
      };
    }

    if (llp.cycles_since_new === null || llp.cycles_since_new === undefined) {
      return {
        valid: false,
        block: {
          blocked: true,
          reason: `LLP row "${llp.part_name}" is missing Cycles Used.`,
          trigger_step: "Step 1B — Hard Stop Validation",
          required_to_proceed: "Provide cycles used for all LLP rows.",
        },
      };
    }

    if (llp.remaining_cycles !== null && llp.remaining_cycles !== undefined && llp.remaining_cycles < 0) {
      return {
        valid: false,
        block: {
          blocked: true,
          reason: `LLP row "${llp.part_name}" has negative remaining cycles (${llp.remaining_cycles}). Disk sheet is internally contradictory.`,
          trigger_step: "Step 1B — Hard Stop Validation",
          required_to_proceed: "Correct the LLP cycles data. Remaining cycles cannot be negative.",
        },
      };
    }

    if (llp.cycles_since_new > llp.limit_cycles) {
      return {
        valid: false,
        block: {
          blocked: true,
          reason: `LLP row "${llp.part_name}" shows Cycles Used (${llp.cycles_since_new}) exceeding Life Limit (${llp.limit_cycles}). Disk sheet is internally contradictory.`,
          trigger_step: "Step 1B — Hard Stop Validation",
          required_to_proceed: "Correct the LLP data. Cycles Used cannot exceed the certified Life Limit.",
        },
      };
    }
  }

  return { valid: true };
}

// ============================================================
// STEP 2 — BASELINE DETERMINATION ENGINE
// ============================================================

interface BaselineResult {
  baseline_type: BaselineType;
  cycles_since_shop: number | null;
  counter_used: string | null;
  acceptance_reason: string;
  confidence_impact: number;
  disclosures: DisclosureRecord[];
  blocked?: BlockRecord;
}

// Tolerance: validated counter is accepted if most LLP cycles_used values
// are within this percentage of the counter value.
const BASELINE_VALIDATION_TOLERANCE = 0.05; // 5%
const BASELINE_VALIDATION_MIN_MATCH_RATIO = 0.6; // 60% of LLPs must agree

function llpCyclesUsedMedian(llps: LlpRow[]): number | null {
  const values = llps
    .map((l) => l.cycles_since_new)
    .filter((v): v is number => v !== null && v !== undefined);
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 !== 0 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

function isConsistentWithCounter(llps: LlpRow[], counter: number): boolean {
  const valid = llps.filter((l) => l.cycles_since_new !== null && l.cycles_since_new !== undefined);
  if (valid.length === 0) return false;
  const matching = valid.filter((l) => {
    const diff = Math.abs((l.cycles_since_new as number) - counter);
    return diff / counter <= BASELINE_VALIDATION_TOLERANCE;
  });
  return matching.length / valid.length >= BASELINE_VALIDATION_MIN_MATCH_RATIO;
}

function isLlpPatternConsistent(llps: LlpRow[]): { consistent: boolean; inferred_value: number | null } {
  const values = llps
    .map((l) => l.cycles_since_new)
    .filter((v): v is number => v !== null && v !== undefined);
  if (values.length === 0) return { consistent: false, inferred_value: null };

  const median = llpCyclesUsedMedian(llps) as number;
  const matching = values.filter((v) => {
    const diff = Math.abs(v - median);
    return diff / median <= BASELINE_VALIDATION_TOLERANCE;
  });

  const ratio = matching.length / values.length;
  return {
    consistent: ratio >= BASELINE_VALIDATION_MIN_MATCH_RATIO,
    inferred_value: ratio >= BASELINE_VALIDATION_MIN_MATCH_RATIO ? Math.round(median) : null,
  };
}

function determineBaseline(techData: TechData, llps: LlpRow[]): BaselineResult {
  const disclosures: DisclosureRecord[] = [];

  // --- 2.2 Explicit Baseline ---
  const explicitCounters: Array<{ name: string; value: number }> = [];
  if (techData.cspr !== null && techData.cspr !== undefined) {
    explicitCounters.push({ name: "CSPR", value: techData.cspr });
  }
  if (techData.tspr !== null && techData.tspr !== undefined) {
    explicitCounters.push({ name: "TSPR", value: techData.tspr });
  }
  if (techData.cslv !== null && techData.cslv !== undefined) {
    explicitCounters.push({ name: "CSLV", value: techData.cslv });
  }

  if (explicitCounters.length === 1) {
    const counter = explicitCounters[0];
    return {
      baseline_type: "Explicit",
      cycles_since_shop: counter.value,
      counter_used: counter.name,
      acceptance_reason: `${counter.name} present — used directly as explicit baseline.`,
      confidence_impact: 1.0,
      disclosures,
    };
  }

  if (explicitCounters.length > 1) {
    const [a, b] = explicitCounters;
    const diff = Math.abs(a.value - b.value);
    const pct = diff / Math.max(a.value, b.value);
    if (pct > 0.05) {
      // Materially conflicting explicit counters → HARD STOP
      disclosures.push(makeDisclosureRecord("D-CONF-BASE", "Step 2.2 — Explicit Baseline Conflict"));
      return {
        baseline_type: "None",
        cycles_since_shop: null,
        counter_used: null,
        acceptance_reason: `Explicit counters ${a.name}=${a.value} and ${b.name}=${b.value} materially disagree (${(pct * 100).toFixed(1)}% gap). Hard stop.`,
        confidence_impact: -1.0,
        disclosures,
        blocked: {
          blocked: true,
          reason: `Conflicting explicit since-shop counters: ${a.name}=${a.value} vs ${b.name}=${b.value}.`,
          trigger_step: "Step 2.2 — Explicit Baseline Conflict",
          required_to_proceed: "Resolve the discrepancy between explicit since-shop counters with supporting documentation.",
        },
      };
    }
    // Agree within tolerance — use first (CSPR preferred)
    const counter = explicitCounters[0];
    return {
      baseline_type: "Explicit",
      cycles_since_shop: counter.value,
      counter_used: counter.name,
      acceptance_reason: `Multiple explicit counters present but agree within tolerance. Used ${counter.name}.`,
      confidence_impact: 1.0,
      disclosures,
    };
  }

  // --- 2.3 Validated Baseline ---
  const validatedCandidates: Array<{ name: string; value: number }> = [
    { name: "CSO", value: techData.cso as number },
    { name: "TSO", value: techData.tso as number },
    { name: "ECSLV", value: techData.ecslv as number },
    { name: "TSLV", value: techData.tslv as number },
    { name: "ETSLV", value: techData.etslv as number },
    { name: "cycles_since_shop", value: techData.cycles_since_shop as number },
  ].filter((c) => c.value !== null && c.value !== undefined && !isNaN(c.value));

  if (validatedCandidates.length > 0) {
    // Use the first available validated counter and check against LLP pattern
    const candidate = validatedCandidates[0];
    const consistent = isConsistentWithCounter(llps, candidate.value);

    if (consistent) {
      disclosures.push(makeDisclosureRecord("D-VAL-BASE", "Step 2.3 — Validated Baseline"));
      return {
        baseline_type: "Validated",
        cycles_since_shop: candidate.value,
        counter_used: candidate.name,
        acceptance_reason: `${candidate.name}=${candidate.value} validated against LLP cycles used pattern (≥60% of LLPs within 5% tolerance).`,
        confidence_impact: 0.5,
        disclosures,
      };
    } else {
      // Counter exists but contradicts LLP pattern → HARD STOP
      disclosures.push(makeDisclosureRecord("D-CONF-BASE", "Step 2.3 — Validated Baseline Conflict"));
      return {
        baseline_type: "None",
        cycles_since_shop: null,
        counter_used: null,
        acceptance_reason: `${candidate.name}=${candidate.value} is inconsistent with LLP cycles used pattern. Cannot establish baseline.`,
        confidence_impact: -1.0,
        disclosures,
        blocked: {
          blocked: true,
          reason: `Since-shop counter ${candidate.name}=${candidate.value} contradicts LLP cycles used reset pattern.`,
          trigger_step: "Step 2.3 — Validated Baseline Conflict",
          required_to_proceed: "Provide documentation confirming the shop event scope and LLP part number/cycle traceability.",
        },
      };
    }
  }

  // --- 2.4 Inferred Baseline ---
  const { consistent, inferred_value } = isLlpPatternConsistent(llps);

  if (consistent && inferred_value !== null) {
    disclosures.push(makeDisclosureRecord("D-INF-BASE", "Step 2.4 — Inferred Baseline"));
    return {
      baseline_type: "Inferred",
      cycles_since_shop: inferred_value,
      counter_used: null,
      acceptance_reason: `No explicit or validated counter present. LLP cycles used pattern is consistent (median ≈ ${inferred_value}). Baseline inferred.`,
      confidence_impact: 0.0,
      disclosures,
    };
  }

  // --- No baseline ---
  disclosures.push(makeDisclosureRecord("D-NO-SHOP", "Step 2.4 — No Baseline Established"));
  return {
    baseline_type: "None",
    cycles_since_shop: null,
    counter_used: null,
    acceptance_reason: "No explicit, validated, or inferred baseline could be established. LLP pattern is inconsistent.",
    confidence_impact: -1.0,
    disclosures,
  };
}

// ============================================================
// STEP 3–4 — SCENARIO RESOLUTION + FH → CYCLES CONVERSION
// ============================================================

interface ScenarioResult {
  target_fh: number;
  fh_per_cycle: number;
  target_cycles: number;
  disclosures: DisclosureRecord[];
  aggressive: boolean;
}

function resolveScenario(inputs: Phase1UserInputs): ScenarioResult {
  const disclosures: DisclosureRecord[] = [];
  let target_fh: number;
  let fh_per_cycle: number;
  let aggressive = false;

  if (inputs.advanced_toggle === "OFF") {
    const defaults = DEFAULT_SCENARIOS[inputs.evaluation_intent];
    target_fh = defaults.target_fh;
    fh_per_cycle = defaults.fh_per_cycle;
    disclosures.push(makeDisclosureRecord("D-ASSUMP-DEFAULT", "Step 3 — Default Scenario Applied"));
  } else {
    target_fh = inputs.target_fh ?? DEFAULT_SCENARIOS[inputs.evaluation_intent].target_fh;
    fh_per_cycle = inputs.fh_per_cycle ?? DEFAULT_SCENARIOS[inputs.evaluation_intent].fh_per_cycle;

    if (
      target_fh > GOVERNANCE_BOUNDS.target_fh.max ||
      target_fh < GOVERNANCE_BOUNDS.target_fh.min ||
      fh_per_cycle > GOVERNANCE_BOUNDS.fh_per_cycle.max ||
      fh_per_cycle < GOVERNANCE_BOUNDS.fh_per_cycle.min
    ) {
      aggressive = true;
      disclosures.push(makeDisclosureRecord("D-AGGR-SCEN", "Step 3 — Aggressive Assumptions Detected"));
    }
  }

  disclosures.push(makeDisclosureRecord("D-SCENARIO", "Step 3 — Scenario-Based Result"));

  const target_cycles = Math.floor(target_fh / fh_per_cycle);

  return { target_fh, fh_per_cycle, target_cycles, disclosures, aggressive };
}

// ============================================================
// STEP 5 — GT_DISK CALCULATION
// ============================================================

interface GtDiskResult {
  gt_disk: number;
  disclosures: DisclosureRecord[];
}

function calcGtDisk(target_cycles: number, cycles_since_shop: number | null): GtDiskResult {
  const disclosures: DisclosureRecord[] = [];

  if (cycles_since_shop === null) {
    // No baseline — GT_DISK cannot be meaningfully computed; return 0 conservatively
    disclosures.push(makeDisclosureRecord("D-GT-ZERO", "Step 5 — GT_DISK Cannot Be Determined"));
    return { gt_disk: 0, disclosures };
  }

  const raw = target_cycles - cycles_since_shop;
  if (raw <= 0) {
    disclosures.push(makeDisclosureRecord("D-GT-ZERO", "Step 5 — GT_DISK Negative, Floored to Zero"));
    return { gt_disk: 0, disclosures };
  }

  return { gt_disk: raw, disclosures };
}

// ============================================================
// STEP 6 — GT_LLP CALCULATION
// ============================================================

interface GtLlpResult {
  gt_llp: number;
  limiting_part: string;
  limiting_module: string;
  life_limit: number;
  remaining_pct: number;
  disclosures: DisclosureRecord[];
}

function calcGtLlp(llps: LlpRow[]): GtLlpResult {
  const disclosures: DisclosureRecord[] = [];

  const valid = llps.filter(
    (l) =>
      l.remaining_cycles !== null &&
      l.remaining_cycles !== undefined &&
      l.limit_cycles !== null &&
      l.limit_cycles !== undefined &&
      l.limit_cycles > 0
  );

  if (valid.length === 0) {
    // No valid LLP data — return very conservative 0
    return {
      gt_llp: 0,
      limiting_part: "No Data",
      limiting_module: "Unknown",
      life_limit: 0,
      remaining_pct: 0,
      disclosures,
    };
  }

  valid.sort((a, b) => (a.remaining_cycles as number) - (b.remaining_cycles as number));
  const limiter = valid[0];

  const remaining = limiter.remaining_cycles as number;
  const lifeLimit = limiter.limit_cycles as number;
  const remaining_pct = Math.round((remaining / lifeLimit) * 100 * 10) / 10;
  const module = limiter.module || limiter.group_name || "Unknown";

  if (remaining_pct < LLP_PROXIMITY_THRESHOLD_PCT) {
    disclosures.push(makeDisclosureRecord("D-LIMIT-PROX", "Step 6 — LLP Life Limit Proximity"));
  }

  return {
    gt_llp: remaining,
    limiting_part: limiter.part_name || limiter.part_id || "Unknown Part",
    limiting_module: module,
    life_limit: lifeLimit,
    remaining_pct,
    disclosures,
  };
}

// ============================================================
// STEP 7 — GT_BASE (PHASE 1 OUTPUT)
// ============================================================

interface GtBaseResult {
  gt_base: number;
  binding_constraint: "DISK" | "LLP";
  disclosures: DisclosureRecord[];
}

function calcGtBase(gt_disk: number, gt_llp: number): GtBaseResult {
  const disclosures: DisclosureRecord[] = [];

  if (gt_llp < gt_disk) {
    disclosures.push(makeDisclosureRecord("D-LLP-CAP", "Step 7 — LLP Governs GT_BASE"));
    return { gt_base: gt_llp, binding_constraint: "LLP", disclosures };
  }

  return { gt_base: gt_disk, binding_constraint: "DISK", disclosures };
}

// ============================================================
// STEP 9 — CONFIDENCE SCORING
// ============================================================

function calcConfidence(
  baselineType: BaselineType,
  aggressive: boolean
): ConfidenceRecord {
  let base_score = 0;
  const adjustments: Array<{ reason: string; delta: number }> = [];

  switch (baselineType) {
    case "Explicit":
      adjustments.push({ reason: "Explicit baseline present", delta: 1.0 });
      base_score += 1.0;
      break;
    case "Validated":
      adjustments.push({ reason: "Validated baseline used", delta: 0.5 });
      base_score += 0.5;
      break;
    case "Inferred":
      adjustments.push({ reason: "Inferred baseline — no adjustment", delta: 0.0 });
      break;
    case "None":
      adjustments.push({ reason: "No baseline established", delta: -1.0 });
      base_score -= 1.0;
      break;
  }

  if (aggressive) {
    adjustments.push({ reason: "Aggressive scenario assumptions", delta: -0.5 });
    base_score -= 0.5;
  }

  let confidence_band: ConfidenceBand;
  if (base_score >= 1.0) {
    confidence_band = "MEDIUM";
  } else if (base_score >= 0) {
    confidence_band = "LOW";
  } else {
    confidence_band = "VERY LOW";
  }

  return {
    base_score: 0,
    adjustments,
    final_score: base_score,
    confidence_band,
  };
}

// ============================================================
// MAIN PHASE 1 ENGINE
// ============================================================

export function runPhase1(
  inputs: Phase1UserInputs,
  techData: TechData,
  llps: LlpRow[]
): Phase1Output {
  const allDisclosures: DisclosureRecord[] = [];

  // Always include D-MODEL-LIM
  allDisclosures.push(makeDisclosureRecord("D-MODEL-LIM", "Always On"));

  // ---- STEP 1: Disk Sheet Validation ----
  const validation = validateDiskSheet(techData, llps);

  if (!validation.valid && validation.block) {
    allDisclosures.push(makeDisclosureRecord("D-MODEL-LIM", "Always On")); // already added, dedupe below
    const partial: Partial<AuditRecords> = {
      block_record: validation.block,
      disclosure_record_list: dedupeDisclosures(allDisclosures),
    };
    return {
      engine_id: inputs.engine_id,
      blocked: true,
      block_reason: validation.block.reason,
      trigger_step: validation.block.trigger_step,
      required_to_proceed: validation.block.required_to_proceed,
      disclosures: dedupeDisclosures(allDisclosures),
      audit_records: partial,
    } as Phase1BlockedOutput;
  }

  // ---- STEP 2: Baseline Determination ----
  const baselineResult = determineBaseline(techData, llps);
  allDisclosures.push(...baselineResult.disclosures);

  // Track the block but do NOT return early — continue computing all steps
  // so downstream consumers receive the full picture (GT_LLP, confidence, etc.)
  const pendingBlock: BlockRecord | undefined = baselineResult.blocked;

  // ---- STEP 3–4: Scenario Resolution + FH → Cycles ----
  const scenario = resolveScenario(inputs);
  allDisclosures.push(...scenario.disclosures);

  // ---- STEP 5: GT_DISK ----
  const gtDiskResult = calcGtDisk(scenario.target_cycles, baselineResult.cycles_since_shop);
  allDisclosures.push(...gtDiskResult.disclosures);

  // ---- STEP 6: GT_LLP ----
  const gtLlpResult = calcGtLlp(llps);
  allDisclosures.push(...gtLlpResult.disclosures);

  // ---- STEP 7: GT_BASE ----
  const gtBaseResult = calcGtBase(gtDiskResult.gt_disk, gtLlpResult.gt_llp);
  allDisclosures.push(...gtBaseResult.disclosures);

  // ---- STEP 9: Confidence ----
  const confidenceRecord = calcConfidence(baselineResult.baseline_type, scenario.aggressive);
  if (
    confidenceRecord.confidence_band === "LOW" ||
    confidenceRecord.confidence_band === "VERY LOW"
  ) {
    allDisclosures.push(makeDisclosureRecord("D-LOW-CONF", "Step 9 — Confidence Scoring"));
  }

  // ---- STEP 10: Audit Records ----
  const baselineRecord: BaselineRecord = {
    baseline_type: baselineResult.baseline_type,
    counter_used: baselineResult.counter_used,
    cycles_since_shop: baselineResult.cycles_since_shop,
    acceptance_reason: baselineResult.acceptance_reason,
    confidence_impact: baselineResult.confidence_impact,
  };

  const diskScenarioRecord: DiskScenarioRunwayRecord = {
    evaluation_intent: inputs.evaluation_intent,
    advanced_toggle: inputs.advanced_toggle,
    target_fh: scenario.target_fh,
    fh_per_cycle: scenario.fh_per_cycle,
    target_cycles: scenario.target_cycles,
    cycles_since_shop: baselineResult.cycles_since_shop,
    gt_disk: gtDiskResult.gt_disk,
  };

  const llpLimiterRecord: LlpLimiterRecord = {
    limiting_part_id: gtLlpResult.limiting_part,
    limiting_module: gtLlpResult.limiting_module,
    life_limit: gtLlpResult.life_limit,
    remaining_cycles: gtLlpResult.gt_llp,
    remaining_pct: gtLlpResult.remaining_pct,
    gt_llp: gtLlpResult.gt_llp,
  };

  const constraintStack: ConstraintEntry[] = [
    {
      constraint_type: "DISK",
      constraint_value: gtDiskResult.gt_disk,
      active: gtBaseResult.binding_constraint === "DISK",
      source: "Scenario runway (Target_Cycles − Cycles_Since_Shop)",
    },
    {
      constraint_type: "LLP",
      constraint_value: gtLlpResult.gt_llp,
      active: gtBaseResult.binding_constraint === "LLP",
      source: "Disk sheet LLP remaining cycles (minimum across all rows)",
    },
  ];

  const deduped = dedupeDisclosures(allDisclosures);

  const auditRecords: AuditRecords = {
    baseline_record: baselineRecord,
    disk_scenario_runway_record: diskScenarioRecord,
    llp_limiter_record: llpLimiterRecord,
    constraint_stack: constraintStack,
    disclosure_record_list: deduped,
    confidence_record: confidenceRecord,
  };

  // If baseline was blocked, return with blocked=true + all computed data
  if (pendingBlock) {
    return {
      engine_id: inputs.engine_id,
      blocked: true,
      block_reason: pendingBlock.reason,
      trigger_step: pendingBlock.trigger_step,
      required_to_proceed: pendingBlock.required_to_proceed,
      disclosures: deduped,
      audit_records: auditRecords,
      baseline_type: baselineResult.baseline_type,
      baseline_cycles: baselineResult.cycles_since_shop,
      gt_disk: gtDiskResult.gt_disk,
      gt_llp: gtLlpResult.gt_llp,
      gt_base: gtBaseResult.gt_base,
      binding_constraint: gtBaseResult.binding_constraint,
      limiting_llp: gtLlpResult.limiting_part,
      limiting_module: gtLlpResult.limiting_module,
      confidence_band: confidenceRecord.confidence_band,
    } as Phase1BlockedOutput;
  }

  return {
    engine_id: inputs.engine_id,
    blocked: false,
    baseline_type: baselineResult.baseline_type,
    baseline_cycles: baselineResult.cycles_since_shop,
    gt_disk: gtDiskResult.gt_disk,
    gt_llp: gtLlpResult.gt_llp,
    gt_base: gtBaseResult.gt_base,
    binding_constraint: gtBaseResult.binding_constraint,
    limiting_llp: gtLlpResult.limiting_part,
    limiting_module: gtLlpResult.limiting_module,
    disclosures: deduped,
    confidence_band: confidenceRecord.confidence_band,
    audit_records: auditRecords,
  } as Phase1SuccessOutput;
}

// ============================================================
// HELPER — DEDUPLICATE DISCLOSURES (preserve order, first wins)
// ============================================================

function dedupeDisclosures(list: DisclosureRecord[]): DisclosureRecord[] {
  const seen = new Set<DisclosureCode>();
  return list.filter((d) => {
    if (seen.has(d.code)) return false;
    seen.add(d.code);
    return true;
  });
}
