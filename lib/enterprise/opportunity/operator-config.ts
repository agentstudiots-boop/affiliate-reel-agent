// Operator-approved settings of the Opportunity Scout (review #118). Static, reviewed code like the department registry:
// changing a value needs a pull request that the operator merges – no caller, model or table can set them.
//
// SCORING_CONFIG: weights and thresholds of the F-01 grid (operator decision Q-07). While null, every total is unknown and
// nothing is recommended ("blocked").
// ECONOMICS_LIMITS: the maximum payback the operator accepts (F-04). While null, the verdict is "no_operator_limit" and no
// test is recommended.
// Measured economics (a test phase) are deliberately not taken here at all: they will come from the controlling ledger
// (E-01/E-04) once a test has run, never from the caller of an assessment.

import type { EconomicsLimits } from "./economics";
import type { ScoringConfig } from "./scoring";

export const SCORING_CONFIG: ScoringConfig | null = null;
export const ECONOMICS_LIMITS: EconomicsLimits | null = null;
