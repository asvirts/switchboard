<p align="center">
  <img src="assets/switchboard-icon.png" alt="Switchboard icon" width="180" height="180">
</p>

<h1 align="center">Switchboard</h1>

Switchboard helps your primary agent delegate work to an appropriate model in
T3 Code. Keep talking to your chosen Codex or Claude model while it scopes
subtasks, selects workers, checks their results, and escalates when needed.

Every substantive task goes to at least one worker. The primary coordinates,
verifies, and combines results; simple acknowledgments and logistics stay direct.
It assigns independent work in parallel and dependent work in sequence, with
clear ownership for each worker.

The primary chooses a model tier and provider family for each task. It can use
Codex or Claude workers, including a mix across tasks. For example, it might
choose 10 Luna workers for independent routine tasks or 2 Sonnet workers when
the work calls for that structure. Those counts are illustrative, not a measured
efficiency comparison or fixed rule. Context duplication, coordination, and
retries affect the tradeoffs; savings and result quality are not guaranteed.

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
follow the installed instructions, and Switchboard does not intercept
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

To enable routing for T3 projects on this machine, run the built checkout using
its actual absolute path:

```sh
node /absolute/path/to/switchboard/bin/switchboard.mjs t3 init --global
```

Start a new T3 conversation in any project. Setup adds a short, T3-scoped pointer
to your Codex and Claude user instruction files and creates a shared worker policy
if needed. Existing instructions and policy are preserved. Project instructions
and explicit requests can override the default. Keep the checkout in place and
rebuild after source changes: the installed workflow references its executable.

To enable routing only for one project instead, run the same command without
`--global` from that project's directory. The [T3 guide](docs/t3.md) covers
global status, removal, custom provider homes, and the limits of instruction-based
worker safeguards.

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
package check may download public dependencies. Cost, quality, and provider
coverage have not been benchmarked. Live model tests consume quota and require
explicit authorization.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the source map and checks. The
original classifier-based CLI routing remains available as a separate legacy
workflow; its architecture and setup are documented in [routing](docs/routing.md)
and [classifier connections](docs/classifiers.md).

## Attribution and license

This fork builds on [Switchboard by Ruban](https://github.com/ruban-24/switchboard).
The project is licensed under [Apache-2.0](LICENSE). See [NOTICE](NOTICE) and
[third-party notices](THIRD_PARTY_NOTICES.md) for attribution.
