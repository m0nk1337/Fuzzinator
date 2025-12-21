// engine/apiEngine.js
export async function fetchAggregatedSearch(cityCode, searchTerm) {
  const url = `https://cerebro.orangehealth.in/api/v3/search/aggregated?city_code=${encodeURIComponent(cityCode)}&search_substring=${encodeURIComponent(searchTerm)}`;
  console.log("[apiEngine] GET", url);
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
      "Accept": "application/json, text/plain, */*",
      "Referer": "https://orangehealth.in/",
      "Cookie": "_gcl_au=1.1.696581165.1766172419; _gid=GA1.2.185600100.1766172419; _fbp=fb.1.1766172420107.854066853632294526; mp_ca45550d8f739def75ddbe29f895ed81_mixpanel=%7B%22distinct_id%22%3A%22%24device%3Ae7e7c27e-c2a0-4745-9c7c-acb5c0669f20%22%2C%22%24device_id%22%3A%22e7e7c27e-c2a0-4745-9c7c-acb5c0669f20%22%2C%22%24initial_referrer%22%3A%22%24direct%22%2C%22%24initial_referring_domain%22%3A%22%24direct%22%2C%22__mps%22%3A%7B%7D%2C%22__mpso%22%3A%7B%22%24initial_referrer%22%3A%22%24direct%22%2C%22%24initial_referring_domain%22%3A%22%24direct%22%7D%2C%22__mpus%22%3A%7B%7D%2C%22__mpa%22%3A%7B%7D%2C%22__mpu%22%3A%7B%7D%2C%22__mpr%22%3A%5B%5D%2C%22__mpap%22%3A%5B%5D%2C%22User%20Agent%22%3A%22Mozilla%2F5.0%20(Windows%20NT%2010.0%3B%20Win64%3B%20x64)%20AppleWebKit%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F143.0.0.0%20Safari%2F537.36%20Edg%2F143.0.0.0%22%7D; _clck=6hc1fe%5E2%5Eg20%5E0%5E2179; _rdt_uuid=1766172418722.bb13114c-ac60-4a8d-9f9d-f46f35b2d61c; _ga=GA1.1.1190420755.1766172419; _uetsid=b08bff30dd1011f0b948410d5e2d246c|mwulcw|2|g20|0|2179; _clsk=1xp3r6p%5E1766215142627%5E7%5E1%5Eo.clarity.ms%2Fcollect; _uetvid=b08c3800dd1011f0b7b319eede5102a9|1c0vmqy|1766215142763|6|1|bat.bing.com/p/conversions/c/z; _rdt_pn=:150~598346bd80fa361e42c29d43a17b1f27505eabf3f2dbf832376aee6690f27287; _ga_VJRY97NY22=GS2.1.s1766217138$o5$g0$t1766217138$j60$l0$h0"
    }
  });
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
