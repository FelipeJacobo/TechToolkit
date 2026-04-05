/**
 * test_analyze_code.ts — Prueba de la herramienta analyze_code
 *
 * Uso:
 *   OPENAI_API_KEY=sk-xxx npx tsx test_analyze_code.ts
 */
import { analyzeCode } from "../src/tools/analyzeCode.js";

const sampleCode = `
// sample.js - Example code with intentional issues
function processUser(user) {
  if (user != null) {
    var name = user.name
    var email = user.email;
    console.log("User: " + user.name);
    
    // SQL injection vulnerability
    var query = "SELECT * FROM users WHERE email = '" + email + "'";
    
    // Potential null dereference
    var age = user.profile.age;
    
    // Magic number
    if (age > 18) {
      // Unused variable
      var temp = name.toUpperCase();
      
      // Deep nesting
      if (email.includes("@")) {
        if (email.length > 5) {
          if (name.length > 0) {
            console.log("Valid user");
          }
        }
      }
    }
  }
}
`;

async function main() {
  console.log("🔍 Analyzing code...\n");
  
  const result = await analyzeCode({
    files: [
      { path: "sample.js", content: sampleCode }
    ],
    language: "javascript",
    focus: "Security and code quality",
    maxIssues: 20,
  });

  if (!result.ok) {
    console.error("❌ Analysis failed:", result.error);
    process.exit(1);
  }

  const analysis = result.result;

  console.log(`📊 Score: ${analysis.score}/100`);
  console.log(`📁 Files: ${analysis.filesAnalyzed}`);
  console.log(`📝 Lines: ${analysis.linesOfCode}`);
  console.log(`\n📋 Summary: ${analysis.summary}`);

  console.log("\n⚠️  Issues:");
  analysis.issues.forEach((issue, i) => {
    const severity = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵", info: "⚪" };
    const color = severity[issue.severity] ?? "⚪";
    console.log(`  ${color} ${issue.type.toUpperCase()} [${issue.severity}] - ${issue.title}`);
    if (issue.line) console.log(`     Line: ${issue.line}`);
    console.log(`     ${issue.description}`);
    if (issue.suggestion) console.log(`     → ${issue.suggestion}`);
    console.log();
  });

  console.log("💡 Suggestions:");
  analysis.suggestions.forEach((s, i) => {
    console.log(`  [${s.category}] ${s.description} (${s.impact})`);
    console.log();
  });

  // Full JSON output
  console.log("\n📦 Full JSON:");
  console.log(JSON.stringify(analysis, null, 2));
}

main().catch(console.error);
