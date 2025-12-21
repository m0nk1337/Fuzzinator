  let chosenTests = [];
// engine/searchEngine.js
import { fetchAggregatedSearch } from "./apiEngine.js";
import { findKeywordMapping, KEYWORD_MAP } from "./knowledgeMap.js";
/* ---------------------------
  Config & helpers
  --------------------------- */

/* ---------------------------
   Config & helpers
   --------------------------- */

const STOPWORDS = ["in", "for", "check"];
// Words to ignore when generating lightweight keyword searches for profile aliases
const PROFILE_ALIAS_STOPWORDS = new Set(["total", "protein", "alkaline", "phosphatase", "free", "direct"]);
// Words that are modifiers and should not be used as broad search keywords (e.g., 'advanced', 'basic')
const MODIFIER_TOKENS = new Set(["basic","advanced","essential","comprehensive","complete","profile","package","panel","group"]);
// Minimum length of a word to consider for alias keyword searches (allow short but meaningful tokens like 'hdl')
const MIN_ALIAS_WORD_LENGTH = 3;

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


// City detection/stripping removed. City must be provided explicitly.

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

  // Stricter: all termTokens must be present in the test name or aliases (exact or included)
  return termTokens.length > 0 && termTokens.every(tt => allTokens.some(nt => nt === tt || nt.includes(tt) || tt.includes(nt)));
}

function matchTestByParameter(termTokens, test) {
  if (!Array.isArray(test.groupTests) || test.groupTests.length === 0) return false;
  // Relaxed: if any parameter matches at least one token (fuzzy match)
  for (const param of test.groupTests) {
    const pTokens = tokens(param);
    if (termTokens.some(tt => pTokens.some(pt => pt === tt || pt.includes(tt) || tt.includes(pt)))) {
      return param; // return the matched parameter string
    }
  }
  return false;
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
      // parameter -> test match (AEC -> CBC) - capture which parameter matched
      const matchedParam = matchTestByParameter(termTokens, t);
      if (matchedParam) {
        resolved.push({ test: t, reason: "parameter", matchedParameter: matchedParam });
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
  "lipid profile": [
    ["cholesterol total", "total cholesterol"],
    ["triglycerides", "tg"],
    ["hdl", "hdl cholesterol"],
    ["ldl", "ldl cholesterol"],
    ["vldl"]
  ],
  "thyroid profile": [
    ["tsh", "thyroid stimulating hormone"],
    ["free t3", "ft3"],
    ["free t4", "ft4"],
    ["anti-tpo"]
  ],
  "renal profile": [
    ["urea"],
    ["creatinine"],
    ["uric acid"],
    ["sodium", "na"],
    ["potassium", "k"],
    ["chloride", "cl"],
    ["electrolytes"]
  ],
  "hhh test": [
    ["hemoglobin", "hb"],
    ["hematocrit", "pcv"],
    ["hb electrophoresis", "hemoglobin electrophoresis"]
  ]
  // Add more as needed
};

export async function smartSearch(userQuery) {
  // Check for direct knowledge mapping (SOP, process, product, package, etc.)
  // Only use city from dropdown, no detection/guessing
  let userQueryString = userQuery.query;
  const city = userQuery.city;
  // Robust split: split on commas, semicolons, or fullwidth commas
  let terms = String(userQueryString || "").split(/[,;\uFF0C\u3001]+/).map(x => x.trim()).filter(Boolean);
  console.log('[smartSearch] userQueryString:', JSON.stringify(userQueryString));
  console.log('[smartSearch] terms after split:', terms);

  // Only apply knowledge mapping when the user searched a single term
  let mapping = null;
  let knowledgeItem = null;
  if (terms.length === 1) {
    mapping = findKeywordMapping(terms[0]);
    if (mapping) {
      if (mapping.type === "sop" || mapping.type === "process" || mapping.type === "product") {
        knowledgeItem = { kind: mapping.type, entry: { name: terms[0], content: mapping.content } };
      }
      // If a single-term query maps directly to a known package, return the curated package (avoid noisy API fallbacks)
      if (mapping.type === 'package') {
        const pkg = mapping.content || { packageName: terms[0] };
        const items = [{ kind: 'package', entry: pkg }];
        const note = `Matched by: ${mapping.type} knowledge`;
        return { city, count: items.length, items, note };
      }
      // Handle package groups (multiple relevant packages for short queries like "essential package")
      if (mapping.type === 'package_group') {
        knowledgeItem = { kind: 'package_group', entry: { name: terms[0], matches: mapping.matches } };
      }
      if (mapping.apiQuery) {
        // replace the single term with the mapped apiQuery
        userQueryString = mapping.apiQuery;
        terms = String(userQueryString || "").split(/[,;\uFF0C\u3001]+/).map(x => x.trim()).filter(Boolean);
        console.log('[smartSearch] mapping applied, new terms:', terms);
      }
    }
  }

  if (!terms.length) {
    return { city, count: 0, items: [], note: "No information available." };
  }


  // Fetch per term, but keep each term's API response separate for exact matching
  console.log('[smartSearch] making API calls for terms:', terms);
  const fetchResults = await Promise.all(
    terms.map(term =>
      fetchAggregatedSearch(city, term)
        .then(res => ({ ok: true, term, res }))
        .catch(err => {
          console.warn("[searchEngine] fetch error for term:", term, err);
          return { ok: false, term, res: { tests: [], packages: [] } };
        })
    )
  );
  console.log('[smartSearch] fetchResults terms:', fetchResults.map(r => r.term));

  // 'results' will hold all API responses we consider (initial per-term + alias/generic fetches)
  let results = fetchResults.slice();
  // Collect all packages from responses for later scoring
  let allPackages = [];

  // Build a map term -> response tests for per-term resolution
  const termResponseTests = new Map();
  for (const r of fetchResults) {
    if (r && r.res) {
      termResponseTests.set(r.term, Array.isArray(r.res.tests) ? r.res.tests : []);
      if (Array.isArray(r.res.packages)) allPackages.push(...r.res.packages);
    }
  }


  // Collect all tests from all responses for package scoring
  // All tests across all fetched responses (including alias/generic fetches)
  const allTests = results.flatMap(r => (r.res && Array.isArray(r.res.tests)) ? r.res.tests : []);
  // Deduplicate tests for package scoring
  const testByKey = new Map();
  for (const t of allTests) {
    const name = normalize(t.testName || t.normalized_name || "");
    if (!name) continue;
    const container = t.container ? JSON.stringify(t.container) : "";
    const category = t.category || "";
    const key = `${name}|${container}|${category}`;
    if (!testByKey.has(key)) testByKey.set(key, t);
    else {
      const prev = testByKey.get(key);
      const prevFreq = Number(prev.frequency || 0);
      const curFreq = Number(t.frequency || 0);
      if (curFreq > prevFreq) testByKey.set(key, t);
      else if (curFreq === prevFreq) {
        const prevPrice = Number(prev.consumerPrice || Infinity);
        const curPrice = Number(t.consumerPrice || Infinity);
        if (curPrice < prevPrice) testByKey.set(key, t);
      }
    }
  }
  const uniqueTests = Array.from(testByKey.values());

  // Resolve tests per term (preserve request -> matched tests mapping)
  // chosenTests already declared above for exact match logic
  const seenTestKeys = new Set();
  const seenTermTestPairs = new Set();

  // Track terms that could not be resolved
  const unresolvedTerms = [];
  // Track profile terms to expand components (even if exact match exists)
  const profileTermsToExpand = [];

  for (const termRaw of terms) {
    const normTerm = normalize(termRaw);
    // console debug: term being resolved
    console.log('[smartSearch] resolving term:', termRaw);
    let isProfile = false;
    let exactProfileMatch = false;
    // Check if this term is a known profile
    if (Object.keys(COMMON_PROFILES).some(p => normalize(p) === normTerm)) {
      isProfile = true;
      profileTermsToExpand.push(termRaw);
      // Check if any test/package from API matches the profile exactly
      for (const t of uniqueTests) {
        const tNorm = normalize(t.testName || t.normalized_name || t.name || "");
        if (tNorm === normTerm) {
          exactProfileMatch = true;
          break;
        }
      }
    }
    // First try resolving within tests returned for this term only
    const termSpecific = termResponseTests.get(termRaw) || [];
    const resolvedLocal = resolveTestsForTerm(termRaw, termSpecific);
    let resolved = resolvedLocal;

    // If no local matches, try conservative term-specific fallbacks before global fallbacks
    if ((!resolved || resolved.length === 0)) {
      // If user typed a variant token (e.g., 'p24', contains digits), prefer the top term-specific result immediately if available
      const termTokens = tokens(termRaw);
      const hasVariantToken = termTokens.some(tt => /\d/.test(tt));
      if (hasVariantToken && termSpecific && termSpecific.length > 0) {
        // choose the top returned test for the exact term (user likely searched for a specific variant)
        chosenTests.push({ requestedTerm: termRaw, test: termSpecific[0], reason: 'term_top_result' });
        // mark as found and skip general fallback logic
        continue;
      }

      // if this exact term call returned tests, prefer them (conservative behavior)
      if (termSpecific && termSpecific.length > 0) {
        const termTokens = tokens(termRaw);
        // Generic single-word queries (e.g., 'hiv') — expose all variants returned by API
        if (terms.length === 1 && termTokens.length === 1) {
          resolved = termSpecific.map(t => ({ test: t, reason: 'variant' }));
        } else {
          // Multi-word query: prefer matches on meaningful tokens (non-noisy words or tokens with digits like 'p24')
          const meaningfulTokens = termTokens.filter(tt => (tt.length > 2 || /\d/.test(tt)) && !PROFILE_ALIAS_STOPWORDS.has(tt) && !STOPWORDS.includes(tt));
          if (meaningfulTokens.length > 0) {
            const looseMatches = termSpecific.filter(t => {
              const tNorm = normalize(t.testName || t.normalized_name || t.name || "");
              const aliases = Array.isArray(t.testAlias) ? t.testAlias.map(a => normalize(a)) : [];
              return meaningfulTokens.some(mt => tNorm.includes(mt) || aliases.some(a => a.includes(mt)));
            }).map(t => ({ test: t, reason: 'loose' }));
            if (looseMatches.length > 0) resolved = looseMatches;
            else resolved = [{ test: termSpecific[0], reason: 'term_top_result' }];
          } else {
            // No meaningful tokens to use — pick the top returned test as a sensible fallback
            resolved = [{ test: termSpecific[0], reason: 'term_top_result' }];
          }
        }
      } else if (uniqueTests.length > 0) {
        // fallback to global unique tests if nothing was returned from term-specific API
        resolved = resolveTestsForTerm(termRaw, uniqueTests).map(r => ({ ...r, fallback: true }));
      }
    }

    // For generic queries (single word, e.g., 'pylori', 'hiv', 'dengue'), we treat them as variants
    const isGeneric = terms.length === 1 && tokens(termRaw).length === 1;
    let found = false;
    let bestDirect = null;
    let bestParam = null;
    for (const r of resolved) {
      const key = normalize(r.test.testName || r.test.normalized_name || "");
      // For profiles, only add if exact match
      if (isProfile && normalize(r.test.testName || r.test.normalized_name || r.test.name || "") !== normTerm) continue;
      if (r.reason === "name" && !bestDirect) bestDirect = r;
      if (r.reason === "parameter" && !bestParam) bestParam = r;
    }
    // Prefer term-specific matches over global fallbacks
    if (bestDirect && !bestDirect.fallback) {
      chosenTests.push({ requestedTerm: termRaw, test: bestDirect.test, reason: bestDirect.reason });
      found = true;
    } else if (bestDirect && bestDirect.fallback) {
      // keep as fallback but mark it, and only include if no other results later
      chosenTests.push({ requestedTerm: termRaw, test: bestDirect.test, reason: bestDirect.reason, fallbackResult: true });
      // don't set found = true; let exact/profile expansion decide
    } else if (bestParam) {
      // Add explicit parameter first (so it appears before parent test), when possible
      const paramName = bestParam.matchedParameter || termRaw;
      const paramNorm = normalize(paramName);
      const existsDirect = uniqueTests.some(ut => normalize(ut.testName || ut.normalized_name || ut.name || "") === paramNorm);
      if (!existsDirect && !seenTestKeys.has(paramNorm)) {
        const syntheticParamTest = { testName: paramName, normalized_name: paramNorm, syntheticParameterOf: bestParam.test.testName || bestParam.test.normalized_name || bestParam.test.name, isSyntheticParameter: true };
        chosenTests.push({ requestedTerm: termRaw, test: syntheticParamTest, reason: "parameter_explicit" });
        // Mark as seen to avoid duplicates
        seenTestKeys.add(paramNorm);
      }
      // Add parent test that contains the parameter
      chosenTests.push({ requestedTerm: termRaw, test: bestParam.test, reason: bestParam.reason, matchedParameter: bestParam.matchedParameter });
      found = true;
    }

    // If query is generic single-word, include all term-specific variants returned by the API
    if (isGeneric && termSpecific && termSpecific.length > 0) {
      for (const t of termSpecific) {
        const key = normalize(t.testName || t.normalized_name || t.name || "");
        if (!seenTestKeys.has(key)) {
          chosenTests.push({ requestedTerm: termRaw, test: t, reason: `variant of ${termRaw}` });
          seenTestKeys.add(key);
        }
      }
      found = true;
    }

    // For profiles, if no exact match, mark as unresolved to trigger fallback
    if (isProfile && !exactProfileMatch) {
      unresolvedTerms.push(termRaw);
    } else if (!isProfile && !found) {
      unresolvedTerms.push(termRaw);
    }
  }

  console.log('[smartSearch] chosenTests after term resolution (raw):', chosenTests.map(c => ({ requestedTerm: c.requestedTerm, name: c.test.testName || c.test.normalized_name || c.test.name, reason: c.reason, fallback: c.fallbackResult||false })));
  // Remove fallback-only results if a solid match exists for the term
  const filteredChosen = [];
  for (const term of terms) {
    const group = chosenTests.filter(c => c.requestedTerm === term);
    // prefer non-fallback entries
    const nonFallback = group.filter(g => !g.fallbackResult);
    const toAdd = nonFallback.length ? nonFallback : group;
    filteredChosen.push(...toAdd);
  }
  // Replace chosenTests with filtered, preserving order of terms
  chosenTests = filteredChosen;

  // For variant-style queries (tokens with digits like 'p24'), prefer the top term-specific result if available
  for (const termRaw of terms) {
    const termTokens = tokens(termRaw);
    if (!termTokens.some(tt => /\d/.test(tt))) continue;
    const termSpecific = termResponseTests.get(termRaw) || [];
    if (termSpecific.length === 0) continue;
    const termFirst = termSpecific[0];
    const termFirstNorm = normalize(termFirst.testName || termFirst.normalized_name || termFirst.name || "");
    // If chosenTests lacks an explicit top term-specific result, insert it at the start of that term's group
    const alreadyHasTermFirst = chosenTests.some(c => c.requestedTerm === termRaw && normalize(c.test.testName || c.test.normalized_name || c.test.name || "") === termFirstNorm);
    if (!alreadyHasTermFirst) {
      const firstGroupIndex = chosenTests.findIndex(c => c.requestedTerm === termRaw);
      const insertIndex = firstGroupIndex >= 0 ? firstGroupIndex : chosenTests.length;
      chosenTests.splice(insertIndex, 0, { requestedTerm: termRaw, test: termFirst, reason: 'term_top_result' });
    }
  }

  // Expand explicit profile terms collected earlier (so profile queries always get component expansion)
  const uniqueProfileTerms = Array.from(new Set(profileTermsToExpand));
  for (const profile of uniqueProfileTerms) {
    const normProfile = normalize(profile);
    for (const pName in COMMON_PROFILES) {
      if (normalize(pName) !== normProfile) continue;
      const componentTests = COMMON_PROFILES[pName];
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
      for (const ar of aliasResults) {
        if (ar && ar.res && Array.isArray(ar.res.packages)) allPackages.push(...ar.res.packages);
      }

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
        // 2. If not found, try searching with each keyword from the aliases (conservative)
        if (!found) {
          let keywordResults = [];
          for (const alias of aliases) {
            const words = alias.split(/\s+/).filter(Boolean);
            for (const word of words) {
              const w = String(word || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
              if (!w) continue;
              if (PROFILE_ALIAS_STOPWORDS.has(w)) continue;
              // Conservative rule: if alias has multiple words, only search a word if it looks like an abbreviation
              // (short token <= MIN_ALIAS_WORD_LENGTH) or contains a digit (e.g., t3, ft4). This avoids searching generic words like 'free'.
              if (words.length > 1 && !( /\d/.test(w) || w.length <= MIN_ALIAS_WORD_LENGTH )) continue;
              // Avoid duplicate API calls for the same word when the alias itself equals the word
              if (aliases.some(a => normalize(a) === w)) continue;
              // Search API for the keyword (conservative)
              let keywordRes = await fetchAggregatedSearch(city, w).catch(() => null);
              if (keywordRes && Array.isArray(keywordRes.tests) && keywordRes.tests.length > 0) {
                keywordResults = keywordResults.concat(keywordRes.tests);
              }
            }
          }
          // Use partial/fuzzy matching to select the best candidate
          // First prefer tests that contain clear priority tokens (e.g., 'iga', 'ttg', 'ema', 'dgp')
          const aliasGroupWords = Array.from(new Set(aliases.flatMap(a => normalize(a).split(/\s+/).filter(Boolean))));
          const priorityTokens = ['iga', 'ttg', 'ema', 'dgp', 'deamidated', 'gliadin', 'endomysial'];
          const priorityWord = aliasGroupWords.find(w => priorityTokens.includes(w));
          let bestScore = 0;
          let bestTest = null;
          if (priorityWord) {
            // pick the first test that contains the priority token
            const foundPriority = keywordResults.find(t => normalize(t.testName || t.normalized_name || t.name || "").includes(priorityWord));
            if (foundPriority) bestTest = foundPriority;
          }
          if (!bestTest) {
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
          }
          // Accept best candidate only if it has a meaningful score (avoid noisy single-word matches)
          if (bestTest && (bestScore >= 2 || (priorityWord && normalize(bestTest.testName || bestTest.normalized_name || bestTest.name || "").includes(priorityWord)))) {
            const tNormBest = normalize(bestTest.testName || bestTest.normalized_name || bestTest.name || "");
            const hasSubstantialWordMatch = aliasGroupWords.some(w => w.length > 2 && tNormBest.includes(w));
            if (hasSubstantialWordMatch || (priorityWord && tNormBest.includes(priorityWord))) found = bestTest;
          }
        }
        if (found) {
          // Ensure the chosen test contains at least one non-noisy alias token (avoid selecting tests that only match 'total' or other noisy words)
          const tNorm = normalize(found.testName || found.normalized_name || found.name || "");
          const aliasGroupWords = Array.from(new Set(aliases.flatMap(a => normalize(a).split(/\s+/).filter(Boolean))));
          const hasGoodToken = aliasGroupWords.some(w => w.length > 2 && !PROFILE_ALIAS_STOPWORDS.has(w) && tNorm.includes(w));
          if (hasGoodToken) foundComponentTests.push(found);
        }
      }

      // Determine missing components
      const componentCanonical = componentTests.map(g => g[0]);
      const foundNorms = foundComponentTests.map(t => normalize(t.testName || t.normalized_name || t.name || ""));
      const missingProfileComponents = componentCanonical.filter(c => !foundNorms.includes(normalize(c)));

      chosenTests.push({ requestedTerm: pName, test: { testName: pName }, reason: "profile_not_available", profileComponents: foundComponentTests, missingProfileComponents });
      for (const t of foundComponentTests) {
        const key = normalize(t.testName || t.normalized_name || t.name || "");
        if (!seenTestKeys.has(key)) {
          chosenTests.push({ requestedTerm: t.testName || t.normalized_name || t.name || "", test: t, reason: `part of ${pName}` });
          seenTestKeys.add(key);
        }
      }
    }
  }

  // For unresolved terms, check if they match a common profile

  // For unresolved terms, we may perform a conservative generic expansion (only when there are no local matches)
  for (const termRaw of unresolvedTerms) {
    const normTerm = normalize(termRaw);
    // Only if not a profile
    if (!Object.keys(COMMON_PROFILES).some(p => normalize(p) === normTerm)) {
      // Search API for the term and a limited set of abbreviations/aliases
      const genericAliases = [termRaw];
      if (normTerm === "hiv") genericAliases.push("hiv 1", "hiv 2");
      if (normTerm === "dengue") genericAliases.push("dengue igg", "dengue igm");
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
      // Add genericResults packages to allPackages for scoring
      for (const gr of genericResults) {
        if (gr && gr.res && Array.isArray(gr.res.packages)) allPackages.push(...gr.res.packages);
      }
      // For each result, add all unique tests for the term and its aliases (show all variants/methods, using partial/fuzzy matching but require positive match score)
      let foundVariants = [];
      const foundVariantKeys = new Set();
      for (const gr of genericResults) {
        if (gr && gr.res && Array.isArray(gr.res.tests) && gr.res.tests.length > 0) {
          for (const t of gr.res.tests) {
            const tNorm = normalize(t.testName || t.normalized_name || t.name || "");
            let matchScore = 0;
            for (const alias of genericAliases) {
              const aliasNorm = normalize(alias);
              if (tNorm === aliasNorm) matchScore += 3;
              else if (tNorm.includes(aliasNorm) || aliasNorm.includes(tNorm)) matchScore += 2;
              else if (Array.isArray(t.testAlias)) {
                for (const ta of t.testAlias) {
                  const taNorm = normalize(ta);
                  if (taNorm === aliasNorm) matchScore += 2;
                  else if (taNorm.includes(aliasNorm) || aliasNorm.includes(taNorm)) matchScore += 1;
                }
              }
            }
            if (matchScore > 0 && !foundVariantKeys.has(tNorm)) {
              foundVariants.push(t);
              foundVariantKeys.add(tNorm);
            }
          }
        }
      }

      // Always do a broad search for the most specific keyword (last word), but avoid noisy very short/common words
      let broadKeyword = null;
      for (const base of genericAliases) {
        const words = base.split(/\s+/).filter(Boolean);
        if (words.length > 0) broadKeyword = words[words.length - 1];
      }
      if (broadKeyword) {
        const bk = String(broadKeyword || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
        if (bk.length >= MIN_ALIAS_WORD_LENGTH && !PROFILE_ALIAS_STOPWORDS.has(bk) && !MODIFIER_TOKENS.has(bk)) { // avoid too short, noisy or modifier words
          const broadRes = await fetchAggregatedSearch(city, bk).catch(() => null);
          if (broadRes && Array.isArray(broadRes.tests) && broadRes.tests.length > 0) {
            for (const t of broadRes.tests) {
              const tNorm = normalize(t.testName || t.normalized_name || t.name || "");
              // NEW: Add all tests whose name or any alias contains the broad keyword
              const broadNorm = bk;
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
  // Use ALL uniqueTests to build a parameter->parent mapping so we can detect relationships like "bilirubin -> Liver Function Test (LFT)"
  const parameterParentMap = {}; // { paramNormalized: Set(parentDisplayName) }
  for (const ut of uniqueTests) {
    const parentName = ut.testName || ut.normalized_name || ut.name || "";
    const params = Array.isArray(ut.groupTests) ? ut.groupTests : (Array.isArray(ut.parameters) ? ut.parameters : []);
    for (const param of params) {
      const pNorm = normalize(param);
      if (!pNorm) continue;
      if (!parameterParentMap[pNorm]) parameterParentMap[pNorm] = new Set();
      parameterParentMap[pNorm].add(parentName || (ut.testName || ut.normalized_name || ut.name || ""));
    }
  }

  // Build parameter coverage for chosenTests using the parameterParentMap with fuzzy matching
  const parameterCoverage = {};
  for (const ct of chosenTests) {
    const thisName = ct.test.testName || ct.test.normalized_name || ct.test.name || "";
    const thisNorm = normalize(thisName);
    const parents = new Set();

    // Exact or partial matches between parameter keys and thisNorm
    for (const pKey of Object.keys(parameterParentMap)) {
      if (!pKey) continue;
      if (pKey === thisNorm || pKey.includes(thisNorm) || thisNorm.includes(pKey)) {
        for (const pn of parameterParentMap[pKey]) parents.add(pn);
      } else {
        // token based matching: if any token overlaps, consider it a match (e.g., 'bilirubin' vs 'total bilirubin')
        const pTokens = pKey.split(/\s+/).filter(Boolean);
        const thisTokens = thisNorm.split(/\s+/).filter(Boolean);
        if (pTokens.some(pt => thisTokens.includes(pt) || pt.includes(thisNorm) || thisTokens.some(tt => pt.includes(tt)))) {
          for (const pn of parameterParentMap[pKey]) parents.add(pn);
        }
      }
    }

    if (parents.size > 0) {
      parameterCoverage[thisNorm] = Array.from(parents);
    }
  }

  // Prepare package scoring: include method/sampleType/department/tags in scoring
  const resolvedTestNamesNormalized = chosenTests.map(x => normalize(x.test.testName || x.test.normalized_name || ""));
  const pkgScores = [];

  for (const p of allPackages) {
    const evald = evaluatePackageAgainstResolved(p, resolvedTestNamesNormalized);
    if (!evald) continue;
    if (evald.coverage < MIN_PACKAGE_COVERAGE_RATIO) continue;
    // Prefer packages with more diverse methods/sampleTypes/departments/tags
    const methods = new Set();
    const samples = new Set();
    const depts = new Set();
    const tags = new Set(Array.isArray(p.tags) ? p.tags : []);
    if (Array.isArray(p.testsMetadata)) {
      for (const t of p.testsMetadata) {
        if (t.method) methods.add(t.method.toLowerCase());
        if (t.sampleType) samples.add(t.sampleType.toLowerCase());
        if (t.department) depts.add(t.department.toLowerCase());
        if (Array.isArray(t.tags)) t.tags.forEach(tag => tags.add(tag));
      }
    }
    const diversityScore = methods.size + samples.size + depts.size + tags.size * 0.5;
    // compute score: reward coverage, precision, diversity, penalize extra tests and price
    const price = Number(p.consumerPrice || p.price || 5000);
    const score = (evald.coverage * 120) + (evald.precision * 100) + (diversityScore * 10) - (evald.extraTests * 3) - (price / 1000);
    pkgScores.push({ pkg: p, evald, score });
  }

  // Synthesize profile packages when the resolved tests cover enough of a COMMON_PROFILE
  // Only synthesize profiles the user explicitly requested (or very near-complete coverage)
  const requestedProfileSet = new Set(profileTermsToExpand.map(p => normalize(p)));
  for (const profile in COMMON_PROFILES) {
    const components = COMMON_PROFILES[profile]; // array of arrays of aliases
    let matched = [];
    for (const aliases of components) {
      const aliasNorms = aliases.map(a => normalize(a));
      // Consider a component matched if any alias is present in resolved test names
      const found = aliasNorms.some(an => resolvedTestNamesNormalized.includes(an) || uniqueTests.some(u => {
        const un = normalize(u.testName || u.normalized_name || u.name || "");
        return un === an || un.includes(an) || an.includes(un);
      }));
      if (found) matched.push(aliases[0]);
    }
    if (matched.length === 0) continue;
    const coverage = matched.length / components.length;
    // Only synthesize if the profile was explicitly requested, or the match coverage is near-complete
    if (coverage < MIN_PACKAGE_COVERAGE_RATIO) continue;
    if (!requestedProfileSet.has(normalize(profile)) && coverage < 0.95) continue;
    const syntheticPkg = { packageName: profile, testsMetadata: matched.map(m => ({ testName: m })), consumerPrice: 0, synthetic: true };
    const evald = { coverage, precision: (matched.length / components.length), matchedTests: matched, matchedCount: matched.length, totalPackageTests: components.length, extraTests: 0 };
    const score = (evald.coverage * 120) + (evald.precision * 60) + (matched.length * 5);
    pkgScores.push({ pkg: syntheticPkg, evald, score });
  }

  pkgScores.sort((a, b) => b.score - a.score);
  // If we synthesized a profile package, remove any 'profile_not_available' placeholder for the same profile to avoid duplication
  const synthesizedProfileNames = new Set(pkgScores.map(p => normalize(p.pkg.packageName || p.pkg.name || "")));
  if (synthesizedProfileNames.size > 0) {
    chosenTests = chosenTests.filter(ct => {
      if (ct.reason === 'profile_not_available') {
        const pk = normalize(ct.test.testName || ct.test.normalized_name || ct.test.name || "");
        if (synthesizedProfileNames.has(pk)) return false;
      }
      return true;
    });
  }

  console.log('[smartSearch] pkgScores top:', pkgScores.slice(0,5).map(p=>({name:p.pkg.packageName || p.pkg.name,score:p.score,coverage:p.evald.coverage,precision:p.evald.precision})));

  // shape final items: tests first, packages next
  const items = [];
  // Use a fresh set to record what we've added to output items — `seenTestKeys` was used earlier to avoid duplication while building `chosenTests`.
  const addedTestKeys = new Set();

  for (const ct of chosenTests) {
    const key = normalize(ct.test.testName || ct.test.normalized_name || ct.test.name || "");
    if (addedTestKeys.has(key)) continue;
    addedTestKeys.add(key);
    items.push({
      kind: "test_for_term",
      requestedTerm: ct.requestedTerm,
      entry: ct.test,
      reason: ct.reason,
      parameterCoverage: parameterCoverage[normalize(ct.test.testName || ct.test.normalized_name || ct.test.name || "")] || []
    });
  }

  // If the user's single-term query matched a `package_group` in the knowledge map, prefer that
  // and avoid surfacing the broad set of packages returned by the API for the short token (noisy results).
  if (mapping && mapping.type === 'package_group' && terms.length === 1) {
    // Add package entries directly from the mapping matches (preserves curated package list)
    for (const m of mapping.matches) {
      // Try to retrieve full package content from KEYWORD_MAP
      const mappingEntry = KEYWORD_MAP[m.key];
      const pkgContent = mappingEntry && mappingEntry.content ? mappingEntry.content : { packageName: m.title };
      items.push({ kind: 'package', entry: pkgContent, matchedTests: [], coverage: undefined, precision: undefined, source: 'knowledge_mapping' });
    }
  } else {
    for (const ps of pkgScores.slice(0, TOP_PACKAGES)) {
      items.push({
        kind: "package",
        entry: ps.pkg,
        matchedTests: ps.evald.matchedTests,
        coverage: ps.evald.coverage,
        precision: ps.evald.precision
      });
    }
  }

  let note = items.length
    ? "Results prioritized using parameter → test → package resolution."
    : "No information available.";

  // If there is a knowledge item, always show it first
  let finalItems = knowledgeItem ? [knowledgeItem, ...items] : items;
  let finalCount = finalItems.length;
  let finalNote;
  if (knowledgeItem) {
    // If we have a knowledge item but no items, don't append the generic 'No information available.' notice
    if (items.length) finalNote = `Matched by: ${mapping?.type} knowledge\n` + note;
    else finalNote = `Matched by: ${mapping?.type} knowledge`;
  } else {
    finalNote = note;
  }

  return {
    city,
    count: finalCount,
    items: finalItems,
    note: finalNote
  };
}
