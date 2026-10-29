# Security

Security fixes target the current source branch. This fork has not established
a published release or backport policy.

## Report a vulnerability

If private reporting is enabled, use **Report a vulnerability** on
[the fork's Security page](https://github.com/asvirts/switchboard/security).
Otherwise, open an issue requesting a private contact channel without including
exploit details, keys, or private data. There is no guaranteed response or
resolution time.

Include affected versions, a minimal synthetic reproduction, and the impact.
Do not post API keys, OAuth links, native credentials, full transcripts, or
private repository content in public issues.

## Data handling

T3 routing reads a task from stdin and returns it in a worker delegation plan.
Switchboard does not persist the task or call a classifier or model in this
mode, but T3 and the native harness may retain transcripts and send the task to
the selected provider.

In the retained legacy mode, the local proxy forwards native inference to the
tool's provider. Extracted task text is also sent to the selected Jev provider
for classification, even when local raw-prompt capture is disabled. Native CLI
transcripts and provider data retention are separate from Switchboard's local
history settings.

Interactive `switchboard init` saves classifier credentials in `connection.json`
beside the personal policy, with owner-only read/write permissions. The key is
plaintext, so protect that file and its backups. Environment overrides are also
supported; only the source-checkout commands load `.env.local`. Keep credentials
out of `policy.json` and Git. Classifier keys are removed from the native child
environment. The proxy binds to loopback with a per-launch secret; this is not
intended to protect against other code already running as the same local user.

Before sharing diagnostics, inspect and redact them. See [privacy and data
flow](docs/privacy.md) for recipients and storage, and the [native CLI guide](docs/native-cli.md)
for supported execution modes and current limitations.
