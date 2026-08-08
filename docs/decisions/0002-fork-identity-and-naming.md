# 0002 — Fork identity and naming

- **Status:** Accepted
- **Date:** 2026-08-08

## Context

This repository is a fork of [StackEdit](https://github.com/benweet/stackedit), which is licensed under Apache License 2.0. Section 6 of that licence grants no permission to use the licensor's product names, with one exception: use "as required for reasonable and customary use in describing the origin of the Work".

Shipping a Debian package whose product name, package name and application-menu entry all read "StackEdit" would be using the name to identify a different product, which is outside that exception.

## Decision

The product is **StackMark**, described as a fork of StackEdit.

**Attribution.** `LICENSE` stays as upstream published it, unchanged. Upstream ships no `NOTICE` file, so there is nothing to reproduce. The README states the fork relationship, names the upstream author and repository, and disclaims affiliation.

**What is renamed and what is not.** Only work written for this fork is renamed: `apps/`, `packages/`, the container tooling, and the release artifacts. The upstream v4 tree — `src/`, `static/`, `server/`, `chart/`, `chrome-app/`, `config/`, `build/` — keeps its original names and identifiers. Renaming upstream's own files would misrepresent whose work they are, which is the opposite of what the attribution clauses ask for.

**Package naming.** `productName` is the lowercase `stackmark`, because Tauri derives three things from it: the artifact file name verbatim, the Debian `Package` field as its kebab-case, and the binary name. A capitalised product name yields `StackMark_0.1.0-stage0_amd64.deb` and a `stack-mark` package, neither of which follows Debian convention.

The display name is restored where a user actually sees it: a `desktopTemplate` sets `Name=StackMark` for the application menu, and the window title is set independently. `mainBinaryName` gives `/usr/bin/stackmark` rather than a suffixed binary.

The reverse-DNS identifier is `id.or.oo.stackmark`, from the `oo.or.id` domain the author controls. The trailing component names the application; a `.desktop` suffix was considered and rejected, since that is the launcher file's extension rather than part of the identifier.

Resulting artifact:

```
stackmark_0.1.0-stage0_amd64.deb
  Package: stackmark        Depends: libwebkit2gtk-4.1-0, libgtk-3-0
  /usr/bin/stackmark        menu entry: StackMark
```

## Consequences

The name "StackEdit" still appears throughout this repository, in the retained upstream tree, in the README attribution, and in the Stage 0 records that describe the work as it happened. That is the permitted descriptive use, and removing it would weaken the attribution rather than strengthen it.

Anything published under this fork's name — a website, a package registry entry, an application listing — needs the same treatment: StackMark as the product, StackEdit named only as the origin.
