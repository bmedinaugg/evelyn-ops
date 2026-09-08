// Access-level regression suites (2026-09-08).
//
// Feedback 923ec980 (Nelly Palikara) and 44a2f893 (Thallia El Haddad): the bot
// answered "what are the access levels?" with invented tiers whenever no club
// had resolved, and in session 3fb2c0e8 the invented level reached real ticket
// #634927.
//
// These suites run against the bodies in ./nodes/, which are byte-for-byte
// copies of the DEPLOYED n8n nodes:
//   nodes/Break_Repeat_Loop.js   Bot - Main (Ns0OsYgRawvQzWnw), reply guard 4
//   nodes/Validate_Output.js     Bot - Ticket Collection Agent (Yq2zEE9NQo6hQvnO)
//   nodes/Access_Level_Facts.js  Bot - Ticket Collection Agent, ground-truth block
// Each suite extracts the guard out of the node body rather than restating its
// logic, so a test can never drift from what is live. After editing any of
// those nodes, fetch the body back out of n8n, overwrite the file here, and
// re-run; a failure means the deployed code changed behaviour.
//
//   node tools/access-level-guard/run.js
//
// fp_audit.js is the false-positive check and needs a corpus that is not
// committed (real member replies). Produce it with:
//   select json_agg(json_build_object('s', session_id, 'c', content))
//     from bot.conversation_messages
//    where role = 'assistant' and created_at > now() - interval '21 days'
//      and (content ~* 'access[ -]?level|toegangsniveau|membership level'
//           or content ~ '\y[A-Za-z]{3,12}[ -]Labels?\y');
// then: node tools/access-level-guard/fp_audit.js <file.json>
// Baseline on 2026-09-08: 2,336 replies scanned, 154 blocked across 88
// sessions, 2 of them false positives (0.09%).

const { execFileSync } = require('child_process');
let failed = 0;
for (const s of ['suite_guard4.js', 'suite_validate.js', 'suite_facts.js']) {
  const out = execFileSync(process.execPath, [__dirname + '/' + s], { encoding: 'utf8' });
  process.stdout.write(out);
  if (/FAIL|failures/.test(out)) failed++;
}
process.exit(failed ? 1 : 0);
