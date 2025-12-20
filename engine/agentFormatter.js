// engine/agentFormatter.js
export function formatForAgent(result) {
  if (!result || !Array.isArray(result.items) || result.items.length === 0) {
    return "❌ No information available.";
  }

  let output = "";

  for (const item of result.items) {
    const e = item.entry || {};

    if (item.kind === "test_for_term" || item.kind === "test") {
      // pick canonical name field if present
      const name = e.testName || e.normalized_name || e.name || "Unnamed Test";
      output += `${name}\n`;

      if (e.consumerPrice || e.price) output += `💰 ₹${e.consumerPrice ?? e.price}\n`;

      const tat = e.labTatString || (e.appTatInformation && e.appTatInformation.tat_string) || e.tat;
      if (tat) output += `⏱ ${tat}\n`;

      output += `🍽 Fasting: ${e.isFastingRequired ? "Required" : "Not required"}\n`;

      if (e.requisite && e.requisite !== "No special preparation") {
        output += `ℹ️ Preparation: ${e.requisite}\n`;
      }

      const params = Array.isArray(e.groupTests) ? e.groupTests : (Array.isArray(e.parameters) ? e.parameters : []);
      if (params && params.length) {
        output += `\nIncludes parameters:\n`;
        params.slice(0, 8).forEach(p => output += `• ${p}\n`);
        if (params.length > 8) output += `• And more parameters\n`;
      }

      // Always highlight if this test is also included as a parameter in another test, even if both are present
      if (item.parameterCoverage && item.parameterCoverage.length) {
        output += `\n🔗 Also included as a parameter in: ${item.parameterCoverage.join(", ")}\n`;
      }

      // If this is a profile not available, show its component tests and missing ones
      if (item.reason === "profile_not_available") {
        output += `\n⚠️ Profile not available as a package.`;
        if (item.profileComponents && item.profileComponents.length) {
          output += ` Showing individual tests:\n`;
          item.profileComponents.forEach(t => {
            const tName = t.testName || t.normalized_name || t.name || "Unnamed Test";
            output += `• ${tName}\n`;
          });
        } else {
          output += ` No individual tests found.\n`;
        }
        if (item.missingProfileComponents && item.missingProfileComponents.length) {
          output += `Missing tests: ${item.missingProfileComponents.join(", ")}\n`;
        }
      }

      if (item.reason) {
        output += `\nMatched by: ${item.reason}\n`;
      }

      output += `\n`;
      continue;
    }

    if (item.kind === "package") {
      const name = e.packageName || e.name || "Unnamed Package";
      output += `${name}\n`;

      if (e.consumerPrice || e.price) output += `💰 ₹${e.consumerPrice ?? e.price}\n`;

      const tat = e.labTatString || (e.appTatInformation && e.appTatInformation.tat_string) || e.tat;
      if (tat) output += `⏱ ${tat}\n`;

      output += `🍽 Fasting: ${e.isFastingRequired ? "Required" : "Not required"}\n`;

      const tests = Array.isArray(e.testsMetadata) ? e.testsMetadata.map(t=>t.testName || t.normalized_name) : (e.includes || []);
      if (tests && tests.length) {
        output += `\nIncludes tests:\n`;
        tests.slice(0, 8).forEach(t => output += `• ${t}\n`);
        if (tests.length > 8) output += `• And more tests\n`;
      }

      // matched info coming from searchEngine
      if (item.matchedTests && item.matchedTests.length) {
        output += `\n🔎 Contains: ${item.matchedTests.slice(0,5).join(", ")}${item.matchedTests.length > 5 ? ", ..." : ""}\n`;
        if (item.coverage !== undefined) output += `Coverage: ${(item.coverage*100).toFixed(0)}%\n`;
        if (item.precision !== undefined) output += `Precision: ${(item.precision*100).toFixed(0)}%\n`;
      }

      output += `\n`;
      continue;
    }

    // fallback: unknown kind -> print raw JSON snippet
    output += `Unknown item: ${JSON.stringify(item)}\n\n`;
  }

  if (result.note) output += `\nℹ️ ${result.note}\n`;

  return output.trim();
}
