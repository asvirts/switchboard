<p align="center">
  <img src="assets/switchboard-icon.png" alt="Switchboard icon" width="180" height="180">
</p>

<h1 align="center">Switchboard</h1>

Switchboard helps your primary agent delegate work to an appropriate model in
T3 Code. Keep talking to your chosen Codex or Claude model while it scopes
subtasks, selects workers, checks their results, and escalates when needed.

The goal is to use the smallest model likely to complete each task. Model
selection is a judgment, and savings and result quality have not been measured.

## How it works

1. The primary agent considers the request and relevant project context.
2. It chooses a tier for a bounded task. Switchboard maps that tier to your
   configured model and checks it against T3's available providers and options.
3. The primary sends the task to a T3 worker, reviews its work and checks, and
   can escalate to a stronger tier when the worker cannot complete it.

The default tiers are:

| Task tier | Codex worker | Claude worker |
| --- | --- | --- |
| Routine | Luna | Haiku |
| Standard | Terra | Sonnet |
| Complex | Sol | Opus |
| Demanding | Astra | Fable |

T3 mode uses the primary agent's judgment, so it does not require Jev or a
separate classifier key. It is opt-in and instruction-driven: the primary must
follow the installed project instructions, and Switchboard does not intercept
requests or run workers itself. T3 and the native harness own authentication,
sandboxing, approvals, and worker execution.

## Get started

You need Node.js 22.18 or newer on macOS or Linux and T3 Code with an available
Codex or Claude provider. Clone and build this checkout:

```sh
git clone https://github.com/asvirts/switchboard.git
cd switchboard
npm ci
npm run build
```

From the project where you want worker routing, run the built checkout using its
actual absolute path:

```sh
node /absolute/path/to/switchboard/bin/switchboard.mjs t3 init
```

Start a new T3 conversation in that project. Setup adds a managed block to the
project's `AGENTS.md` and creates a personal T3 policy if one does not already
exist. Existing project instructions and policy are preserved. Keep the
checkout in place and rebuild after source changes: the installed instructions
reference its executable.

The upstream npm package does not include this fork's T3 workflow. See the
[T3 guide](docs/t3.md) for policy configuration, routing details, and privacy.

## Development

```sh
npm ci
npm run build
npm run check
npm test
npm run test:package
```

The ordinary test suite uses synthetic providers and needs no AI keys. The
package check may download public dependencies. Live model tests consume quota
and require explicit authorization; the T3 workflow has not been validated with
a live worker.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the source map and checks. The
original classifier-based CLI routing remains available as a separate legacy
workflow; its architecture and setup are documented in [routing](docs/routing.md)
and [classifier connections](docs/classifiers.md).

## Attribution and license

This fork builds on [Switchboard by Ruban](https://github.com/ruban-24/switchboard).
The project is licensed under [Apache-2.0](LICENSE). See [NOTICE](NOTICE) and
[third-party notices](THIRD_PARTY_NOTICES.md) for attribution.
