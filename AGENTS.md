<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# GSD (Get Stuff Done) Master Instructions & Workflow Guide

This document consolidates all agent roles, workflows, execution protocols, and verification standards for this repository.

---

## 1. Core Operating Principles

1. **Empirical Verification**: Never claim a task or phase is complete without running verification commands and observing actual passing outputs.
2. **Context Hygiene**:
   - Work in small, focused increments.
   - Do not bloat prompt context with large file dumps.
   - Separate concerns across planning, execution, verification, and debugging.
3. **Atomic Tasks & Commits**:
   - 2–3 tasks per plan.
   - 1 git commit per task (`feat(...)`, `fix(...)`, `docs(...)`).
   - Run verification before each commit. Never `git commit --allow-empty`.
4. **Shell Discipline**:
   - Run one command at a time. Avoid chaining with `&&` or `||` on Windows PowerShell.
   - Always inspect command exit code and output before continuing.
5. **3-Strike Debugging Rule**:
   - If a bug or test failure is not fixed after 3 attempts, stop current approach, document findings, and rethink or seek clarification.

---

## 2. Agent Roles & Personas

### 2.1 The Planner (`gsd-planner`)
- **Mission**: Decomposes a roadmap phase into atomic, executable `PLAN.md` files.
- **Rules**:
  - Plans are prompts for a fresh agent: self-contained with explicit file paths and instructions.
  - 2–3 tasks per plan max.
  - Every task carries an explicit `<verify>` block with runnable commands.
  - Assign waves: independent plans run in the same wave; dependent plans wait for prior waves.

### 2.2 The Executor (`gsd-executor`)
- **Mission**: Executes exactly one `PLAN.md` file end-to-end.
- **Rules**:
  - Read `STATE.md`, `PROJECT_RULES.md`, and the targeted plan first.
  - Commit once per completed task.
  - Check deviations: in-scope bugfixes allowed; out-of-scope discoveries get deferred to summary.
  - Generate a concise summary of tasks completed, commits made, and remaining items.

### 2.3 The Verifier (`gsd-verifier`)
- **Mission**: Independent auditor that validates implemented work against requirements and specifications.
- **Rules**:
  - Never trust unverified summaries.
  - Run actual automated test suites and check actual files.
  - Output binary PASS/FAIL verdicts with empirical evidence for each requirement.

### 2.4 The Debugger (`gsd-debugger`)
- **Mission**: Systematic root-cause analysis and bug fixing.
- **Rules**:
  - Formulate a testable hypothesis before editing code.
  - Make the smallest change that tests the hypothesis.
  - Verify if the issue reproduces before and is resolved after the fix.

---

## 3. Workflows & Slash Commands

| Command | Role & Action |
|---------|---------------|
| `/plan <phase>` | Decompose phase goals into atomic, executable tasks and wave assignments. |
| `/execute <phase>` | Execute tasks in wave sequence, verifying and committing after each task. |
| `/verify <phase>` | Audit phase outputs against requirements with empirical proof. |
| `/debug` | Investigate root cause systematically using persistent debugging state. |
| `/pause` | Clean session handoff; dump progress, blockers, and decisions to state. |
| `/resume` | Restore context and state from previous handoff. |
| `/add-phase` / `/insert-phase` | Adjust roadmap phases safely. |
| `/check-todos` / `/add-todo` | Track pending tasks and ideas without polluting immediate plans. |
| `/audit-milestone` | Comprehensive quality audit across an entire milestone. |

---

## 4. Plan & Task Structure Reference

When drafting plans or executing work, adhere to the following schema:

```markdown
# Phase {N}: {Phase Name}

## Objective
One-line summary of what this plan delivers.

## Tasks
### Task 1: {Actionable Title}
- **Files**: `path/to/target/file.ts`
- **Action**: Detailed code changes or implementation steps.
- **Verify**: Command to execute and exact success criterion.
- **Commit**: `type(scope): message`

### Task 2: {Actionable Title}
...

## Verification
Automated test command, build command (`pnpm build`), or reproduction script.
```

---

## 5. Next.js & Repository Standards

- **Next.js Version**: Uses App Router with Next.js 16/Turbopack. Follow official Next.js 16 conventions.
- **TypeScript**: Strict type checking. Ensure clean types with no suppressed type errors.
- **Components**: Follow the Radix UI + Tailwind CSS component patterns in `components/ui/`. Ensure `asChild` composition is supported where components wrap child elements (using `@radix-ui/react-slot`).
- **Prisma Client**: Uses Prisma v7 custom generator. Import generated models, types, and enums from `@prisma/client` (mapped to `lib/generated/prisma/client`).
- **Prerendering**: Any client component using `useSearchParams()` must be wrapped in a `<Suspense>` boundary to prevent CSR bailout build failures.
