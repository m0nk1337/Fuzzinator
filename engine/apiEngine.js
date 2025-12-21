// engine/apiEngine.js
export async function fetchAggregatedSearch(cityCode, searchTerm) {
  const url = `https://cerebro.orangehealth.in/api/v3/search/aggregated?city_code=${encodeURIComponent(cityCode)}&search_substring=${encodeURIComponent(searchTerm)}`;
  console.log("[apiEngine] GET", url);

  // Browsers disallow setting some headers (User-Agent, Cookie, Referer). When running in the browser
  // we must avoid sending those headers to prevent preflight failures. In Node (server-side) we keep
  // the richer headers for compatibility with server-side tools.
  const isBrowser = (typeof window !== 'undefined' && typeof window.fetch === 'function');
  const headers = isBrowser
    ? { "Accept": "application/json, text/plain, */*" }
    : {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://orangehealth.in/",
        "Cookie": "" // Keep empty by default; populate if running in trusted server env
      };

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`API error ${res.status} ${res.statusText} ${txt}`);
  }
  const data = await res.json().catch(() => ({}));
  return {
    tests: Array.isArray(data.tests) ? data.tests : [],
    packages: Array.isArray(data.packages) ? data.packages : []
  };
}
