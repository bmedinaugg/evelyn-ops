// All Scenario 4a suites.  node tools/scenario-4a/run.js
//
//   decide.js  the rules from Esther's guide + her 21 Sep answers (pure)
//   intent.js  decided vs exploring, so the self-service redirect can tell them apart
//   facts.js   otp_pending -> decide4a inputs, incl. the CITY tier the live parser misses
//
// And two suites that run DEPLOYED node bodies from ./nodes/, byte-for-byte
// copies plus the 4a patch, rather than restating their logic:
//   suite_guardrails.js  the exploring bypass in Change-Flow Guardrails
//   suite_briefing.js    the CITY tier fix in Change Options Briefing
// After editing either node in n8n, fetch the body back, overwrite the file
// here, and re-run; a failure means the deployed code changed behaviour.
//
// facts.js documents what the bot actually holds (checked against 7,000
// sessions) and what it does not — there is no price, discount or
// fee-adjustment field anywhere in it.
const { execFileSync } = require('child_process');
let failed = 0;
for (const s of ['suite_decide.js', 'suite_intent.js', 'suite_facts.js', 'suite_guardrails.js', 'suite_briefing.js']) {
  try {
    process.stdout.write(execFileSync(process.execPath, [__dirname + '/' + s], { encoding: 'utf8' }));
  } catch (e) {
    process.stdout.write(String(e.stdout || '') + String(e.stderr || ''));
    failed++;
  }
}
process.exit(failed ? 1 : 0);
