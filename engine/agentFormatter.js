// engine/agentFormatter.js
export function formatForAgent(result) {
  if (!result || !Array.isArray(result.items) || result.items.length === 0) {
    return "❌ No information available.";
  }

  let output = "";

  for (const item of result.items) {
    const e = item.entry || {};

    if (item.kind === "sop" || item.kind === "process" || item.kind === "product") {
      const name = e.name || "Knowledge";
      output += `🔎 ${name}\n`;
      if (e.content) output += `${e.content}\n`;
      output += `\n`;
    } else if (item.kind === "test_for_term" || item.kind === "test") {
      // pick canonical name field if present
      const name = e.testName || e.normalized_name || e.name || "Unnamed Test";
      output += `${name}`;
      if (e.id || e.orangeTestId) output += ` (ID: ${e.id ?? e.orangeTestId})`;
      if (e.category) output += ` [Dept: ${e.category}]`;
      output += `\n`;

      // Show price if available
      if (e.consumerPrice || e.price) output += `💰 ₹${e.consumerPrice ?? e.price}\n`;

      // Show TAT (turnaround time)
      const tat = e.labTatString || (e.appTatInformation && e.appTatInformation.tat_string) || e.tat;
      if (tat) output += `⏱ ${tat}\n`;

      // Show method, sample type, department, tags if available
      if (e.method) output += `🧪 Method: ${e.method}\n`;
      if (e.sampleType) output += `🧫 Sample: ${e.sampleType}\n`;
      if (e.department) output += `🏥 Department: ${e.department}\n`;
      if (Array.isArray(e.tags) && e.tags.length) output += `🏷 Tags: ${e.tags.join(", ")}\n`;

      // Show container/vial info if available
      if (e.container) {
        try {
          const containers = typeof e.container === 'string' ? JSON.parse(e.container) : e.container;
          if (Array.isArray(containers) && containers.length) {
            output += `🧪 Vial: `;
            containers.forEach(c => {
              output += `${c.vialName || ''}${c.vialColor ? ' (' + c.vialColor + ')' : ''} `;
            });
            output += `\n`;
          }
        } catch {}
      }

      // Fasting requirement (only show if field exists for synthetic params to avoid misleading defaults)
      if (e.isFastingRequired !== undefined) output += `🍽 Fasting: ${e.isFastingRequired ? "Required" : "Not required"}\n`;

      // If this is a synthetic parameter, show parent info and a note
      if (e.isSyntheticParameter || item.reason === "parameter_explicit") {
        if (e.syntheticParameterOf) output += `🔗 Parameter of: ${e.syntheticParameterOf}\n`;
        output += `ℹ️ Note: This is a parameter (not a standalone composite test).\n`;
      }

      // Preparation instructions
      if (e.requisite && e.requisite !== "No special preparation") {
        output += `ℹ️ Preparation: ${e.requisite}\n`;
      }

      // Show test code/id if available
      if (e.testCode) output += `🆔 Test Code: ${e.testCode}\n`;
      if (e.testId) output += `🆔 Test ID: ${e.testId}\n`;

      // Show popularity/frequency if available
      if (e.frequency) output += `⭐ Popularity: ${e.frequency}\n`;

      // Show included parameters
      const params = Array.isArray(e.groupTests) ? e.groupTests : (Array.isArray(e.parameters) ? e.parameters : []);
      if (params && params.length) {
        output += `\nIncludes parameters:\n`;
        params.slice(0, 8).forEach(p => output += `• ${p}\n`);
        if (params.length > 8) output += `• And more parameters (truncated)\n`;
      }

      // Highlight if this test is also included as a parameter in another test
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
            output += `• ${tName}`;
            if (t.method) output += ` (Method: ${t.method})`;
            if (t.sampleType) output += ` (Sample: ${t.sampleType})`;
            output += `\n`;
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
    } else if (item.kind === "package") {
      // Package output: plain, copy-paste friendly block — only name, price, TAT, and full test list.
      const name = e.packageName || e.name || "Unnamed Package";
      output += `${name}\n`;

      // Show price if available
      if (e.consumerPrice || e.price) output += `💰 ₹${e.consumerPrice ?? e.price}\n`;

      // Show TAT (turnaround time)
      const tat = e.labTatString || (e.appTatInformation && e.appTatInformation.tat_string) || e.tat;
      if (tat) output += `⏱ ${tat}\n`;

      // Full test list (prefer explicit `tests` array; fall back to testsMetadata names)
      const tests = Array.isArray(e.tests) && e.tests.length ? e.tests : (Array.isArray(e.testsMetadata) ? e.testsMetadata.map(t => t.testName || t.name || t.normalized_name).filter(Boolean) : []);
      if (tests && tests.length) {
        output += `\nTests covered:\n`;
        tests.forEach(t => output += `• ${t}\n`);
      }

      output += `\n`;

    } else if (item.kind === "package_group") {
      // entry.matches = [{ key, title, aliases, snippet }]
      const title = e.name || "Package group";
      output += `🔎 ${title}\n`;
      if (Array.isArray(e.matches) && e.matches.length) {
        output += `Found ${e.matches.length} related packages:\n`;
        e.matches.forEach(m => {
          output += `• ${m.title} (${m.aliases && m.aliases.length ? m.aliases.join(', ') : 'no aliases'})\n`;
          if (m.snippet) output += `  ${m.snippet}\n`;
        });
      } else {
        output += `No matching packages found.`;
      }
      output += `\n`;
    } else {
      // fallback: unknown kind -> print raw JSON snippet
      output += `Unknown item: ${JSON.stringify(item)}\n\n`;
    }
  }

  if (result.note) output += `\nℹ️ ${result.note}\n`;

  return output.trim();
}
