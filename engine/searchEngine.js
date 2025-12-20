// engine/searchEngine.js
import { fetchAggregatedSearch } from "./apiEngine.js";

/* ---------------------------
   Config & helpers
   --------------------------- */

const CITY_MAP = {
  mumbai: "MUM", mum: "MUM", bom: "MUM",
  delhi: "DEL", gurugram: "DEL", gurgaon: "DEL",
  noida: "NOA", noa: "NOA",
  bangalore: "BLR", bengaluru: "BLR", blr: "BLR",
  hyderabad: "HYD", hyd: "HYD"
};

const STOPWORDS = ["in", "for", "test", "tests", "check", "blr", "mumbai", "mum", "delhi", "del", "hyderabad", "hyd", "noida", "noa", "bangalore", "blr"];
const MIN_PACKAGE_COVERAGE_RATIO = 0.5;
const TOP_PACKAGES = 8;

const normalize = s => String(s || "")
  .toLowerCase()
  .replace(/[’'`“”"(),\/:+\[\]]/g, " ")
  .replace(/[^a-z0-9\s\-\.]/g, "")
  .replace(/\s+/g, " ")
  .trim();

const tokens = s => (normalize(s || "") || "")
  .split(/\s+/)
  .filter(Boolean)
  .filter(t => !STOPWORDS.includes(t));

/* ---------------------------
   Query helpers
   --------------------------- */

function detectCity(q) {
  const n = normalize(q);
  for (const k in CITY_MAP) if (n.includes(k)) return CITY_MAP[k];
  return "MUM";
}

function stripCity(q) {
  let s = String(q || "");
  for (const k in CITY_MAP) {
    const re = new RegExp("\\b" + k + "\\b", "gi");
    s = s.replace(re, " ");
  }
  return s.replace(/\s+/g, " ").trim();
}

function splitCommaPreserve(q) {
  return String(q || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);
}

/* ---------------------------
   Resolution: parameter -> test & direct test matches
   - uses API data only
   --------------------------- */

function matchTestByNameOrAlias(termTokens, test) {
  const name = normalize(test.testName || test.normalized_name || "");
  const nameTokens = tokens(name);
  // also check aliases if present
  const aliases = Array.isArray(test.testAlias) ? test.testAlias.map(a => normalize(a)) : [];
  const aliasTokens = aliases.flatMap(a => tokens(a));

  const allTokens = Array.from(new Set([...nameTokens, ...aliasTokens]));

  // every token in termTokens must match some token or be included within some token
  return termTokens.every(tt => allTokens.some(nt => nt === tt || nt.includes(tt) || tt.includes(nt)));
}

function matchTestByParameter(termTokens, test) {
  if (!Array.isArray(test.groupTests) || test.groupTests.length === 0) return false;
  // if any parameter matches all term tokens (use subset logic)
  return test.groupTests.some(param => {
    const pTokens = tokens(param);
    return termTokens.every(tt => pTokens.some(pt => pt === tt || pt.includes(tt) || tt.includes(pt)));
  });
}

function resolveTestsForTerm(termRaw, allTests) {
  const termTokens = tokens(termRaw);
  if (termTokens.length === 0) return [];

  const resolved = [];

  for (const t of allTests) {
    try {
      // direct name/alias match
      if (matchTestByNameOrAlias(termTokens, t)) {
        resolved.push({ test: t, reason: "name" });
        continue;
      }
      // parameter -> test match (AEC -> CBC)
      if (matchTestByParameter(termTokens, t)) {
        resolved.push({ test: t, reason: "parameter" });
        continue;
      }
    } catch (e) {
      // defensive: ignore one bad test entry
      console.warn("resolveTestsForTerm error for test:", t, e);
    }
  }

  return resolved;
}

/* ---------------------------
   Package evaluation
   --------------------------- */

function evaluatePackageAgainstResolved(pkg, resolvedTestNamesNormalized) {
  const tests = Array.isArray(pkg.testsMetadata) ? pkg.testsMetadata : [];
  if (!tests.length) return null;

  const pkgTestNormalized = tests.map(tt => normalize(tt.testName || tt.normalized_name || ""));
  const matched = new Set();

  for (const r of resolvedTestNamesNormalized) {
    for (const pn of pkgTestNormalized) {
      if (!pn) continue;
      // match if package test normalized includes resolved normalized or equals
      if (pn === r || pn.includes(r) || r.includes(pn)) {
        matched.add(pn);
      }
    }
  }

  const matchedCount = matched.size;
  if (matchedCount === 0) return null;

  const coverage = matchedCount / (resolvedTestNamesNormalized.length || 1);
  const precision = matchedCount / (tests.length || 1);
  const extraTests = Math.max(0, tests.length - matchedCount);

  return {
    coverage,
    precision,
    matchedTests: Array.from(matched),
    matchedCount,
    totalPackageTests: tests.length,
    extraTests
  };
}

/* ---------------------------
   Main smartSearch - per-term API calls
   --------------------------- */

// Map of common profiles to their typical component tests (with aliases/abbreviations)
const COMMON_PROFILES = {
  "celiac profile": [
    ["tissue transglutaminase antibody", "ttg iga", "anti-ttg", "anti-tissue transglutaminase", "tissue transglutaminase antibody iga", "ttg"],
    ["total iga", "iga total", "immunoglobulin a", "iga"],
    ["deamidated gliadin peptide", "dgp", "gliadin peptide"],
    ["endomysial antibody", "ema", "endomysial ab"],
    ["immunoglobulin e", "ige", "total ige", "immunoglobulin e (total ige)"]
  ],
  "metabolic profile": [
    ["glucose", "blood sugar"],
    ["urea"],
    ["creatinine"],
    ["uric acid"],
    ["cholesterol", "total cholesterol"],
    ["triglycerides"],
    ["hdl", "hdl cholesterol"],
    ["ldl", "ldl cholesterol"],
    ["sgot", "ast"],
    ["sgpt", "alt"],
    ["alkaline phosphatase"],
    ["total protein"],
    ["albumin"],
    ["bilirubin"]
  ],
  "serology profile": [
    ["hiv", "hiv 1", "hiv 2", "hiv duo", "hiv tridot"],
    ["hbsag", "hepatitis b surface antigen"],
    ["hcv", "hepatitis c virus"],
    ["vdrl"],
    ["tpha"]
  ],
  "hhh test": [
    ["hemoglobin", "hb"],
    ["hematocrit", "pcv"],
    ["hb electrophoresis", "hemoglobin electrophoresis"]
  ]
  // Add more as needed
};

export async function smartSearch(userQuery) {
  const city = detectCity(userQuery);
  const cleaned = stripCity(userQuery);
  const terms = splitCommaPreserve(cleaned);

  if (!terms || terms.length === 0) {
    return { city, count: 0, items: [], note: "No information available." };
  }

  // fetch per term concurrently but independent calls
  const fetchPromises = terms.map(term =>
    fetchAggregatedSearch(city, term)
      .then(res => ({ ok: true, term, res }))
      .catch(err => {
        console.warn("[searchEngine] fetch error for term:", term, err);
        return { ok: false, term, res: { tests: [], packages: [] } };
      })
  );

  let results = await Promise.all(fetchPromises);

  // collect all tests and packages returned for any term
  const allTests = [];
  const allPackages = [];
  for (const r of results) {
    if (r && r.res) {
      if (Array.isArray(r.res.tests)) allTests.push(...r.res.tests);
      if (Array.isArray(r.res.packages)) allPackages.push(...r.res.packages);
    }
  }

  // dedupe tests by normalized name, keep cheapest if multiple
  const testByKey = new Map();
  for (const t of allTests) {
    const key = normalize(t.testName || t.normalized_name || "");
    if (!key) continue;
    if (!testByKey.has(key)) testByKey.set(key, t);
    else {
      const prev = testByKey.get(key);
      const prevPrice = Number(prev.consumerPrice || Infinity);
      const curPrice = Number(t.consumerPrice || Infinity);
      if (curPrice < prevPrice) testByKey.set(key, t);
    }
  }
  const uniqueTests = Array.from(testByKey.values());

  // Resolve tests per term (preserve request -> matched tests mapping)
  const chosenTests = []; // will hold objects { requestedTerm, test, reason }
  const seenTestKeys = new Set();

  // Track terms that could not be resolved
  const unresolvedTerms = [];
  for (const termRaw of terms) {
    const resolved = resolveTestsForTerm(termRaw, uniqueTests); // returns array of {test,reason}
    // For generic queries (single word, e.g., 'pylori', 'hiv', 'dengue'), add all unique variants; for others, keep first unique test.
    const isGeneric = terms.length === 1 && tokens(termRaw).length === 1;
    let found = false;
    for (const r of resolved) {
      const key = normalize(r.test.testName || r.test.normalized_name || "");
      if (seenTestKeys.has(key)) continue;
      chosenTests.push({ requestedTerm: termRaw, test: r.test, reason: r.reason });
      seenTestKeys.add(key);
      found = true;
      if (!isGeneric) break; // only break for non-generic queries
    }
    if (!found) {
      unresolvedTerms.push(termRaw);
    }
  }

  // For unresolved terms, check if they match a common profile
  for (const term of unresolvedTerms) {
    const normTerm = normalize(term);
    for (const profile in COMMON_PROFILES) {
      if (normalize(profile) === normTerm) {
        // For each component test (with aliases), trigger API searches for all aliases
        const componentTests = COMMON_PROFILES[profile];
        let allAliasFetches = [];
        let aliasGroups = [];
        for (const aliases of componentTests) {
          aliasGroups.push(aliases);
          for (const alias of aliases) {
            allAliasFetches.push(
              fetchAggregatedSearch(city, alias)
                .then(res => ({ ok: true, term: alias, res }))
                .catch(err => {
                  console.warn("[searchEngine] fetch error for profile component alias:", alias, err);
                  return { ok: false, term: alias, res: { tests: [], packages: [] } };
                })
            );
          }
        }
        const aliasResults = await Promise.all(allAliasFetches);
        results = results.concat(aliasResults);

        // For each alias group, find the best matching test from all aliasResults, or try keyword-based search if no match
        const foundComponentTests = [];
        for (const aliases of aliasGroups) {
          let found = null;
          // 1. Try all aliases for exact/alias match
          for (const alias of aliases) {
            const aliasNorm = normalize(alias);
            for (const ar of aliasResults) {
              if (ar.term !== alias) continue;
              if (ar && ar.res && Array.isArray(ar.res.tests) && ar.res.tests.length > 0) {
                for (const t of ar.res.tests) {
                  const tNorm = normalize(t.testName || t.normalized_name || t.name || "");
                  let aliasMatch = false;
                  if (Array.isArray(t.testAlias)) {
                    for (const ta of t.testAlias) {
                      if (normalize(ta) === aliasNorm) {
                        aliasMatch = true;
                        break;
                      }
                    }
                  }
                  if (tNorm === aliasNorm || aliasMatch) {
                    found = t;
                    break;
                  }
                }
              }
              if (found) break;
            }
            if (found) break;
          }
          // 2. If not found, try searching with each keyword from the aliases
          if (!found) {
            let keywordResults = [];
            for (const alias of aliases) {
              const words = alias.split(/\s+/).filter(Boolean);
              for (const word of words) {
                // Avoid duplicate API calls for the same word
                if (aliases.some(a => a === word)) continue;
                // Search API for the keyword
                let keywordRes = await fetchAggregatedSearch(city, word).catch(() => null);
                if (keywordRes && Array.isArray(keywordRes.tests) && keywordRes.tests.length > 0) {
                  keywordResults = keywordResults.concat(keywordRes.tests);
                }
              }
            }
            // Use partial/fuzzy matching to select the best candidate
            let bestScore = 0;
            let bestTest = null;
            for (const t of keywordResults) {
              const tNorm = normalize(t.testName || t.normalized_name || t.name || "");
              let score = 0;
              for (const alias of aliases) {
                const aliasNorm = normalize(alias);
                if (tNorm.includes(aliasNorm) || aliasNorm.includes(tNorm)) score += 2;
                else {
                  // Score for each word match
                  const aliasWords = aliasNorm.split(/\s+/);
                  for (const w of aliasWords) {
                    if (tNorm.includes(w)) score += 1;
                  }
                }
              }
              if (score > bestScore) {
                bestScore = score;
                bestTest = t;
              }
            }
            if (bestTest) found = bestTest;
          }
          if (found) foundComponentTests.push(found);
        }

        chosenTests.push({ requestedTerm: profile, test: { testName: profile }, reason: "profile_not_available", profileComponents: foundComponentTests });
        for (const t of foundComponentTests) {
          const key = normalize(t.testName || t.normalized_name || t.name || "");
          if (!seenTestKeys.has(key)) {
            chosenTests.push({ requestedTerm: t.testName || t.normalized_name || t.name || "", test: t, reason: `part of ${profile}` });
            seenTestKeys.add(key);
          }
        }
      }
    }
  }

  // For generic queries (like HIV, dengue, H Pylori), if the term is not a profile, return all available variants/methods for that test
  for (const termRaw of unresolvedTerms) {
    const normTerm = normalize(termRaw);
    // Only if not a profile
    if (!Object.keys(COMMON_PROFILES).some(p => normalize(p) === normTerm)) {
      // Search API for the term and all common abbreviations/aliases
      const genericAliases = [termRaw];
      // Add some common abbreviations/intelligent terms
      if (normTerm === "hiv") genericAliases.push("hiv 1", "hiv 2", "hiv duo", "hiv tridot");
      if (normTerm === "dengue") genericAliases.push("dengue igg", "dengue igm", "dengue ns1");
      if (normTerm === "h pylori" || normTerm === "h. pylori") genericAliases.push("helicobacter pylori", "h pylori antigen", "h pylori antibody");
      // Add more as needed
      const genericFetches = genericAliases.map(alias =>
        fetchAggregatedSearch(city, alias)
          .then(res => ({ ok: true, term: alias, res }))
          .catch(err => {
            console.warn("[searchEngine] fetch error for generic alias:", alias, err);
            return { ok: false, term: alias, res: { tests: [], packages: [] } };
          })
      );
      const genericResults = await Promise.all(genericFetches);
      results = results.concat(genericResults);
      // For each result, add all unique tests for the term and its aliases (show all variants/methods, using partial/fuzzy matching)
      let foundVariants = [];
      const foundVariantKeys = new Set();
      for (const gr of genericResults) {
        if (gr && gr.res && Array.isArray(gr.res.tests) && gr.res.tests.length > 0) {
          for (const t of gr.res.tests) {
            const tNorm = normalize(t.testName || t.normalized_name || t.name || "");
            let match = false;
            // Partial/fuzzy match: test name or any alias contains the search term or any alias
            for (const alias of genericAliases) {
              const aliasNorm = normalize(alias);
              if (tNorm.includes(aliasNorm) || aliasNorm.includes(tNorm)) {
                match = true;
                break;
              }
              if (Array.isArray(t.testAlias)) {
                for (const ta of t.testAlias) {
                  const taNorm = normalize(ta);
                  if (taNorm.includes(aliasNorm) || aliasNorm.includes(taNorm)) {
                    match = true;
                    break;
                  }
                }
              }
              if (match) break;
            }
            if (match && !foundVariantKeys.has(tNorm)) {
              foundVariants.push(t);
              foundVariantKeys.add(tNorm);
            }
          }
        }
      }

      // Always do a broad search for the most specific keyword (last word)
      let broadKeyword = null;
      for (const base of genericAliases) {
        const words = base.split(/\s+/).filter(Boolean);
        if (words.length > 0) broadKeyword = words[words.length - 1];
      }
      if (broadKeyword && broadKeyword.length > 2) { // avoid too short
        const broadRes = await fetchAggregatedSearch(city, broadKeyword).catch(() => null);
        if (broadRes && Array.isArray(broadRes.tests) && broadRes.tests.length > 0) {
          for (const t of broadRes.tests) {
            const tNorm = normalize(t.testName || t.normalized_name || t.name || "");
            // NEW: Add all tests whose name or any alias contains the broad keyword
            const broadNorm = normalize(broadKeyword);
            let match = false;
            if (tNorm.includes(broadNorm)) match = true;
            if (!match && Array.isArray(t.testAlias)) {
              for (const ta of t.testAlias) {
                if (normalize(ta).includes(broadNorm)) {
                  match = true;
                  break;
                }
              }
            }
            if (match && !foundVariantKeys.has(tNorm)) {
              foundVariants.push(t);
              foundVariantKeys.add(tNorm);
            }
          }
        }
      }

      // Add all unique variants for this generic term
      for (const t of foundVariants) {
        const key = normalize(t.testName || t.normalized_name || t.name || "");
        if (!seenTestKeys.has(key)) {
          chosenTests.push({ requestedTerm: t.testName || t.normalized_name || t.name || "", test: t, reason: `variant of ${termRaw}` });
          seenTestKeys.add(key);
        }
      }
    }
  }

  // --- New logic: map searched tests that are also parameters in other tests ---
  // Build a mapping: { testName: [list of parent tests where it is a parameter] }
  const normalizedToDisplayName = {};
  for (const ct of chosenTests) {
    const name = ct.test.testName || ct.test.normalized_name || ct.test.name || "Unnamed Test";
    const norm = normalize(name);
    normalizedToDisplayName[norm] = name;
  }

  // For each chosen test, check if its name appears as a parameter in any other chosen test
  const parameterCoverage = {};
  for (const ct of chosenTests) {
    const thisNorm = normalize(ct.test.testName || ct.test.normalized_name || ct.test.name || "");
    for (const other of chosenTests) {
      if (ct === other) continue;
      const params = Array.isArray(other.test.groupTests) ? other.test.groupTests : (Array.isArray(other.test.parameters) ? other.test.parameters : []);
      for (const param of params) {
        if (normalize(param) === thisNorm) {
          if (!parameterCoverage[thisNorm]) parameterCoverage[thisNorm] = [];
          parameterCoverage[thisNorm].push(normalizedToDisplayName[normalize(other.test.testName || other.test.normalized_name || other.test.name || "")]);
        }
      }
    }
  }

  // Prepare package scoring: only include packages covering >= MIN_PACKAGE_COVERAGE_RATIO of resolved requested tests
  const resolvedTestNamesNormalized = chosenTests.map(x => normalize(x.test.testName || x.test.normalized_name || ""));
  const pkgScores = [];

  for (const p of allPackages) {
    const evald = evaluatePackageAgainstResolved(p, resolvedTestNamesNormalized);
    if (!evald) continue;
    if (evald.coverage < MIN_PACKAGE_COVERAGE_RATIO) continue;
    // compute score: reward coverage and precision, penalize extra tests and price
    const price = Number(p.consumerPrice || p.price || 5000);
    const score = (evald.coverage * 120) + (evald.precision * 100) - (evald.extraTests * 3) - (price / 1000);
    pkgScores.push({ pkg: p, evald, score });
  }

  pkgScores.sort((a, b) => b.score - a.score);

  // shape final items: tests first, packages next
  const items = [];

  for (const ct of chosenTests) {
    items.push({
      kind: "test_for_term",
      requestedTerm: ct.requestedTerm,
      entry: ct.test,
      reason: ct.reason,
      parameterCoverage: parameterCoverage[normalize(ct.test.testName || ct.test.normalized_name || ct.test.name || "")] || []
    });
  }

  for (const ps of pkgScores.slice(0, TOP_PACKAGES)) {
    items.push({
      kind: "package",
      entry: ps.pkg,
      matchedTests: ps.evald.matchedTests,
      coverage: ps.evald.coverage,
      precision: ps.evald.precision
    });
  }

  const note = items.length
    ? "Results prioritized using parameter → test → package resolution."
    : "No information available.";

  return {
    city,
    count: items.length,
    items,
    note
  };
}
