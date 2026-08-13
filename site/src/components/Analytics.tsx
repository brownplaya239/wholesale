import Script from "next/script";

/**
 * Measurement stack (spec §6) — every tag is env-gated, so nothing loads
 * until the real IDs exist. All scripts load afterInteractive or lazier:
 * measurement never competes with LCP.
 */
export default function Analytics() {
  const ga4 = process.env.NEXT_PUBLIC_GA4_ID;
  const clarity = process.env.NEXT_PUBLIC_CLARITY_ID;
  const callrail = process.env.NEXT_PUBLIC_CALLRAIL_SRC;

  return (
    <>
      {ga4 && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${ga4}`}
            strategy="afterInteractive"
          />
          <Script id="ga4-init" strategy="afterInteractive">
            {`window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              window.gtag = gtag;
              gtag('js', new Date());
              gtag('config', '${ga4}');`}
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
