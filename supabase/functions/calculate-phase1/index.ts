import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { runPhase1 } from "./phase1-engine.ts"
import {
  Phase1UserInputs,
  Phase1SuccessOutput,
  Phase1BlockedOutput,
  EvaluationIntent,
} from "./phase1-types.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const body = await req.json()
    const {
      engine_id,
      evaluation_intent,
      advanced_toggle,
      target_fh,
      fh_per_cycle,
      engine_status,
      qec_status,
      utilization_profile,
      monthly_utilization,
      safety_buffer,
      harsh_environment,
    } = body

    if (!engine_id) throw new Error("Missing engine_id")
    if (!evaluation_intent) throw new Error("Missing evaluation_intent")
    if (!advanced_toggle) throw new Error("Missing advanced_toggle")

    const VALID_INTENTS: EvaluationIntent[] = [
      "Financing",
      "Purchase / Sale",
      "Lease Placement",
      "Distressed / Downside Case",
    ]
    if (!VALID_INTENTS.includes(evaluation_intent)) {
      throw new Error(`Invalid evaluation_intent. Must be one of: ${VALID_INTENTS.join(', ')}`)
    }
    if (advanced_toggle !== "ON" && advanced_toggle !== "OFF") {
      throw new Error("advanced_toggle must be 'ON' or 'OFF'")
    }

    console.log(`Phase 1 calculation starting: engine=${engine_id}, intent=${evaluation_intent}, toggle=${advanced_toggle}`)

    // ---- FETCH DATA ----

    const { data: techData, error: techError } = await supabaseAdmin
      .from('engine_technical_data')
      .select('*')
      .eq('engine_id', engine_id)
      .single()

    if (techError || !techData) throw new Error("No technical data found for this engine")

    const { data: llps, error: llpError } = await supabaseAdmin
      .from('engine_llps')
      .select('*')
      .eq('engine_id', engine_id)

    if (llpError) throw new Error("Failed to fetch LLP data")

    // ---- RUN PHASE 1 ENGINE ----

    const inputs: Phase1UserInputs = {
      engine_id,
      evaluation_intent,
      advanced_toggle,
      ...(advanced_toggle === "ON" && {
        target_fh,
        fh_per_cycle,
        engine_status,
        qec_status,
        utilization_profile,
        monthly_utilization,
        safety_buffer,
        harsh_environment: harsh_environment ?? false,
      }),
    }

    const result = runPhase1(inputs, techData, llps ?? [])

    // ---- SAVE RESULTS ----

    if (result.blocked) {
      const blocked = result as Phase1BlockedOutput

      // Save what was computed — blocked evaluations still produce partial data
      await supabaseAdmin.from('engine_green_time').upsert({
        engine_id,
        gt_disk:            blocked.gt_disk ?? null,
        gt_base:            blocked.gt_base ?? null,
        binding_constraint: blocked.binding_constraint ?? null,
        baseline_type:      blocked.baseline_type ?? null,
        baseline_cycles:    blocked.baseline_cycles ?? null,
        phase1_disclosures: blocked.disclosures,
        phase1_audit_records: {
          blocked: true,
          block_reason: blocked.block_reason,
          trigger_step: blocked.trigger_step,
          required_to_proceed: blocked.required_to_proceed,
          ...blocked.audit_records,
        },
      }, { onConflict: 'engine_id' })

      if (blocked.audit_records?.llp_limiter_record) {
        const { error: limError } = await supabaseAdmin.from('engine_limiters').upsert({
          engine_id,
          llp_remaining_pct: blocked.audit_records.llp_limiter_record.remaining_pct ?? null,
        }, { onConflict: 'engine_id' })
        if (limError) console.error("engine_limiters save error (blocked):", limError)
      }

      if (blocked.confidence_band) {
        const { error: valError } = await supabaseAdmin.from('engine_valuations').upsert({
          engine_id,
          confidence_band: blocked.confidence_band,
        }, { onConflict: 'engine_id' })
        if (valError) console.error("engine_valuations save error (blocked):", valError)
      }

      console.log(`Phase 1 BLOCKED: ${blocked.block_reason} | GT_LLP=${blocked.gt_llp ?? 'n/a'}, confidence=${blocked.confidence_band ?? 'n/a'}`)

      // Return HTTP 200 — blocked is a flag, not a transport error
      return new Response(JSON.stringify({
        success: true,
        blocked: true,
        engine_id,
        block_reason:       blocked.block_reason,
        trigger_step:       blocked.trigger_step,
        required_to_proceed: blocked.required_to_proceed,
        baseline_type:      blocked.baseline_type ?? null,
        baseline_cycles:    blocked.baseline_cycles ?? null,
        gt_disk:            blocked.gt_disk ?? null,
        gt_llp:             blocked.gt_llp ?? null,
        gt_base:            blocked.gt_base ?? null,
        binding_constraint: blocked.binding_constraint ?? null,
        limiting_llp:       blocked.limiting_llp ?? null,
        limiting_module:    blocked.limiting_module ?? null,
        confidence_band:    blocked.confidence_band ?? null,
        disclosures:        blocked.disclosures,
        audit_records:      blocked.audit_records,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const success = result as Phase1SuccessOutput

    // Save to engine_green_time (Phase 1 fields)
    const { error: gtError } = await supabaseAdmin.from('engine_green_time').upsert({
      engine_id,
      gt_disk:            success.gt_disk,
      gt_base:            success.gt_base,
      binding_constraint: success.binding_constraint,
      baseline_type:      success.baseline_type,
      baseline_cycles:    success.baseline_cycles,
      phase1_disclosures:    success.disclosures,
      phase1_audit_records:  success.audit_records,
    }, { onConflict: 'engine_id' })

    if (gtError) console.error("engine_green_time save error:", gtError)

    // Save to engine_limiters (LLP proximity %)
    const { error: limError } = await supabaseAdmin.from('engine_limiters').upsert({
      engine_id,
      llp_remaining_pct: success.audit_records.llp_limiter_record?.remaining_pct ?? null,
    }, { onConflict: 'engine_id' })

    if (limError) console.error("engine_limiters save error:", limError)

    // Save to engine_valuations (confidence band)
    const { error: valError } = await supabaseAdmin.from('engine_valuations').upsert({
      engine_id,
      confidence_band: success.confidence_band,
    }, { onConflict: 'engine_id' })

    if (valError) console.error("engine_valuations save error:", valError)

    console.log(`Phase 1 complete: GT_BASE=${success.gt_base}, binding=${success.binding_constraint}, confidence=${success.confidence_band}`)

    return new Response(JSON.stringify({
      success: true,
      blocked: false,
      engine_id,
      baseline_type:      success.baseline_type,
      baseline_cycles:    success.baseline_cycles,
      gt_disk:            success.gt_disk,
      gt_llp:             success.gt_llp,
      gt_base:            success.gt_base,
      binding_constraint: success.binding_constraint,
      limiting_llp:       success.limiting_llp,
      limiting_module:    success.limiting_module,
      confidence_band:    success.confidence_band,
      disclosures:        success.disclosures,
      audit_records:      success.audit_records,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error) {
    console.error("Phase 1 error:", error.message)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
