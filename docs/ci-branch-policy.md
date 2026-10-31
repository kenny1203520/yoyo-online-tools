# CI and branch policy

`develop` and the production branch (`master`; `main` is accepted during the
transition) use the same validation workflow. A pull request or push to any of
these branches runs the same checks; the production branch does not have a
weaker path.

## Required order

The workflow starts with the local CodeQL CLI scan. Only after that job passes
can the normal validation, container checks, and GitHub CodeQL analysis run.
Publishing is blocked until all of them pass.

The required checks are:

- `Validate and publish / Local CodeQL`
- `Validate and publish / validate`
- `Validate and publish / container (amd64)`
- `Validate and publish / container (arm64)`
- `Validate and publish / CodeQL`

The `validate` job runs lint, type checking, unit tests, the production build,
and the browser test suite. Both container architectures run the same smoke
test. The local and GitHub CodeQL jobs use the same
`.github/codeql/codeql-config.yml`.

## Pull requests and protection

For both `develop` and `master`:

- direct pushes, force pushes, and branch deletion are disabled;
- changes enter through pull requests only;
- every required check above must pass, including the latest commit check;
- stale approvals are dismissed after new commits;
- at least one approving review is required;
- administrators do not bypass required checks.

Use squash merge for feature pull requests. Release pull requests from
`develop` to `master` are subject to the same checks and review rules. The
repository ruleset should list both branches explicitly so a future default
branch change cannot silently remove protection.

## Publishing

Container publishing is allowed only from `master`/`main` or a version tag.
`develop` is continuously validated but never publishes a production image.
Version tags must use the existing `vX.Y.Z` convention.
