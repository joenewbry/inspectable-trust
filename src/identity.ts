// Walk-up resolver for .trust/ folders.
//
// Given a directory, walk upward until we find the closest ancestor with a
// .trust/ subfolder. That's the identity boundary. A nested .trust/ overrides
// for that subtree. Same mental model as .gitignore / .git.
//
// The slug is the name of the folder containing the .trust/ — so
//   /home/joe/.trust/  → slug "joe" (or "" if at root, we use the parent)
//   ~/personas/stanford-healthcare/.trust/  → slug "stanford-healthcare"

import { existsSync, statSync } from "node:fs";
import { dirname, basename, resolve } from "node:path";

export interface IdentityRoot {
  /** Absolute path to the .trust/ folder. */
  trustDir: string;
  /** Absolute path to the folder containing .trust/. */
  identityDir: string;
  /** Slug derived from identityDir's basename. Falls back to "self" for $HOME. */
  slug: string;
}

/**
 * Walk upward from `start` until we find a directory containing a .trust/ subfolder.
 * Returns null if none found. Stops at filesystem root.
 */
export function findIdentityRoot(start: string): IdentityRoot | null {
  let current = resolve(start);

  // Guard against infinite loop on weird filesystems.
  for (let i = 0; i < 200; i++) {
    const candidate = resolve(current, ".trust");
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      const identityDir = current;
      const folderName = basename(identityDir);
      // If the .trust/ is at $HOME, the basename is the username; treat as "self"
      // unless explicitly named (which would mean we're in ~/personas/<slug>/.trust/).
      const slug = folderName.startsWith(".") || folderName === "" ? "self" : folderName;
      return { trustDir: candidate, identityDir, slug };
    }

    const parent = dirname(current);
    if (parent === current) {
      // Reached filesystem root.
      return null;
    }
    current = parent;
  }

  return null;
}

/**
 * Like findIdentityRoot but explicitly walks the chain and returns ALL matches,
 * outermost first. Useful for debugging nesting.
 */
export function findIdentityChain(start: string): IdentityRoot[] {
  const found: IdentityRoot[] = [];
  let current = resolve(start);

  for (let i = 0; i < 200; i++) {
    const candidate = resolve(current, ".trust");
    if (existsSync(candidate) && statSync(candidate).isDirectory()) {
      const folderName = basename(current);
      const slug = folderName.startsWith(".") || folderName === "" ? "self" : folderName;
      found.push({ trustDir: candidate, identityDir: current, slug });
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return found;
}
