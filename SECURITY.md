# Security policy

Please do not open a public Issue for a vulnerability or accidentally exposed
credential. Use GitHub's private vulnerability reporting for this repository.

SkillHone treats model credentials, private prompts, repository paths, and raw
Agent trajectories as sensitive. Reports and examples must use public or
synthetic inputs and should be checked with gitleaks before publication.

The local Web server binds to `127.0.0.1` by default. Reporting follows the
saved trigger policy. SkillHone never pushes; a passing PR is merged locally
without another prompt only when the user has explicitly selected the
automatic merge policy.

The CLI has no third-party runtime npm dependencies. Its exact build
dependencies are pinned, and the Git source-install `prepare` step refuses to
download undeclared fallback tooling. DeepSeek Harness is installed separately
at the tested version recorded in SkillHone settings. Its native build scripts
remain a larger trust boundary and should be updated deliberately, not through
a moving package tag.

Pull requests run dependency review, npm advisory and registry-signature
checks, Python dependency auditing, and CodeQL. The Harness dependency tree is
resolved with lifecycle scripts disabled for auditing. Maintainers can repeat
the local checks with:

```bash
pnpm audit --audit-level=low --registry=https://registry.npmjs.org/
npm audit signatures --registry=https://registry.npmjs.org/
gitleaks dir . --no-banner --redact
gitleaks git . --no-banner --redact
```
