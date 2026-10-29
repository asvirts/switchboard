# Native CLI worker routing

To enable native workers across projects, run the built checkout once:

```sh
node /absolute/path/to/switchboard/bin/switchboard.mjs workers init --global
```

Start a new native `claude` or `codex` session in any project. Setup writes
user-level agent definitions under `$CODEX_HOME/agents` and
`$CLAUDE_CONFIG_DIR/agents` (defaulting to `~/.codex/agents` and
`~/.claude/agents`) and adds managed blocks to their user instruction files.
Existing instructions, native settings and unrelated agents are preserved.
If Codex has a user `AGENTS.override.md`, setup uses it instead of `AGENTS.md`.
The homes passed at setup must match those used by the CLI. Project instructions
and same-named project agents can take precedence. Codex must have its native
multi-agent feature available and enabled; setup does not change `config.toml`.

Inspect or remove the global setup with the same environment variables:

```sh
node /absolute/path/to/switchboard/bin/switchboard.mjs workers status --global
node /absolute/path/to/switchboard/bin/switchboard.mjs workers uninstall --global
```

Status reads saved files; it does not verify model access or a live worker.
Uninstall preserves edited definitions and instruction blocks and reports them.
Global and project-local setup are separate; removing global setup does not
remove project files. T3 setup is also separate. If the provider homes or Codex
override file change after setup, restore the original paths before uninstalling.

To enable workers only in one project instead, run:

```sh
node /absolute/path/to/switchboard/bin/switchboard.mjs workers init
```

Start a new native `claude` or `codex` session. The command installs four
project-scoped subagent definitions per CLI and adds a managed block to
`CLAUDE.md` and `AGENTS.md` (or an existing `AGENTS.override.md`). It preserves other instruction text and refuses
to overwrite a different worker definition. It does not edit native user
settings, install a proxy, or call a model. It uses the shared `t3-policy.json`
in the Switchboard configuration directory, if present, or the shipped T3
defaults otherwise. `switchboard t3 policy` shows the effective policy.

The primary chooses a routine, standard, complex or demanding native worker
and checks its results. Claude workers use the Claude tier mappings; Codex
workers use the Codex mappings. Unlike T3, native subagents do not provide
cross-provider delegation here. Native tooling, instructions, permissions and
user choices govern whether delegation runs. Routing is instruction-driven,
not enforced. Existing CLI or organization settings may override or prevent
the selected model or effort, and the installer does not verify model access.
Some Codex versions or surfaces may not expose custom named roles; if the
native tool cannot select one, the workflow cannot route it. Claude's `/tasks`
can show the actual worker model and effort. Availability and actual behavior
require separate verification in your environment.

Setup reads a snapshot of policy when generating definitions. To change global
models or effort, uninstall global workers, edit the policy, then run global
setup again. For project setup, edit the policy, review and remove the old
Switchboard files under `.codex/agents/` and `.claude/agents/`, then rerun setup.
Files with changed content are never overwritten. If setup reports a conflict,
inspect any files already installed before retrying. To remove the project setup, delete those
Switchboard worker files and remove the `switchboard:workers` marked block from
each instruction file. Other instructions and native settings are yours.

This feature is separate from the classifier-based launchers documented in
[native CLI integration](native-cli.md). It does not change the parent model,
perform a classifier call, or provide cross-provider routing. Native sessions
can still be subject to provider usage charges.
