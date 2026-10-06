/* Validation suite for the Trial Match mockup. Run with: npm run validate
 *
 * Checks data integrity, rules-engine invariants, per-patient scenario expectations (a small golden set reasoned by hand
 * from the chart text, not copied from engine output), agent behaviour, rule validation, scenario coverage, and then each
 * feature module. It uses its own independent oracles on purpose: if it reused the code under test it could not catch its bugs.
 */
import './checks/core';
import './checks/time';
import './checks/path';
import './checks/brief';
import './checks/guardrails';
import './checks/chain';
import './checks/impact';
import './checks/eval';
import './checks/ops';
import './checks/review';
import './checks/theme';
import { runAll, summary } from './harness';

runAll().then(summary);
