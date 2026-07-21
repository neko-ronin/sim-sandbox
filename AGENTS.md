# Sim Sandbox Agent Instructions

## GitHub account preflight (required)

This repository belongs to the GitHub account `neko-ronin`.

Before doing any project work, first run this read-only check:

```bash
gh api user --jq .login
```

The required result is exactly:

```text
neko-ronin
```

If GitHub CLI is unauthenticated, its credential is invalid, or another account
is active, stop before doing project work and direct the user to authenticate or
switch accounts. Do not log out, switch accounts, or start an interactive login
without the user's approval because GitHub authentication is shared across
repositories.

Preferred commands for the user:

```bash
# If the account is already stored by gh:
gh auth switch -h github.com -u neko-ronin

# If the account has not been added yet:
gh auth login -h github.com -p https -w
```

After a switch or login, rerun `gh api user --jq .login` and begin work only
after it returns `neko-ronin`.

Use this repository-local commit identity:

```text
user.name  = neko-ronin
user.email = 286168278+neko-ronin@users.noreply.github.com
```

Do not change global Git identity settings for this project.
