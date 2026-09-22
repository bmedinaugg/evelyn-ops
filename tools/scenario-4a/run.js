// All Scenario 4a suites.  node tools/scenario-4a/run.js
//
//   decide.js  the rules from Esther's guide + her 21 Sep answers (pure)
//   intent.js  decided vs exploring, so the self-service redirect can tell them apart
//   facts.js   otp_pending -> decide4a inputs, incl. the CITY tier the live parser misses
//
// None of this is deployed yet. facts.js documents what the bot actually holds
// (checked against 7,000 sessions) and what it does not — there is no price,
// discount or fee-adjustment field anywhere in it.
const { execFileSync } = require('child_process');
let failed = 0;
for (const s of ['suite_decide.js', 'suite_intent.js', 'suite_facts.js']) {
  try {
    process.stdout.write(execFileSync(process.execPath, [__dirname + '/' + s], { encoding: 'utf8' }));
  } catch (e) {
    process.stdout.write(String(e.stdout || '') + String(e.stderr || ''));
    failed++;
  }
}
process.exit(failed ? 1 : 0);
