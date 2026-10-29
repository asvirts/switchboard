# Installation and releases

The fork's package identity is `@asvirts/switchboard`; its executable is
`switchboard`. Use the source checkout or a locally packed archive. The fork
has no verified npm or Homebrew release, so the upstream packages do not install
this fork's T3 workflow.

## Build from source

On macOS or Linux with Node.js 22.18 or later:

```sh
git clone https://github.com/asvirts/switchboard.git
cd switchboard
npm ci
npm run build
```

From the target project's directory, initialize the built checkout using its
actual absolute path:

```sh
node /absolute/path/to/switchboard/bin/switchboard.mjs t3 init
```

Start a new T3 conversation in that project. The setup adds a managed block to
`AGENTS.md` and creates a separate T3 policy if absent. It does not change the
primary model, install a global package, or require a Jev key. See the
[T3 guide](t3.md) for policy and operation. Rebuild the checkout after source
changes and keep it in place while its path appears in project instructions.

The legacy proxy commands and classifier setup remain available; see
[classifier connections](classifiers.md) and [native CLI integration](native-cli.md).

## Try a local package

Run `npm test` and `npm run test:package`, then create a local archive with
`npm pack --pack-destination <directory>`, replacing `<directory>` with an
existing local directory. To install it into a private prefix for testing, use
`npm install --global --prefix <prefix> <archive>` with the actual paths. The
command is then available in that prefix's `bin` directory. Package installation
and testing do not establish public availability.

Personal settings live under `~/.config/switchboard` by default. An explicit
`SWITCHBOARD_HOME` takes precedence; otherwise an absolute `XDG_CONFIG_HOME`
selects its `switchboard` subdirectory. The T3 policy is `t3-policy.json`;
legacy proxy policy and classifier connection settings are separate. See
[privacy and data flow](privacy.md) before sharing diagnostics.

## Release preparation

There is no automatic publishing workflow. Publishing a package, creating a
release tag, or updating a Homebrew tap requires explicit authorization. Before
any authorized release, verify the intended package name and publishing access,
review the exact archive and notices, run the full checks, and verify the result
independently after publication. A local package or successful CI run is not proof
of a public release.

## GitHub review and CI rules

`.github/CODEOWNERS` identifies `@asvirts` as code owner. The JSON files in
[`.github/rulesets`](../.github/rulesets) are templates for `main`: the CI
ruleset lists the four macOS/Linux and Node checks, and the review ruleset
requires an approving code-owner review and resolved review threads.

Committing these files does not configure GitHub. Review the repository's actual
settings and check names before deliberately importing or changing rulesets.
The review template has no bypass actors; a solo maintainer cannot approve their
own pull request, so adjust the review approach deliberately before enforcing
it. No account-specific bypass is assumed. Repository administrators should
verify active rules and access directly in GitHub.
