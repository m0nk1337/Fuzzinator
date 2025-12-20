// engine/apiEngine.js
export async function fetchAggregatedSearch(cityCode, searchTerm) {
  const url = `https://cerebro.orangehealth.in/api/v3/search/aggregated?city_code=${encodeURIComponent(cityCode)}&search_substring=${encodeURIComponent(searchTerm)}`;
  console.log("[apiEngine] GET", url);
  const res = await fetch(url);
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
