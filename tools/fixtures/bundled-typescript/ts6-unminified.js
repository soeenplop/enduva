// Fixture for scripts/audit-bundled-typescript.mjs: an excerpt in the shape of an unminified
// TypeScript 6 compiler build (lib/typescript.js), as a tool would vendor it. Not executed.
// src/compiler/corePublic.ts
var versionMajorMinor = "6.0";
var version = "6.0.3";

// src/compiler/diagnosticInformationMap.generated.ts
function diag(code, category, key, message) {
  return { code, category, key, message };
}
var Diagnostics = {
  Unterminated_string_literal: diag(1002, 1 /* Error */, "Unterminated_string_literal_1002", "Unterminated string literal."),
  Identifier_expected: diag(1003, 1 /* Error */, "Identifier_expected_1003", "Identifier expected."),
};

module.exports = { version, versionMajorMinor, Diagnostics };
