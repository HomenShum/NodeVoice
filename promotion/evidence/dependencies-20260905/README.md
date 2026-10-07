# NodeVoice dependency evidence supplement

Read the root HANDOFF for setup and current limitations. This supplement preserves the independently accepted seven-row dependency repair. The controls repair is merged through PR 6 at main `6544eb482787099280825eb932f1c5bb7a99f01f`. Root has applied the accepted lock on the local dependency branch and recorded a normal install. Dependency shared CI, commit/publication and hosted acceptance remain separate.

From the repository root:

```powershell
python promotion/evidence/dependencies-20260905/verify.py
python promotion/evidence/dependencies-20260905/verify.py --source-root .
```

The first command verifies portable raw bytes. The optional source check verifies the effective 177-file dependency snapshot, including the accepted new lock; it does not verify current Git filters, stage/commit identity, external provenance or runtime behavior. The old `controls-20260905/verify.py --source-root .` checks the old lock and therefore correctly differs after this dependency update. Its default packet-only verification still works. That historical packet is unchanged.

Direct evidence:

- [Independent 60-check judgment](raw/receipts/E6j_NODEVOICE_DEPENDENCY_EXTERNAL_JUDGE.md.txt) accepts the exact scope; [actual seven-row diff](raw/judge/actual-lock.diff.txt) and [native resolution receipt](raw/worker/evidence/resolution-receipt.json) show no new direct dependency or unrelated row change. package.json was restored byte-for-byte.
- [Sixteen canary comparisons](raw/worker/evidence/canary-before-after-verdict.json) bind the unchanged installed-library observer, both original timed-out ID calls, real permitted/forbidden owned source-map reads, inherited stats and the 2,050-query cache case. [Original failures](raw/worker/evidence/canaries-baseline/report.json) remain separate from [updated observations](raw/worker/evidence/canaries-proposed/report.json).
- [Normal scratch install](raw/worker/evidence/proposed-npm-ci.log.txt), [full audit](raw/worker/evidence/proposed-npm-audit-omit-dev.stdout.json), [omit-dev audit](raw/worker/evidence/proposed-npm-audit-omit-dev.stdout.json), [doctor](raw/worker/evidence/proposed-doctor.log.txt), [55-test proof](raw/worker/evidence/proposed-proof.log.txt) and [build](raw/worker/evidence/proposed-build.log.txt) preserve exact outputs and their command receipt. No tests or browser run were repeated to assemble this supplement.
- [Independent three-asset comparison](raw/judge/independent-build-rebind.json) and [historical proof binding](raw/worker/evidence/historical-native-rebind.json) show byte-identical HTML/CSS/JS. This binds the prior actual 100/100 local proof; it is not a new playback, font/network observation, provider or audio result.
- [Main workflow identities](raw/merged-controls/initial-runs.stdout.txt) and [main 55-test CI log](raw/merged-controls/job-101392892218-log.stdout.txt) cover merged controls main, not the future dependency commit. [Local transfer summary](transfer-summary.json) labels the parent-owned lock transfer and normal install separately.
- [Anonymous alias observation](raw/merged-controls/public-bootstrap-summary.json) and [source-token comparison](raw/merged-controls/public-source-token-observation.json) preserve the 23:23 UTC observation: the alias served index-CGenaCDE.js without the reviewed controls tokens, and the exact deployment host did not expose the app anonymously. Provider success status did not establish public UI acceptance. Deployment diagnosis is separate.

[raw-copy-map.json](raw-copy-map.json) maps every included logical origin to exact payload bytes. [origin-custody-map.json](origin-custody-map.json) lists the 268-file worker freeze, independent reviewer evidence and original metadata readback, including every omission. Identical copies are deduplicated. The complete 177-file source tree and three compiled assets are hash-bound, not recopied. The exact package/lock resolution records and two small build-config readbacks are deliberate raw evidence exceptions; no old media/cache packet is duplicated. An omitted original cannot be reconstructed from its hash.

Historical scripts are inert `.txt` evidence with operator-specific paths. They are not advertised as portable launchers. The verifier is the only executable added here and uses Python's standard library. Command logs end in `.txt`, preserving bytes while avoiding the repository's log-ignore rule.

The two audits returned zero findings for this feed and exact lock, not a complete security guarantee. All seven updates are development tooling; the documented start uses devDependency tsx, so a production-only install is not certified. The Browserslist cache advisory's maintainer Medium rating and database high rating are both preserved. The older Nano ID integer-overflow advisory was already fixed below the baseline and is not counted as another current defect.

Full grades remain null. Main-pane and short-height reading, selected-option ellipsis, native zoom, physical devices, full accessibility, microphone/audio, real provider execution, hosted Convex, durable restart, listener restriction and production acceptance remain open. The current listener has no explicit host; localhost use does not prove loopback-only binding.
