/**
 * @type {import('semantic-release').GlobalConfig}
 */
export default {
  branches: ["main"],
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      {
        releaseRules: [
          // Pre-1.0: breaking changes → minor (not major)
          { breaking: true, release: "minor" },
          // Explicit major: use "feat(major):" or "fix(major):" when ready for 1.0
          { type: "feat", scope: "major", release: "major" },
          { type: "fix", scope: "major", release: "major" },
        ],
      },
    ],
    "@semantic-release/release-notes-generator",
    "@semantic-release/npm",
    "@semantic-release/github",
  ],
};
