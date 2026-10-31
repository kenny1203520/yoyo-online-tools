# CodeQL

This repository analyzes JavaScript and TypeScript source files and GitHub Actions workflows with the `security-extended` query suite. The same configuration is used by the local CLI and the GitHub Actions workflow.

## Local analysis

Install the [CodeQL CLI](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/scan-from-the-command-line) and add its executable to `PATH`. Node.js 24 is required for extracting this repository's TypeScript files.

Run the scan from the repository root:

```bash
npm run codeql
```

The script creates temporary CodeQL databases, analyzes both supported languages, and removes the databases when it finishes. SARIF results are written to `.codeql/javascript-typescript.sarif` and `.codeql/actions.sarif`; `.codeql/` is ignored by Git. If the CLI executable is not named `codeql` or is not on `PATH`, set `CODEQL_CLI` to its full executable path.

## GitHub Actions

The `Validate and publish` workflow runs the local CLI scan first. The regular
validation, container checks, and GitHub-hosted CodeQL analysis depend on that
job, so GitHub CodeQL cannot hide a local CLI failure. The local and hosted
scans use the same query configuration.

The `Validate and publish` workflow calls the CodeQL scan for every pull request and push. It runs lint, type checking, unit tests, production build, browser tests, container checks, and CodeQL; publishing waits for the validation, container, and CodeQL jobs. The reusable `CodeQL` workflow also supports manual dispatch and runs weekly on Monday.

To block merges until CI passes, enable required status checks for
`Validate and publish / Local CodeQL`, `Validate and publish / validate`,
`Validate and publish / container (amd64)`, `Validate and publish / container
(arm64)`, and `Validate and publish / CodeQL` on both `develop` and
`master` (or `main` during the transition) in a GitHub ruleset. GitHub
requires each workflow check to run once before it can be selected as a
required check. See [the branch policy](ci-branch-policy.md) for the complete
review and merge rules.
