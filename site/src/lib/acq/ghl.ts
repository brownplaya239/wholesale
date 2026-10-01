/**
 * Thin HighLevel (LeadConnector) API client — sub-account Private Integration
 * Token, Version 2021-07-28. Endpoint shapes verified against
 * marketplace.gohighlevel.com/docs on 2026-10-01; anything GHL changes is
 * isolated here.
 *
 * Rate limit: 100 requests / 10 s per location (burst) and 200k/day. Calls
 * are spaced ~110 ms and 429/5xx are retried with backoff, so a 1,000-owner
 * wave (~5-6k calls) takes ~10 minutes and never trips the limiter.
 */

export type GhlConfig = {
  token: string;
  locationId: string;
  version?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  minIntervalMs?: number;
  maxRetries?: number;
};

export class GhlError extends Error {
  constructor(
    public status: number,
    public path: string,
    public body: string
  ) {
    super(`GHL ${status} ${path}: ${body.slice(0, 300)}`);
  }
}

export type CustomFieldValue = { id: string; field_value: unknown };

export type GhlContact = {
  id: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  tags?: string[];
  assignedTo?: string;
  customFields?: Record<string, unknown>[];
  dnd?: boolean;
};

export type GhlOpportunity = {
  id: string;
  name?: string;
  pipelineId: string;
  pipelineStageId: string;
  status: string;
  contactId?: string;
  assignedTo?: string;
  customFields?: Record<string, unknown>[];
};

export type GhlField = { id: string; name: string; fieldKey?: string; dataType?: string; model?: string };
export type GhlPipeline = { id: string; name: string; stages: { id: string; name: string }[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A custom field's value from any GHL response shape (contacts use `value`,
 * opportunities `fieldValue*`, writes echo `field_value`). */
export function cfValue(cf: Record<string, unknown>): unknown {
  for (const k of ["value", "fieldValue", "field_value", "fieldValueString", "fieldValueNumber", "fieldValueDate", "fieldValueArray"]) {
    if (cf[k] !== undefined && cf[k] !== null) return cf[k];
  }
  return null;
}

export class Ghl {
  readonly locationId: string;
  private token: string;
  private version: string;
  private base: string;
  private f: typeof fetch;
  private gap: number;
  private retries: number;
  private queue: Promise<void> = Promise.resolve();
  private last = 0;

  constructor(c: GhlConfig) {
    this.token = c.token;
    this.locationId = c.locationId;
    this.version = c.version ?? "2021-07-28";
    this.base = (c.baseUrl ?? "https://services.leadconnectorhq.com").replace(/\/$/, "");
    this.f = c.fetchImpl ?? fetch;
    this.gap = c.minIntervalMs ?? 110;
    this.retries = c.maxRetries ?? 4;
  }

  /** Serializes requests with a minimum spacing (shared by every caller). */
  private async slot(): Promise<void> {
    const prev = this.queue;
    let release!: () => void;
    this.queue = new Promise((r) => (release = r));
    await prev;
    const wait = this.last + this.gap - Date.now();
    if (wait > 0) await sleep(wait);
    this.last = Date.now();
    release();
  }

  async req<T = Record<string, unknown>>(
    method: string,
    path: string,
    opts: { query?: Record<string, string | number | undefined>; body?: unknown } = {}
  ): Promise<T> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    for (let attempt = 0; ; attempt++) {
      await this.slot();
      const res = await this.f(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Version: this.version,
          Accept: "application/json",
          ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const text = await res.text();
        return (text ? JSON.parse(text) : {}) as T;
      }
      const body = await res.text();
      if ((res.status === 429 || res.status >= 500) && attempt < this.retries) {
        const ra = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      throw new GhlError(res.status, `${method} ${path}`, body);
    }
  }

  // ------------------------------------------------------------ contacts --
  /** Dedupes per the location's "Allow Duplicate Contact" setting (phone/email).
   * Never pass `tags` here — upsert REPLACES all tags; use addTags. */
  upsertContact(body: Record<string, unknown>) {
    return this.req<{ contact: GhlContact; new?: boolean }>("POST", "/contacts/upsert", {
      body: { locationId: this.locationId, ...body },
    });
  }
  getContact(id: string) {
    return this.req<{ contact: GhlContact }>("GET", `/contacts/${id}`);
  }
  updateContact(id: string, body: Record<string, unknown>) {
    return this.req<{ contact: GhlContact }>("PUT", `/contacts/${id}`, { body });
  }
  addTags(id: string, tags: string[]) {
    return tags.length ? this.req("POST", `/contacts/${id}/tags`, { body: { tags } }) : Promise.resolve({});
  }
  removeTags(id: string, tags: string[]) {
    return tags.length ? this.req("DELETE", `/contacts/${id}/tags`, { body: { tags } }) : Promise.resolve({});
  }
  addNote(id: string, body: string) {
    return this.req("POST", `/contacts/${id}/notes`, { body: { body } });
  }
  addTask(id: string, t: { title: string; body?: string; dueDate: string; assignedTo?: string }) {
    return this.req("POST", `/contacts/${id}/tasks`, { body: { ...t, completed: false } });
  }

  // ------------------------------------------------------- custom fields --
  async listFields(model: "contact" | "opportunity"): Promise<GhlField[]> {
    const r = await this.req<{ customFields?: GhlField[] }>("GET", `/locations/${this.locationId}/customFields`, {
      query: { model },
    });
    return (r.customFields ?? []).filter((f) => !f.model || f.model === model);
  }
  createField(model: "contact" | "opportunity", def: { name: string; dataType: string; options?: readonly string[] }) {
    return this.req<{ customField: GhlField }>("POST", `/locations/${this.locationId}/customFields`, {
      body: { name: def.name, dataType: def.dataType, model, ...(def.options ? { options: def.options } : {}) },
    });
  }
  listObjectFields(objectKey: string) {
    return this.req<{ fields?: GhlField[]; folders?: { id: string; name: string }[] }>(
      "GET",
      `/custom-fields/object-key/${encodeURIComponent(objectKey)}`,
      { query: { locationId: this.locationId } }
    );
  }
  createObjectFolder(objectKey: string, name: string) {
    return this.req<{ id?: string; folder?: { id: string } }>("POST", "/custom-fields/folder", {
      body: { locationId: this.locationId, objectKey, name },
    });
  }
  createObjectField(
    objectKey: string,
    parentId: string,
    def: { name: string; key: string; dataType: string; options?: readonly string[] }
  ) {
    return this.req("POST", "/custom-fields/", {
      body: {
        locationId: this.locationId,
        objectKey,
        parentId,
        name: def.name,
        fieldKey: `${objectKey}.${def.key}`,
        dataType: def.dataType,
        showInForms: false,
        ...(def.options ? { options: def.options.map((o) => ({ key: o.toLowerCase().replace(/\W+/g, "_"), label: o })) } : {}),
      },
    });
  }

  // ------------------------------------------------------ custom objects --
  getObject(key: string) {
    return this.req<{ object?: { id: string; key: string } }>("GET", `/objects/${encodeURIComponent(key)}`, {
      query: { locationId: this.locationId },
    });
  }
  createRecord(key: string, properties: Record<string, unknown>) {
    return this.req<{ record: { id: string } }>("POST", `/objects/${encodeURIComponent(key)}/records`, {
      body: { locationId: this.locationId, properties },
    });
  }
  updateRecord(key: string, id: string, properties: Record<string, unknown>) {
    return this.req<{ record: { id: string } }>("PUT", `/objects/${encodeURIComponent(key)}/records/${id}`, {
      query: { locationId: this.locationId },
      body: { properties },
    });
  }
  searchRecords(key: string, query: string) {
    return this.req<{ records?: { id: string; properties?: Record<string, unknown> }[] }>(
      "POST",
      `/objects/${encodeURIComponent(key)}/records/search`,
      { body: { locationId: this.locationId, page: 1, pageLimit: 10, query } }
    );
  }

  // -------------------------------------------------------- associations --
  listAssociations() {
    return this.req<{ associations?: { id: string; key: string; firstObjectKey: string; secondObjectKey: string }[] }>(
      "GET",
      "/associations/",
      { query: { locationId: this.locationId } }
    );
  }
  createAssociation(body: { key: string; firstObjectLabel: string; firstObjectKey: string; secondObjectLabel: string; secondObjectKey: string }) {
    return this.req<{ id?: string; association?: { id: string } }>("POST", "/associations/", {
      body: { locationId: this.locationId, ...body },
    });
  }
  relate(associationId: string, firstRecordId: string, secondRecordId: string) {
    return this.req("POST", "/associations/relations", {
      body: { locationId: this.locationId, associationId, firstRecordId, secondRecordId },
    });
  }

  // ------------------------------------------------------- opportunities --
  async listPipelines(): Promise<GhlPipeline[]> {
    const r = await this.req<{ pipelines?: GhlPipeline[] }>("GET", "/opportunities/pipelines", {
      query: { locationId: this.locationId },
    });
    return r.pipelines ?? [];
  }
  createPipeline(name: string, stages: readonly string[]) {
    return this.req("POST", "/opportunities/pipelines", {
      body: {
        locationId: this.locationId,
        name,
        stages: stages.map((s, i) => ({ name: s, position: i, showInFunnel: true })),
      },
    });
  }
  createOpportunity(body: Record<string, unknown>) {
    return this.req<{ opportunity: GhlOpportunity }>("POST", "/opportunities/", {
      body: { locationId: this.locationId, ...body },
    });
  }
  getOpportunity(id: string) {
    return this.req<{ opportunity: GhlOpportunity }>("GET", `/opportunities/${id}`);
  }
  updateOpportunity(id: string, body: Record<string, unknown>) {
    return this.req<{ opportunity: GhlOpportunity }>("PUT", `/opportunities/${id}`, { body });
  }

  // ----------------------------------------------------------- workflows --
  async listWorkflows(): Promise<{ id: string; name: string; status?: string }[]> {
    const r = await this.req<{ workflows?: { id: string; name: string; status?: string }[] }>("GET", "/workflows/", {
      query: { locationId: this.locationId },
    });
    return r.workflows ?? [];
  }
}

export function ghlConfigured(): boolean {
  return Boolean(process.env.GHL_TOKEN && process.env.GHL_LOCATION_ID);
}

export function ghlFromEnv(): Ghl | null {
  if (!ghlConfigured()) return null;
  return new Ghl({ token: process.env.GHL_TOKEN!, locationId: process.env.GHL_LOCATION_ID! });
}
