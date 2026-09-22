// Every guard suite in the repo, in one command:  npm run test:guards
//
// These run the bodies in tools/*/nodes/, which are byte-for-byte copies of the
// DEPLOYED n8n nodes, and extract the guard out of each body rather than
// restating it. So a failure means one of two things, both worth knowing:
//   - a local edit broke a guard, or
//   - the deployed node changed and nobody refreshed the copy here.
//
// Hermetic by design: no network, no credentials, no .env. Verified from a
// clean clone with an empty environment, which is why this can run in CI.
// The false-positive audits (fp_audit*.js, observe.py) are NOT here — they need
// real member conversations and must stay out of CI.
const { execFileSync } = require('child_process');

const RUNNERS = [
  ['outbound reply guards', 'access-level-guard/run.js'],
  ['club resolution',       'club-resolver/suite_club_match.js'],
  ['scenario 4a',           'scenario-4a/run.js'],
];

let failed = [];
for (const [label, rel] of RUNNERS) {
  process.stdout.write(`\n=== ${label} ===\n`);
  try {
    process.stdout.write(execFileSync(process.execPath, [__dirname + '/' + rel], { encoding: 'utf8' }));
  } catch (e) {
    process.stdout.write(String(e.stdout || '') + String(e.stderr || ''));
    failed.push(label);
  }
}
if (failed.length) {
  console.log(`\nFAILED: ${failed.join(', ')}`);
  process.exit(1);
}
console.log('\nall guard suites green');
