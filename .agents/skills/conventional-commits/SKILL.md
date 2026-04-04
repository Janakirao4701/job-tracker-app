---
name: conventional-commits
description: Generates semantic commit messages following the Conventional Commits specification with proper types, scopes, breaking changes, and footers. Use when users request "write commit message", "conventional commit", "semantic commit", or "format commit".
---

Write standardized, semantic commit messages that enable automated versioning and changelog generation.

## Core Workflow
1. **Analyze changes**: Review staged files and modifications
2. **Determine type**: Select appropriate commit type (feat, fix, etc.)
3. **Identify scope**: Optional component/module affected
4. **Write description**: Concise summary in imperative mood
5. **Add body**: Optional detailed explanation
6. **Include footer**: Breaking changes, issue references

## Commit Message Format
```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

## Commit Types
| Type | Description | Semver | Example |
|------|-------------|--------|---------|
| `feat` | New feature | MINOR | `feat: add user authentication` |
| `fix` | Bug fix | PATCH | `fix: resolve login redirect loop` |
| `docs` | Documentation only | - | `docs: update API reference` |
| `style` | Formatting, whitespace | - | `style: fix indentation in utils` |
| `refactor` | Code change, no feature/fix | - | `refactor: extract validation logic` |
| `perf` | Performance improvement | PATCH | `perf: optimize database queries` |
| `test` | Adding/fixing tests | - | `test: add unit tests for auth` |
| `build` | Build system, dependencies | - | `build: upgrade to Node 20` |
| `ci` | CI/CD configuration | - | `ci: add GitHub Actions workflow` |
| `chore` | Maintenance tasks | - | `chore: update .gitignore` |
| `revert` | Revert previous commit | - | `revert: undo feature flag change` |

### Good Examples
```bash
feat: add email verification flow
fix: prevent duplicate form submissions
refactor: extract payment processing to service
perf: cache user preferences in memory
docs: add API authentication examples
```
