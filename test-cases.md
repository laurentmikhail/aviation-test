Case 1 - Explicit Baseline Present (Clean Case)
Input Conditions
Disk sheet includes:
CSPR = 6,200 cycles
CSN = 32,000 cycles
LLP remaining minimum = 5,500 cycles
Evaluation intent = Lease Placement
Advanced toggle OFF
Defaults for Lease Placement:
Target FH = 18,000
FH/cycle = 1.8
Target cycles = 18,000 / 1.8 = 10,000 cycles
GT_DISK = 10,000 − 6,200 = 3,800 cycles
GT_LLP = 5,500 cycles
GT_BASE = min(3,800, 5,500) = 3,800
Expected Output
Baseline type = Explicit
Binding constraint = DISK
GT_BASE = 3,800
Disclosures:
D-ASSUMP-DEFAULT
D-SCENARIO
D-MODEL-LIM
Confidence = MEDIUM
Why This Case Matters
This is the ideal scenario where the disk sheet provides the best baseline counter.

Case 2 - Validated Baseline Used (Scope-Ambiguous Counter)
Input Conditions
Disk sheet includes:
CSO = 13,509 cycles
No CSPR present.
LLP cycles used rows are clustered around:
13,480
13,512
13,525
This indicates the CSO is consistent with LLP reset patterns.
Evaluation intent = Financing
Advanced toggle OFF
Defaults for Financing:
Target FH = 12,000
FH/cycle = 1.8
Target cycles = 6,666 cycles
GT_DISK = 6,666 − 13,509 = negative → floor to 0
GT_LLP = 4,000 cycles (example)
GT_BASE = min(0, 4,000) = 0
Expected Output
Baseline type = Validated
Disclosure includes:
D-VAL-BASE
D-GT-ZERO
D-ASSUMP-DEFAULT
D-SCENARIO
D-MODEL-LIM
GT_BASE = 0
Confidence = LOW (validated baseline gives some strength but runway exhausted)
Why This Case Matters
Validated baselines are very common in real transactions and must be handled conservatively with disclosure.

Case 3 - Inferred Baseline Used (No Counters Available)
Input Conditions
Disk sheet includes:
CSN = 32,661
No CSPR, CSO, CSLV present.
LLP cycles used are consistent:
13,509 across almost all LLP rows.
Evaluation intent = Purchase / Sale
Advanced toggle OFF
Defaults:
Target FH = 15,000
FH/cycle = 1.8
Target cycles = 8,333
GT_DISK = 8,333 − 13,509 = negative → floor to 0
GT_LLP = 6,000
GT_BASE = 0
Expected Output
Baseline type = Inferred
Disclosure includes:
D-INF-BASE
D-GT-ZERO
D-ASSUMP-DEFAULT
D-SCENARIO
D-MODEL-LIM
Confidence = LOW (because inference is assumption-based)
Why This Case Matters
Inference is a key governance feature. It allows evaluations to proceed without overstating certainty.

Case 4 - Conflicting Counters (Hard Stop)
Input Conditions
Disk sheet includes:
CSPR = 6,000
CSLV = 9,000
Both are “since shop” counters and conflict materially.
Expected Output
Evaluation is BLOCKED
No GT output is produced
Disclosure includes:
D-CONF-BASE
D-MODEL-LIM
Block record states:
“Conflicting since-shop counters identified.”
Why This Case Matters
This is the primary audit risk condition. A model that continues anyway is not governance-grade.

Case 5 - LLP Governs (Hard-Life Cap)
Input Conditions
GT_DISK calculated as 6,000 cycles.
LLP table shows limiting LLP has:
remaining = 1,250 cycles
Expected Output
GT_LLP = 1,250
GT_BASE = 1,250
Binding constraint = LLP
Disclosure includes:
D-LLP-CAP
D-LIMIT-PROX (since 1,250 is likely below threshold)
D-MODEL-LIM
Why This Case Matters
This is the legal reality case: even if scenario runway exists, LLP life ends first.