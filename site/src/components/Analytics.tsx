import Script from "next/script";

/**
 * Measurement stack (spec §6) — every tag is env-gated, so nothing loads
 * until the real IDs exist. All scripts load afterInteractive or lazier:
 * measurement never competes with LCP.
 */
export default function Analytics() {
  const ga4 = process.env.NEXT_PUBLIC_GA4_ID;
  const gadsId = process.env.NEXT_PUBLIC_GADS_ID; // AW-… account tag
  const clarity = process.env.NEXT_PUBLIC_CLARITY_ID;
  const callrail = process.env.NEXT_PUBLIC_CALLRAIL_SRC;

  // One gtag.js loader serves both GA4 and Google Ads; config each present id.
  const gtagLoaderId = ga4 || gadsId;

  return (
    <>
      {gtagLoaderId && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${gtagLoaderId}`}
            strategy="afterInteractive"
          />
          <Script id="gtag-init" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              window.gtag = gtag;
              gtag('js', new Date());
              ${ga4 ? `gtag('config', '${ga4}');` : ""}
              ${gadsId ? `gtag('config', '${gadsId}');` : ""}`}
          </Script>
        </>
      )}
      {clarity && (
        <Script id="clarity-init" strategy="lazyOnload">
          {`(function(c,l,a,r,i,t,y){
              c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
              t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
              y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            })(window, document, "clarity", "script", "${clarity}");`}
        </Script>
      )}
      {callrail && <Script src={callrail} strategy="afterInteractive" />}
    </>
  );
}
