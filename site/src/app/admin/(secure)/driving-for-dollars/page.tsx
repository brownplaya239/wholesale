import type { Metadata } from "next";
import { getDb } from "@/lib/db";
import { getLead } from "@/lib/leads/store";
import type { PropertyInput } from "@/lib/inspection/model";
import InspectionWorkspace from "./InspectionWorkspace";

export const metadata: Metadata = { title: "Driving for dollars", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default async function InspectionPage({ searchParams }: { searchParams: Promise<{ lead?: string }> }) {
  const { lead } = await searchParams; const db = await getDb(); let initialProperty: PropertyInput | null = null;
  if (lead && db) {
    const record = await getLead(db, lead); const p = record?.dossier?.parcel.data; const g = record?.dossier?.geocode.data;
    if (record && g?.city) initialProperty = {
      address: record.addressCurrent.split(",")[0], city: g.city, batch: "Seller inquiries", sourceIds: [record.id],
      lat: g.lat, lng: g.lng, locationStatus: p ? "matched" : "candidate", pin: p?.pin ?? null, objectId: null,
      county: p?.county ?? null, block: p?.block ?? null, lot: p?.lot ?? null, qualifier: p?.qualifier ?? null,
      tenureYears: null, tenureConflict: false, mailDiff: p?.owner.absentee ?? null,
      outOfState: p?.owner.mailingState ? p.owner.mailingState !== "NJ" : null, sheriffDate: null,
      historicTaxAmount: null, floodSfha: null, propertyClass: p?.propClass ?? null,
      recordUrl: record.dossier?.parcel.source?.url ?? null, notes: "Imported from an existing property report; current title remains unverified.",
    };
  }
  return <InspectionWorkspace databaseConfigured={Boolean(db)} initialProperty={initialProperty} googleScoringAllowed={process.env.D4D_GOOGLE_DERIVED_CONTENT_ALLOWED === "true"} />;
}
