'use client'

import { useEffect, useState } from 'react'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

type EvalIntent = 'Financing' | 'Purchase / Sale' | 'Lease Placement' | 'Distressed / Downside Case'

interface LlpRow {
  id: string
  group_name: string
  part_name: string
  life_limit: string
  cycles_used: string
  remaining_cycles: string
}

interface TechDataForm {
  csn: string
  cspr: string
  tspr: string
  cslv: string
  ecslv: string
  cso: string
  tso: string
  tslv: string
}

interface LlpForm {
  group_name: string
  part_name: string
  life_limit: string
  cycles_used: string
  remaining_cycles: string
}

interface CalcForm {
  evaluation_intent: EvalIntent | ''
  advanced_toggle: 'ON' | 'OFF'
  target_fh: string
  target_fh_custom: string
  fh_per_cycle: string
  fh_per_cycle_custom: string
  engine_status: string
  qec_status: string
  utilization_profile: string
  monthly_utilization: string
  safety_buffer: string
  harsh_environment: boolean
}

const TEAL = '#1e4d5e'

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: '8px',
  border: '1px solid #ddd',
  background: 'white',
  fontSize: '14px',
  color: '#333',
}

function shortId() {
  return Math.random().toString(36).substring(2, 7)
}

export default function Home() {
  const [supabase] = useState<SupabaseClient>(() => createClient(SUPABASE_URL, SUPABASE_ANON_KEY))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loggedIn, setLoggedIn] = useState(false)
  const [jwt, setJwt] = useState('')
  const [engineId, setEngineId] = useState('')
  const [techDataSaved, setTechDataSaved] = useState(false)
  const [llpRows, setLlpRows] = useState<LlpRow[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState('')
  const [error, setError] = useState('')

  const [techForm, setTechForm] = useState<TechDataForm>({
    csn: '', cspr: '', tspr: '', cslv: '', ecslv: '', cso: '', tso: '', tslv: '',
  })

  const [llpForm, setLlpForm] = useState<LlpForm>({
    group_name: '', part_name: '', life_limit: '', cycles_used: '', remaining_cycles: '',
  })

  const [calcForm, setCalcForm] = useState<CalcForm>({
    evaluation_intent: '',
    advanced_toggle: 'OFF',
    target_fh: '',
    target_fh_custom: '',
    fh_per_cycle: '',
    fh_per_cycle_custom: '',
    engine_status: '',
    qec_status: '',
    utilization_profile: '',
    monthly_utilization: '',
    safety_buffer: '',
    harsh_environment: false,
  })

  useEffect(() => {
    let mounted = true

    const restoreSession = async () => {
      const { data, error: err } = await supabase.auth.getSession()
      if (err) {
        if (mounted) setError(err.message)
        return
      }
      if (!mounted) return
      setLoggedIn(!!data.session)
      setJwt(data.session?.access_token ?? '')
    }

    void restoreSession()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setLoggedIn(!!session)
      setJwt(session?.access_token ?? '')
      if (!session) {
        setEngineId('')
        setTechDataSaved(false)
        setLlpRows([])
        setResult(null)
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [supabase])

  // ── AUTH ──────────────────────────────────────────────
  const handleLogin = async () => {
    setError('')
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) { setError(err.message); return }
    setJwt(data.session!.access_token)
    setLoggedIn(true)
  }

  const handleLogout = async () => {
    setError('')
    const { error: err } = await supabase.auth.signOut()
    if (err) { setError(err.message); return }
    setPassword('')
  }

  // ── CREATE ENGINE ─────────────────────────────────────
  const handleCreateEngine = async () => {
    setLoading('engine')
    setError('')
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-engine`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwt}`,
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!data.engine_id) throw new Error(data.error || 'Failed to create engine')
      setEngineId(data.engine_id)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading('')
    }
  }

  // ── SAVE TECH DATA ────────────────────────────────────
  const handleSaveTechData = async () => {
    if (!techForm.csn) { setError('CSN is required'); return }
    setLoading('tech')
    setError('')
    try {
      const payload: Record<string, unknown> = { engine_id: engineId, csn: parseInt(techForm.csn) }
      const optionals: (keyof TechDataForm)[] = ['cspr', 'tspr', 'cslv', 'ecslv', 'cso', 'tso', 'tslv']
      for (const key of optionals) {
        if (techForm[key]) payload[key] = parseInt(techForm[key])
      }
      const { error: err } = await supabase!
        .from('engine_technical_data')
        .upsert(payload, { onConflict: 'engine_id' })
      if (err) throw new Error(err.message)
      setTechDataSaved(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading('')
    }
  }

  // ── ADD LLP ROW ───────────────────────────────────────
  const handleAddLlp = async () => {
    if (!llpForm.part_name || !llpForm.life_limit || !llpForm.cycles_used || !llpForm.remaining_cycles) {
      setError('Part Name, Life Limit, Cycles Used, and Remaining Cycles are required')
      return
    }
    setLoading('llp')
    setError('')
    try {
      const id = shortId()
      const { error: err } = await supabase!.from('engine_llps').insert({
        engine_id: engineId,
        part_name: llpForm.part_name,
        group_name: llpForm.group_name || null,
        limit_cycles: parseInt(llpForm.life_limit),
        cycles_since_new: parseInt(llpForm.cycles_used),
        remaining_cycles: parseInt(llpForm.remaining_cycles),
      })
      if (err) throw new Error(err.message)
      setLlpRows(prev => [...prev, { id, ...llpForm }])
      setLlpForm({ group_name: '', part_name: '', life_limit: '', cycles_used: '', remaining_cycles: '' })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading('')
    }
  }

  // ── RUN CALCULATION ───────────────────────────────────
  const handleRunCalc = async () => {
    if (!calcForm.evaluation_intent) { setError('Evaluation Intent is required'); return }
    setLoading('calc')
    setError('')
    setResult(null)
    try {
      const body: Record<string, unknown> = {
        engine_id: engineId,
        evaluation_intent: calcForm.evaluation_intent,
        advanced_toggle: calcForm.advanced_toggle,
      }
      if (calcForm.advanced_toggle === 'ON') {
        const tfh = calcForm.target_fh === 'Custom'
          ? parseFloat(calcForm.target_fh_custom)
          : parseFloat(calcForm.target_fh)
        const fpc = calcForm.fh_per_cycle === 'Custom'
          ? parseFloat(calcForm.fh_per_cycle_custom)
          : parseFloat(calcForm.fh_per_cycle)
        if (!isNaN(tfh) && tfh > 0) body.target_fh = tfh
        if (!isNaN(fpc) && fpc > 0) body.fh_per_cycle = fpc
        if (calcForm.engine_status) body.engine_status = calcForm.engine_status
        if (calcForm.qec_status) body.qec_status = calcForm.qec_status
        if (calcForm.utilization_profile) body.utilization_profile = calcForm.utilization_profile
        if (calcForm.monthly_utilization) body.monthly_utilization = calcForm.monthly_utilization
        if (calcForm.safety_buffer) body.safety_buffer = calcForm.safety_buffer
        body.harsh_environment = calcForm.harsh_environment
      }
      const res = await fetch(`${SUPABASE_URL}/functions/v1/calculate-phase1`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${jwt}`,
        },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      setResult(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading('')
    }
  }

  // ── RENDER ────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#f0f2f5', fontFamily: 'Arial, Helvetica, sans-serif', padding: '28px 20px' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', gap: '12px' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: TEAL, letterSpacing: '-0.3px' }}>
            AGAM — Phase 1 Test Harness
          </h1>
          {loggedIn && (
            <Btn onClick={handleLogout} style={{ padding: '6px 12px', fontSize: '12px', borderRadius: '6px' }}>
              Logout
            </Btn>
          )}
        </div>

        {error && (
          <div style={{ background: '#fff0f0', border: '1px solid #ffb3b3', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px', color: '#cc0000', fontSize: '14px' }}>
            {error}
          </div>
        )}

        {/* ── LOGIN ── */}
        {!loggedIn && (
          <Card title="Login">
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Field label="Email">
                <input
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLogin()}
                  placeholder="email@example.com"
                  type="email"
                  style={inputStyle}
                />
              </Field>
              <Field label="Password">
                <input
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLogin()}
                  placeholder="password"
                  type="password"
                  style={inputStyle}
                />
              </Field>
              <Btn onClick={handleLogin}>Sign In</Btn>
            </div>
          </Card>
        )}

        {loggedIn && (
          <>
            {/* ── STEP 1: CREATE ENGINE + TECH DATA ── */}
            <Card title="Step 1 — Create Engine & Technical Data">
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px' }}>
                <Btn onClick={handleCreateEngine} disabled={!!engineId || loading === 'engine'}>
                  {loading === 'engine' ? 'Creating...' : 'Create Engine'}
                </Btn>
                {engineId && (
                  <input
                    readOnly
                    value={engineId}
                    style={{ flex: 1, padding: '8px 12px', borderRadius: '8px', border: '1px solid #ddd', background: '#f9f9f9', fontSize: '13px', color: '#555', fontFamily: 'monospace' }}
                  />
                )}
              </div>

              {engineId && !techDataSaved && (
                <>
                  <div style={{ marginBottom: '12px' }}>
                    <Field label="CSN *">
                      <input
                        value={techForm.csn}
                        onChange={e => setTechForm(f => ({ ...f, csn: e.target.value }))}
                        placeholder="Cycles Since New"
                        type="number"
                        style={{ ...inputStyle, width: '200px' }}
                      />
                    </Field>
                  </div>
                  <p style={{ fontSize: '12px', color: '#999', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
                    Optionals:
                  </p>
                  <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '16px' }}>
                    {(['cspr', 'tspr', 'cslv', 'ecslv', 'cso', 'tso', 'tslv'] as const).map(key => (
                      <Field key={key} label={key.toUpperCase()}>
                        <input
                          value={techForm[key]}
                          onChange={e => setTechForm(f => ({ ...f, [key]: e.target.value }))}
                          placeholder={key.toUpperCase()}
                          type="number"
                          style={{ ...inputStyle, width: '110px' }}
                        />
                      </Field>
                    ))}
                  </div>
                  <Btn onClick={handleSaveTechData} disabled={loading === 'tech'}>
                    {loading === 'tech' ? 'Saving...' : 'Add Technical Data'}
                  </Btn>
                </>
              )}

              {techDataSaved && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#2a7a2a', fontSize: '14px', fontWeight: 600 }}>
                  <span style={{ fontSize: '18px' }}>✓</span> Technical Data saved (CSN: {techForm.csn}
                  {techForm.cspr && `, CSPR: ${techForm.cspr}`}
                  {techForm.cso && `, CSO: ${techForm.cso}`}
                  {techForm.cslv && `, CSLV: ${techForm.cslv}`}
                  )
                </div>
              )}
            </Card>

            {/* ── STEP 2: LLP ROWS ── */}
            {engineId && techDataSaved && (
              <Card title="Step 2 — LLP Rows">
                <div style={{ background: TEAL, padding: '12px 18px', borderRadius: '8px', marginBottom: '16px' }}>
                  <span style={{ color: 'white', fontWeight: 600, fontSize: '14px' }}>+ Add LLP Row</span>
                </div>

                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '16px' }}>
                  <Field label="Group Name">
                    <input
                      value={llpForm.group_name}
                      onChange={e => setLlpForm(f => ({ ...f, group_name: e.target.value }))}
                      placeholder="Group Name"
                      style={{ ...inputStyle, width: '140px' }}
                    />
                  </Field>
                  <Field label="Part Name *">
                    <input
                      value={llpForm.part_name}
                      onChange={e => setLlpForm(f => ({ ...f, part_name: e.target.value }))}
                      placeholder="Part Name"
                      style={{ ...inputStyle, width: '160px' }}
                    />
                  </Field>
                  <Field label="Life Limit *">
                    <input
                      value={llpForm.life_limit}
                      onChange={e => setLlpForm(f => ({ ...f, life_limit: e.target.value }))}
                      placeholder="e.g. 20000"
                      type="number"
                      style={{ ...inputStyle, width: '110px' }}
                    />
                  </Field>
                  <Field label="Cycles Used *">
                    <input
                      value={llpForm.cycles_used}
                      onChange={e => setLlpForm(f => ({ ...f, cycles_used: e.target.value }))}
                      placeholder="e.g. 13509"
                      type="number"
                      style={{ ...inputStyle, width: '110px' }}
                    />
                  </Field>
                  <Field label="Remaining Cycles *">
                    <input
                      value={llpForm.remaining_cycles}
                      onChange={e => setLlpForm(f => ({ ...f, remaining_cycles: e.target.value }))}
                      placeholder="e.g. 6491"
                      type="number"
                      style={{ ...inputStyle, width: '120px' }}
                    />
                  </Field>
                  <Btn onClick={handleAddLlp} disabled={loading === 'llp'}>
                    {loading === 'llp' ? 'Adding...' : 'Add Row'}
                  </Btn>
                </div>

                {llpRows.length > 0 && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #eee' }}>
                        {['ID', 'GROUP', 'NAME', 'LIFE LIMIT', 'CYCLES USED', 'REMAINING CYCLES'].map(h => (
                          <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#aaa', fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px' }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {llpRows.map(row => (
                        <tr key={row.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ padding: '9px 10px', color: '#888', fontFamily: 'monospace', fontSize: '12px' }}>{row.id}</td>
                          <td style={{ padding: '9px 10px' }}>{row.group_name || '—'}</td>
                          <td style={{ padding: '9px 10px', fontWeight: 500 }}>{row.part_name}</td>
                          <td style={{ padding: '9px 10px' }}>{parseInt(row.life_limit).toLocaleString()}</td>
                          <td style={{ padding: '9px 10px' }}>{parseInt(row.cycles_used).toLocaleString()}</td>
                          <td style={{ padding: '9px 10px', fontWeight: 600, color: parseInt(row.remaining_cycles) < 2000 ? '#c00' : '#222' }}>
                            {parseInt(row.remaining_cycles).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {llpRows.length === 0 && (
                  <p style={{ color: '#bbb', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>
                    No LLP rows added yet.
                  </p>
                )}
              </Card>
            )}

            {/* ── STEP 3: RUN CALCULATION ── */}
            {engineId && techDataSaved && llpRows.length > 0 && (
              <Card title="Step 3 — Run Calculation">
                <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>

                  {/* Left column: Evaluation Intent */}
                  <div style={{ minWidth: '220px' }}>
                    <Field label="Evaluation Intent *">
                      <select
                        value={calcForm.evaluation_intent}
                        onChange={e => setCalcForm(f => ({ ...f, evaluation_intent: e.target.value as EvalIntent }))}
                        style={selectStyle}
                      >
                        <option value="">Evaluation Intent</option>
                        <option>Financing</option>
                        <option>Purchase / Sale</option>
                        <option>Lease Placement</option>
                        <option>Distressed / Downside Case</option>
                      </select>
                    </Field>
                  </div>

                  {/* Right column: Advanced */}
                  <div style={{ flex: 1, minWidth: '280px' }}>
                    {/* Toggle */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
                      <div
                        onClick={() => setCalcForm(f => ({ ...f, advanced_toggle: f.advanced_toggle === 'ON' ? 'OFF' : 'ON' }))}
                        style={{
                          width: '46px', height: '26px', borderRadius: '13px',
                          background: calcForm.advanced_toggle === 'ON' ? TEAL : '#ccc',
                          cursor: 'pointer', position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                        }}
                      >
                        <div style={{
                          position: 'absolute', top: '3px',
                          left: calcForm.advanced_toggle === 'ON' ? '23px' : '3px',
                          width: '20px', height: '20px', borderRadius: '50%',
                          background: 'white', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                        }} />
                      </div>
                      <span style={{ fontWeight: 600, color: '#333', fontSize: '15px' }}>Advanced assumptions</span>
                    </div>

                    {calcForm.advanced_toggle === 'ON' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {/* Target FH */}
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <select value={calcForm.target_fh} onChange={e => setCalcForm(f => ({ ...f, target_fh: e.target.value }))} style={selectStyle}>
                            <option value="">Target FH</option>
                            <option value="12000">12,000 FH (conservative)</option>
                            <option value="15000">15,000 FH</option>
                            <option value="18000">18,000 FH (market)</option>
                            <option value="20000">20,000 FH</option>
                            <option value="22000">22,000 FH (optimistic)</option>
                            <option value="Custom">Custom</option>
                          </select>
                          {calcForm.target_fh === 'Custom' && (
                            <input
                              type="number"
                              placeholder="Input Target FH"
                              value={calcForm.target_fh_custom}
                              onChange={e => setCalcForm(f => ({ ...f, target_fh_custom: e.target.value }))}
                              style={{ ...inputStyle, flex: 1 }}
                            />
                          )}
                        </div>

                        {/* FH per Cycle */}
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <select value={calcForm.fh_per_cycle} onChange={e => setCalcForm(f => ({ ...f, fh_per_cycle: e.target.value }))} style={selectStyle}>
                            <option value="">FH per Cycle</option>
                            <option value="1.4">1.4 (short-haul / high-cycle)</option>
                            <option value="1.6">1.6</option>
                            <option value="1.8">1.8 (typical)</option>
                            <option value="2.1">2.1</option>
                            <option value="2.4">2.4 (longer sector)</option>
                            <option value="Custom">Custom</option>
                          </select>
                          {calcForm.fh_per_cycle === 'Custom' && (
                            <input
                              type="number"
                              step="0.1"
                              placeholder="Input FH per Cycle"
                              value={calcForm.fh_per_cycle_custom}
                              onChange={e => setCalcForm(f => ({ ...f, fh_per_cycle_custom: e.target.value }))}
                              style={{ ...inputStyle, flex: 1 }}
                            />
                          )}
                        </div>

                        {/* Engine Status */}
                        <select value={calcForm.engine_status} onChange={e => setCalcForm(f => ({ ...f, engine_status: e.target.value }))} style={selectStyle}>
                          <option value="">Engine Status</option>
                          <option>Serviceable</option>
                          <option>Unserviceable</option>
                        </select>

                        {/* QEC Status */}
                        <select value={calcForm.qec_status} onChange={e => setCalcForm(f => ({ ...f, qec_status: e.target.value }))} style={selectStyle}>
                          <option value="">QEC Status</option>
                          <option>Full QEC</option>
                          <option>Neutral / Unknown</option>
                        </select>

                        {/* Utilization Profile */}
                        <select value={calcForm.utilization_profile} onChange={e => setCalcForm(f => ({ ...f, utilization_profile: e.target.value }))} style={selectStyle}>
                          <option value="">Utilization Profile</option>
                          <option>Short-haul / High-cycle</option>
                          <option>Typical mixed operation</option>
                          <option>Longer sector / Low-cycle</option>
                        </select>

                        {/* Monthly Utilization */}
                        <select value={calcForm.monthly_utilization} onChange={e => setCalcForm(f => ({ ...f, monthly_utilization: e.target.value }))} style={selectStyle}>
                          <option value="">Monthly Utilization</option>
                          <option>Low</option>
                          <option>Medium</option>
                          <option>High</option>
                        </select>

                        {/* Safety Buffer */}
                        <select value={calcForm.safety_buffer} onChange={e => setCalcForm(f => ({ ...f, safety_buffer: e.target.value }))} style={selectStyle}>
                          <option value="">Safety Buffer</option>
                          <option>Conservative (15%)</option>
                          <option>Market standard (10%)</option>
                          <option>Aggressive (5%)</option>
                        </select>

                        {/* Harsh Environment */}
                        <select
                          value={calcForm.harsh_environment ? 'yes' : 'no'}
                          onChange={e => setCalcForm(f => ({ ...f, harsh_environment: e.target.value === 'yes' }))}
                          style={selectStyle}
                        >
                          <option value="no">Harsh Environment: No / Standard operation</option>
                          <option value="yes">Harsh Environment: Yes — Harsh environment</option>
                        </select>
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ marginTop: '24px', textAlign: 'center' }}>
                  <Btn
                    onClick={handleRunCalc}
                    disabled={!calcForm.evaluation_intent || loading === 'calc'}
                    style={{ padding: '11px 36px', fontSize: '15px' }}
                  >
                    {loading === 'calc' ? 'Running...' : 'Run Calculation'}
                  </Btn>
                </div>
              </Card>
            )}

            {/* ── RESULTS ── */}
            {result && (
              <Card title="Results">
                {result.blocked ? (
                  <div style={{ background: '#fff0f0', border: '1px solid #ffb3b3', borderRadius: '8px', padding: '16px' }}>
                    <p style={{ fontWeight: 700, color: '#cc0000', marginBottom: '10px', fontSize: '15px' }}>⛔ BLOCKED</p>
                    <Row label="Reason" value={String(result.block_reason ?? '')} />
                    <Row label="Trigger Step" value={String(result.trigger_step ?? '')} />
                    <Row label="Required to Proceed" value={String(result.required_to_proceed ?? '')} />
                    {result.confidence_band != null && <Row label="Confidence" value={String(result.confidence_band)} />}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {/* Key metrics */}
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <Metric label="GT_BASE" value={`${Number(result.gt_base).toLocaleString()} cycles`} highlight />
                      <Metric label="GT_DISK" value={`${Number(result.gt_disk).toLocaleString()} cycles`} />
                      <Metric label="GT_LLP" value={`${Number(result.gt_llp).toLocaleString()} cycles`} />
                      <Metric label="Binding Constraint" value={String(result.binding_constraint ?? '—')} />
                      <Metric label="Baseline Type" value={String(result.baseline_type ?? '—')} />
                      <Metric label="Baseline Cycles" value={result.baseline_cycles != null ? Number(result.baseline_cycles).toLocaleString() : '—'} />
                      <Metric label="Confidence" value={String(result.confidence_band ?? '—')} />
                    </div>

                    {result.limiting_llp && (
                      <p style={{ fontSize: '14px', color: '#555' }}>
                        <b>Limiting LLP:</b> {String(result.limiting_llp)} ({String(result.limiting_module ?? '')})
                      </p>
                    )}

                    {/* Disclosures */}
                    {Array.isArray(result.disclosures) && result.disclosures.length > 0 && (
                      <div>
                        <p style={{ fontWeight: 700, fontSize: '13px', color: '#555', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Disclosures ({result.disclosures.length})
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {(result.disclosures as Record<string, unknown>[]).map(d => (
                            <div key={String(d.code)} style={{ background: '#fffbef', border: '1px solid #ffe08a', borderRadius: '6px', padding: '10px 14px', fontSize: '13px' }}>
                              <span style={{ fontWeight: 700, color: '#7a5500', marginRight: '8px' }}>{String(d.code)}</span>
                              <span style={{ color: '#666' }}>{String(d.language ?? '')}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Raw JSON */}
                    <details style={{ marginTop: '4px' }}>
                      <summary style={{ cursor: 'pointer', fontSize: '13px', color: '#aaa', userSelect: 'none', padding: '4px 0' }}>
                        Raw JSON response
                      </summary>
                      <pre style={{ background: '#1a1a2e', color: '#b8f0b8', padding: '16px', borderRadius: '8px', fontSize: '12px', overflowX: 'auto', marginTop: '8px', lineHeight: 1.6 }}>
                        {JSON.stringify(result, null, 2)}
                      </pre>
                    </details>
                  </div>
                )}
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── STYLE CONSTANTS ────────────────────────────────────

const inputStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: '8px',
  border: '1px solid #ddd',
  background: '#f7f7f7',
  fontSize: '14px',
  color: '#333',
  width: '100%',
}

// ── SMALL COMPONENTS ───────────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'white', borderRadius: '12px', padding: '22px 26px', marginBottom: '20px', boxShadow: '0 1px 5px rgba(0,0,0,0.07)' }}>
      <h2 style={{ fontSize: '14px', fontWeight: 700, color: TEAL, borderBottom: '1px solid #eee', paddingBottom: '12px', marginBottom: '18px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {title}
      </h2>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <label style={{ fontSize: '11px', fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function Btn({ onClick, disabled, children, style }: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? '#b0b0b0' : TEAL,
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        padding: '9px 18px',
        fontWeight: 700,
        fontSize: '14px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        whiteSpace: 'nowrap',
        transition: 'background 0.15s',
        ...style,
      }}
    >
      {children}
    </button>
  )
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{
      background: highlight ? TEAL : '#f5f5f5',
      borderRadius: '10px',
      padding: '12px 16px',
      minWidth: '110px',
    }}>
      <p style={{ fontSize: '10px', color: highlight ? '#9ecad8' : '#aaa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '4px' }}>
        {label}
      </p>
      <p style={{ fontSize: highlight ? '22px' : '17px', fontWeight: 700, color: highlight ? 'white' : '#222', lineHeight: 1.2 }}>
        {value}
      </p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p style={{ fontSize: '14px', color: '#555', marginBottom: '6px' }}>
      <b style={{ color: '#333' }}>{label}:</b> {value}
    </p>
  )
}
