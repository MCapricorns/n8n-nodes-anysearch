Subject: AnySearch n8n integration fixes and 0.1.5 regression evidence

Hello AnySearch team,

We have addressed the basic integration findings E01-E04 and prepared n8n-nodes-anysearch version 0.1.5 for review.

The changes distinguish malformed API responses from valid empty results, surface selected-credential read failures instead of switching to anonymous access, support blank API keys without sending Authorization, and add asserted smoke/regression tests to CI and the release workflow. Live browser verification also found and resolved an empty-Authorization issue in the credential connection test.

Validation results:

- 47 automated regression tests passed, with no failures.
- 14 review behavior contract checks passed. Only the historical tarball identity check was excluded; two authentication probes were adapted to the supported hook while retaining their expected behaviors.
- All 7 workflows passed in a real n8n 2.44.7 instance, including anonymous access, blank keys, valid Bearer authentication, invalid-key errors, extraction and capability discovery.
- Browser verification confirmed that a blank-key credential can be saved and connection-tested, and that a workflow using it executes successfully with 2 search results. HTTP observation confirmed the absence of Authorization for both blank-key paths.
- Build and strict lint passed. One existing icon-theme warning remains.

Package, source commit and publication evidence:

- npm package: https://www.npmjs.com/package/n8n-nodes-anysearch
- Release version: 0.1.5. Publication status and the exact published source SHA will be filled after the release workflow completes.
- Repository: https://github.com/MCapricorns/n8n-nodes-anysearch
- Report: docs/automated-validation-0.1.5.md in the repository.

The report and structured evidence describe the tested environment and the boundaries of these results. Please review the fix and run your planned end-to-end verification in your own n8n environment. We have not claimed Creator Portal approval or exhaustive vertical-capability coverage.

Please let us know if you need additional evidence for a specific acceptance item.

Best regards
