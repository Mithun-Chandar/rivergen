// ─── Gate result types ─────────────────────────────────────────────────────────

export interface GateViolation {
  /** Relative file path from project root. */
  file: string;
  /** 1-based line number (approximate — from regex match offset). */
  line?: number;
  /** Human-readable description of the violation. */
  message: string;
  /** errors block execution; warnings are advisory. */
  severity: "error" | "warning";
}

export interface GateResult {
  /** Short identifier: "gate1", "gate2", etc. */
  gateId: string;
  /** Full name displayed in reports. */
  gateName: string;
  /** True when violations contains zero errors (warnings allowed). */
  passed: boolean;
  /** True when the gate was intentionally not evaluated (artifacts absent). Skipped gates are not counted as passed or failed. */
  skipped?: boolean;
  violations: GateViolation[];
  /** One-line summary e.g. "3/3 mutation files covered". */
  summary: string;
  /** Optional informational notes rendered as indented lines below the summary — for non-blocking items that still require developer attention. */
  notes?: string[];
  /** Total items checked. */
  testedCount: number;
  /** Items that passed. */
  passedCount: number;
}

export interface RunnerReport {
  projectRoot: string;
  timestamp: string;
  allPassed: boolean;
  results: GateResult[];
}
