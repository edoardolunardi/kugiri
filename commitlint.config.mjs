/**
 * Conventional Commits, wired to the `commit-msg` hook in `lefthook.yml`.
 *
 * `@commitlint/config-conventional` already supplies the type enum, lowercase
 * types, a non-empty subject that may not start upper-case or end in a period,
 * and a 100 character body line limit. Only the rules this repo tightens are
 * restated below.
 */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Keep subjects scannable in `git log --oneline`. The default allows 100.
    "header-max-length": [2, "always", 72],

    // One canonical spelling per area, lowercase. `kebab-case` rejects a scope
    // whose first word carries a digit (`a11y`), so `lower-case` it is.
    "scope-case": [2, "always", "lower-case"],

    // Without the blank line git folds the body into the subject.
    "body-leading-blank": [2, "always"],
    "footer-leading-blank": [2, "always"],
  },
};
