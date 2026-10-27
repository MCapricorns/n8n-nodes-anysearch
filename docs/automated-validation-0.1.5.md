# Automated validation and release report: 0.1.5

Date: 2026-10-27. Package: n8n-nodes-anysearch@0.1.5.
Local validated source: 03ef3f7c0b079eedf16efa3d0c6fa6c24699eae8.
Publication status: pending GitHub Actions. This report will be updated after registry verification.

## Scope and fixes

This pass addresses the basic integration findings E01-E04 from the supplied review. It does not claim exhaustive validation of all vertical capabilities or compatibility with every n8n release.

- E01: malformed envelopes, missing/invalid business codes, missing results, invalid arrays and invalid array entries now fail explicitly. Valid empty results remain successful.
- E02: selected credential read/decryption failures reach the caller without anonymous fallback.
- E03: blank keys are allowed. Workflow execution and the credential connection test omit Authorization entirely when the key is blank. Nonempty keys use Bearer authentication.
- E04: smoke tests assert mappings and responses. CI and publishing run offline regressions before a release.

Live browser testing exposed an additional issue: n8n converts undefined generic authentication expression values to empty strings. The credential now uses the supported authenticate hook, which does not create an Authorization property for blank keys. The corrected behavior was verified using actual HTTP requests from n8n.

The release retains the 0.1.4 fully-qualified Codex identifier and Utility category, avoiding a regression to metadata previously rejected by the Creator Portal.

## Results

| Check | Result |
| --- | --- |
| npm test, including TypeScript build | 47 passed, 0 failed |
| tsc --noEmit --noUnusedLocals --noUnusedParameters | Exit 0 |
| npm run lint, clean staging checkout with the default strict config | Exit 0; 0 errors, 1 existing icon-theme warning |
| Review behavior contract against the current build | 14 passed, 0 failed |
| Live anonymous smoke | All 6 operation checks passed |
| Installed package executed by n8n CLI | 7 of 7 scenarios passed |
| Browser: save a blank-key credential | Saved successfully; connection test succeeded |
| Browser: execute workflow using the saved blank-key credential | Execution 3 succeeded, 2 search results |
| Browser transport observation | Neither connection testing nor workflow execution sent Authorization for blank keys |
| Compiled-code identity | Node and credential JS match the exact installed files used in n8n testing |

The review contract excludes C01, which tests historical 0.1.4 tarball identity. C05/B05 were adapted only to invoke the new authenticate hook instead of inspecting the superseded generic-expression shape; their Bearer and anonymous-route expectations remain intact. Original evidence files were preserved.

The clean lint staging directory contains the tracked worktree files and uses the project's installed dependencies. This avoids traversing the large third-party n8n installation under ignored bug/. The strict ESLint configuration was preserved.

## Real n8n environment

- n8n 2.44.7, Node.js 24.22.1, Windows.
- Plugin installed from the 0.1.5 npm tarball in a disposable instance.
- CLI workflows were imported and executed through the n8n CLI. Browser checks used the standard n8n server and headless Microsoft Edge via Playwright.
- HTTP diagnostics observed outgoing requests without substituting responses. Evidence records only authentication-presence booleans, never the supplied key.

| Scenario | Result and request evidence |
| --- | --- |
| Anonymous search | Success, 3 items, no Authorization |
| Selected blank key | Success, full-envelope output, no Authorization |
| Invalid key | Explicit authentication failure; n8n made 2 authenticated attempts, neither anonymous |
| Extract | Success, URL/title/content |
| List domains | Success, 17 items |
| Sub-domains | Success, 2 domain entries |
| Supplied valid key | Success, Bearer authentication observed |

Request IDs:

- Blank-key CLI search: f62b573c-35a9-4cfe-b382-ffe7a5637222.
- Valid-key CLI search: cef461dc-af34-46dc-8769-e9d008f64f7d.
- Browser workflow: 04a56630-b855-4dd6-9b36-d2b45ff7fe60.

Structured evidence: [native-cli.json](verification/0.1.5/native-cli.json), [browser.json](verification/0.1.5/browser.json).
Local logs, screenshots and test harnesses: bug/automatic-e2e/. Original review evidence remains unchanged under bug/basic-evidence-2026-10-27/.

## Maintenance evidence

The production helper/credential audit found no provably unused production function or import. Dynamic node registration, loadOptions references, error handling and authentication paths were retained.

Removed one redundant test: the zero-code/empty-results success assertion is already completely covered by the empty-results regression, which also checks the returned output. Removed an unused crypto import from the local automation harness after its random-key generation was retired. Added one catalog-registration regression to guard the previously rejected node identifier/category. The total remains 47 tests.

Evidence: compiler unused-symbol checks passed; tests and package registration identify reachable entry points. No feature flags, production configuration or history were deleted.

## Security and verification boundary

The supplied temporary key was not committed or included in the evidence. The plaintext CLI import file was removed immediately after import, and the disposable credential database containing the encrypted key was deleted after verification. The temporary n8n server was stopped. The key can now be revoked.

These results verify the repaired basic integration in the stated n8n environment. They do not establish approval in the n8n Creator Portal, behavior on the recipient's infrastructure, or automatic upgrades of existing installations.

## Reproduction

    npm ci
    npm test
    npm run lint
    npx tsc --noEmit --noUnusedLocals --noUnusedParameters

The live smoke additionally calls the real service and can consume search allowance:

    node scripts/smoke.mjs

The GitHub Actions publish workflow runs npm test before the n8n CLI's lint/build/publish flow, with provenance enabled. Publishing does not automatically update existing n8n installations.
