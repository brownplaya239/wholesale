/** Lead source / attribution parsed from the landing URL and referrer. */

export type LeadSource = {
  channel: "google_ads" | "utm" | "referral" | "direct";
  landingPath: string | null;
  referrer: string | null;
  utm: Partial<Record<"source" | "medium" | "campaign" | "term" | "content", string>>;
  clickIds: Partial<Record<"gclid" | "gbraid" | "wbraid" | "fbclid" | "msclkid", string>>;
  googleAds: { campaignId: string | null; source: string | null } | null;
};

const CLICK_IDS = ["gclid", "gbraid", "wbraid", "fbclid", "msclkid"] as const;
const UTM = ["source", "medium", "campaign", "term", "content"] as const;

export function parseSource(pageUrl: string, referrer?: string | null): LeadSource {
  let url: URL | null = null;
  try {
    url = new URL(pageUrl);
  } catch {
    url = null;
  }
  const q = url?.searchParams;
  const get = (k: string) => q?.get(k)?.slice(0, 200) || undefined;
  const utm: LeadSource["utm"] = {};
  for (const k of UTM) {
    const v = get(`utm_${k}`);
    if (v) utm[k] = v;
  }
  const clickIds: LeadSource["clickIds"] = {};
  for (const k of CLICK_IDS) {
    const v = get(k);
    if (v) clickIds[k] = v;
  }
  const gadCampaign = get("gad_campaignid") ?? null;
  const gadSource = get("gad_source") ?? null;
  const isAds = Boolean(clickIds.gclid || clickIds.gbraid || clickIds.wbraid || gadCampaign || gadSource);
  let ref: string | null = null;
  try {
    ref = referrer ? new URL(referrer).hostname : null;
  } catch {
    ref = null;
  }
  const internal = ref && url && ref === url.hostname;
  return {
    channel: isAds ? "google_ads" : Object.keys(utm).length ? "utm" : ref && !internal ? "referral" : "direct",
    landingPath: url?.pathname ?? null,
    referrer: internal ? null : ref,
    utm,
    clickIds,
    googleAds: isAds ? { campaignId: gadCampaign, source: gadSource } : null,
  };
}

export function describeSource(s: LeadSource): string {
  if (s.channel === "google_ads") {
    return `Google Ads${s.googleAds?.campaignId ? ` (campaign ${s.googleAds.campaignId})` : ""}`;
  }
  if (s.channel === "utm") return `UTM: ${[s.utm.source, s.utm.medium, s.utm.campaign].filter(Boolean).join(" / ")}`;
  if (s.channel === "referral") return `Referral from ${s.referrer}`;
  return "Direct / organic";
}
