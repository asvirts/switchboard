# Contributing to Switchboard

Switchboard helps a primary agent delegate bounded work to T3 Code workers using
a configurable model policy. The fork also retains the original Claude Code and
Codex proxy routing. Small fixes, reproducible routing reports, documentation,
and adapter tests are welcome. Discuss larger changes in an issue before
implementing them.

## Pull requests and review

Fork the repository and open a PR against `main`. Include the problem, your
change, and the checks you ran. [AGENTS.md](AGENTS.md) is the short guide for
coding agents working on a contribution.

Andrew Virts (`@asvirts`) is the code owner in `.github/CODEOWNERS`. The
workflow checks macOS/Linux on Node 22.18 and 24. CI uses synthetic providers
and does not need classifier keys. GitHub may ask the maintainer to allow a
first-time contributor's workflow run.

The [repository rule configurations](.github/rulesets) must be activated in
GitHub Settings to enforce these requirements; committing the files alone does
not enable protection. The maintainer setup is in the
[distribution guide](docs/distribution.md#github-review-and-ci-rules).

## Development

Use macOS or Linux with Node.js 22.18 or newer, Git, and Bash:

```sh
npm ci
npm run build
```

The source is TypeScript. The local CLI runs compiled files from `dist/`, so run
`npm run build` again after editing source before trying a CLI command.

During development, run the relevant test file and the typechecker:

```sh
node --test test/policy.test.ts
npm run check
```

Before submitting a code change, run the full suite and package check:

```sh
npm test
npm run test:package
```

The ordinary suite uses synthetic providers and fake credentials. It does not
need `.env.local` or make paid AI requests. The package smoke check may download
public npm dependencies. It verifies the compiled archive independently of the
source checkout.

Live model tests require explicit authorization. Use synthetic tasks in an
isolated scratch directory and only test models your account can access.
T3 worker runs consume provider quota; legacy proxy tests can also consume
classifier credits. Never include credentials or raw private transcripts in a
contribution.

## Where to make changes

| Area | Files |
| --- | --- |
| T3 worker policy and setup | `src/t3/routing.ts`, `src/t3/cli.ts` |
| CLI commands and setup | `src/cli.ts`, `src/setup.ts`, `src/settings.ts` |
| Interactive settings and doctor fixes | `src/interactive.ts`, `src/policy-edit.ts`, `src/prompts.ts`, `src/doctor-fix.ts` |
| Classifier connections and questions | `src/classifier.ts`, `src/jev.ts`, `src/jev-questions.ts`, `src/capability-question.ts`, `src/laya.ts`, `src/laya-questions.ts` |
| Model and effort selection | `src/core/policy.ts`, `src/core/config.ts`, `src/defaults.ts` |
| Conversation pinning and saved state | `src/core/session.ts`, `src/storage.ts` |
| Native CLI launch, requests, hooks, and status | `src/native/` |
| Packaging and CI | `scripts/`, `.github/workflows/verify.yml` |

Read [T3 worker setup](docs/t3.md) before changing worker selection. For the
legacy proxy, read [how routing works](docs/routing.md), the
[customization guide](docs/customization.md), and
[classifier connections](docs/classifiers.md). Most source modules have a
corresponding test file under `test/`.

## Choosing tests

Add a regression test for a fixed bug or a changed behavior that could affect
routing, privacy, saved state, or a native CLI session. Prefer a test through the
relevant public boundary, with an expected result independent of the code being
tested. Reuse an existing case or table when it already exercises that path.

Documentation, wording, and cosmetic changes usually need a review of the
result, not a new automated test. Avoid assertions about private helper details
or copying the same model matrix into several files. The 36-combination test in
`test/model-aware-routing.test.ts` covers classifier answers through policy and
native request rewriting. Separate cases should cover distinct failure modes.

Keep tests deterministic and distinguish synthetic coverage from live provider
evidence. A mocked classifier verifies how Switchboard handles its answer; it
does not prove that Jev will choose that answer for a real task. Tests stay in the
source repository and are excluded from the installed npm package.

## Native adapter checks

When changing a native adapter, use the interactive CLI on a supported host.
Start a fresh conversation for each routing case; follow-ups reuse the saved
model and effort. Exercise a mechanical edit, a bounded coding task with tests,
and a harder review. Inspect `switchboard explain` for the selected route.

Within a conversation, check tool approvals and denials, cancellation followed
by a new prompt, exit and resume, and explicit native model bypass. Compare
native settings before and after, and check that temporary configuration and
active locks are cleaned up. Run Linux tool execution with its native sandbox
working; a container that blocks namespaces cannot verify that behavior.

Keep raw terminal recordings, local trial reports, ad hoc UAT workspaces and
planning documents out of the repository. Share a concise, redacted account of
what you checked in the pull request instead. Project documentation should help
users or contributors operate the current software.

## Changes and reports

- For T3 workers, keep semantic judgment in the primary agent and model policy
  decisions in code. For the legacy proxy, keep semantic classification in the
  classifier. Model and effort pinning, resume, explicit native overrides, and
  personal exclusions are existing legacy contracts.
- For routing reports, provide a sanitized task, CLI/Node/OS versions, policy
  overrides, expected and actual selection, and redacted `switchboard explain`
  output. A selected model is not by itself evidence of answer quality.
- Follow the native adapter checks above when those paths change. Do not weaken
  native sandbox or approval settings to make a test pass.
- Update user-facing documentation when commands or behavior change. Preserve
  upstream notices for reused code.

Local skills, credentials, and `uat-scratch*/` directories are ignored. Keep
commits focused and describe what changed and how it was verified in the pull
request. Contributions are accepted under the project's Apache-2.0 license;
third-party portions retain their existing license notices.
