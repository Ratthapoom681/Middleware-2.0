CREATE TABLE IF NOT EXISTS defectdojo_viewer_products (
    product_key text PRIMARY KEY,
    defectdojo_product_id text,
    product_name text NOT NULL DEFAULT '',
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS defectdojo_viewer_products_defectdojo_product_id_uidx
    ON defectdojo_viewer_products (defectdojo_product_id)
    WHERE defectdojo_product_id IS NOT NULL AND defectdojo_product_id <> '';

CREATE INDEX IF NOT EXISTS defectdojo_viewer_products_name_idx
    ON defectdojo_viewer_products (product_name);

CREATE TABLE IF NOT EXISTS defectdojo_viewer_engagements (
    engagement_key text PRIMARY KEY,
    defectdojo_engagement_id text,
    engagement_name text NOT NULL DEFAULT '',
    product_key text NOT NULL DEFAULT 'product:unknown',
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS defectdojo_viewer_engagements_defectdojo_engagement_id_uidx
    ON defectdojo_viewer_engagements (defectdojo_engagement_id)
    WHERE defectdojo_engagement_id IS NOT NULL AND defectdojo_engagement_id <> '';

CREATE INDEX IF NOT EXISTS defectdojo_viewer_engagements_product_key_idx
    ON defectdojo_viewer_engagements (product_key);

ALTER TABLE defectdojo_viewer_findings
    ADD COLUMN IF NOT EXISTS defectdojo_finding_id text,
    ADD COLUMN IF NOT EXISTS product_key text,
    ADD COLUMN IF NOT EXISTS engagement_key text,
    ADD COLUMN IF NOT EXISTS defectdojo_product_id text,
    ADD COLUMN IF NOT EXISTS defectdojo_product_name text,
    ADD COLUMN IF NOT EXISTS defectdojo_engagement_id text,
    ADD COLUMN IF NOT EXISTS defectdojo_engagement_name text,
    ADD COLUMN IF NOT EXISTS title text,
    ADD COLUMN IF NOT EXISTS severity text,
    ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS mitigated boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS mitigation_confirmed_at timestamptz,
    ADD COLUMN IF NOT EXISTS cve_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
    ADD COLUMN IF NOT EXISTS endpoints jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS first_seen_sync_id bigint,
    ADD COLUMN IF NOT EXISTS last_seen_sync_id bigint,
    ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

UPDATE defectdojo_viewer_findings
SET
    defectdojo_finding_id = COALESCE(defectdojo_finding_id, finding_id, data->>'id'),
    defectdojo_product_id = COALESCE(defectdojo_product_id, data->>'product_id', data->'defectdojo_route'->>'projectId', data->>'test__engagement__product'),
    defectdojo_product_name = COALESCE(defectdojo_product_name, product_name, defectdojo_project_name, data->>'product_name', data->'defectdojo_route'->>'projectName'),
    defectdojo_engagement_id = COALESCE(defectdojo_engagement_id, data->>'engagement_id', data->'defectdojo_route'->>'engagementId', data->>'test__engagement'),
    defectdojo_engagement_name = COALESCE(defectdojo_engagement_name, data->>'engagement_name', data->'defectdojo_route'->>'engagementName'),
    title = COALESCE(title, data->>'title', data->>'name', 'Untitled finding'),
    severity = COALESCE(severity, data->>'severity', 'Info'),
    mitigated = CASE
        WHEN lower(COALESCE(data->>'is_mitigated', data->>'mitigated', 'false')) = 'true'
            OR NULLIF(data->>'mitigated_at', '') IS NOT NULL
            OR NULLIF(data->>'mitigation_confirmed_at', '') IS NOT NULL
        THEN true
        ELSE false
    END,
    active = CASE
        WHEN lower(COALESCE(data->>'active', 'true')) = 'false' THEN false
        WHEN lower(COALESCE(data->>'is_mitigated', data->>'mitigated', 'false')) = 'true'
            OR NULLIF(data->>'mitigated_at', '') IS NOT NULL
            OR NULLIF(data->>'mitigation_confirmed_at', '') IS NOT NULL
        THEN false
        ELSE true
    END,
    endpoints = COALESCE(endpoints, data->'endpoints', '[]'::jsonb),
    last_seen_at = COALESCE(last_seen_at, updated_at)
WHERE data IS NOT NULL;

UPDATE defectdojo_viewer_findings
SET
    product_key = COALESCE(product_key, CASE
        WHEN NULLIF(defectdojo_product_id, '') IS NOT NULL THEN 'product:id:' || defectdojo_product_id
        WHEN NULLIF(defectdojo_product_name, '') IS NOT NULL THEN 'product:name:' || lower(defectdojo_product_name)
        ELSE 'product:unknown'
    END),
    engagement_key = COALESCE(engagement_key, CASE
        WHEN NULLIF(defectdojo_engagement_id, '') IS NOT NULL THEN 'engagement:id:' || defectdojo_engagement_id
        WHEN NULLIF(defectdojo_engagement_name, '') IS NOT NULL THEN 'engagement:name:' || lower(defectdojo_engagement_name)
        ELSE 'engagement:unknown'
    END);

CREATE UNIQUE INDEX IF NOT EXISTS defectdojo_viewer_findings_defectdojo_finding_id_uidx
    ON defectdojo_viewer_findings (defectdojo_finding_id)
    WHERE defectdojo_finding_id IS NOT NULL AND defectdojo_finding_id <> '';

CREATE INDEX IF NOT EXISTS defectdojo_viewer_findings_product_engagement_idx
    ON defectdojo_viewer_findings (defectdojo_product_id, defectdojo_engagement_id);

CREATE INDEX IF NOT EXISTS defectdojo_viewer_findings_product_key_idx
    ON defectdojo_viewer_findings (product_key);

CREATE INDEX IF NOT EXISTS defectdojo_viewer_findings_engagement_key_idx
    ON defectdojo_viewer_findings (engagement_key);

CREATE INDEX IF NOT EXISTS defectdojo_viewer_findings_status_idx
    ON defectdojo_viewer_findings (active, mitigated);

CREATE INDEX IF NOT EXISTS defectdojo_viewer_findings_cve_ids_idx
    ON defectdojo_viewer_findings USING gin (cve_ids);

CREATE TABLE IF NOT EXISTS defectdojo_viewer_sync_history (
    id bigserial PRIMARY KEY,
    product_key text,
    product_id text,
    product_name text,
    engagement_key text,
    engagement_id text,
    engagement_name text,
    sync_type text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    status text NOT NULL DEFAULT 'partial',
    findings_pulled integer NOT NULL DEFAULT 0,
    tickets_pulled integer NOT NULL DEFAULT 0,
    findings_updated integer NOT NULL DEFAULT 0,
    tickets_updated integer NOT NULL DEFAULT 0,
    findings_mitigated integer NOT NULL DEFAULT 0,
    findings_still_active integer NOT NULL DEFAULT 0,
    warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
    errors jsonb NOT NULL DEFAULT '[]'::jsonb,
    requested_filters jsonb NOT NULL DEFAULT '{}'::jsonb,
    triggered_by text NOT NULL DEFAULT '',
    triggered_role text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS defectdojo_viewer_sync_history_started_at_idx
    ON defectdojo_viewer_sync_history (started_at DESC);

CREATE INDEX IF NOT EXISTS defectdojo_viewer_sync_history_product_engagement_idx
    ON defectdojo_viewer_sync_history (product_id, engagement_id);

CREATE TABLE IF NOT EXISTS defectdojo_viewer_redmine_tickets (
    ticket_key text PRIMARY KEY,
    sync_key text,
    issue_id text,
    product_key text,
    product_id text,
    product_name text,
    engagement_key text,
    engagement_id text,
    engagement_name text,
    cve_id text,
    finding_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
    status_id text,
    status_name text,
    normalized_status text,
    is_closed boolean NOT NULL DEFAULT false,
    subject text,
    issue_url text,
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    last_seen_sync_id bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS defectdojo_viewer_redmine_tickets_issue_id_idx
    ON defectdojo_viewer_redmine_tickets (issue_id);

CREATE INDEX IF NOT EXISTS defectdojo_viewer_redmine_tickets_product_engagement_idx
    ON defectdojo_viewer_redmine_tickets (product_id, engagement_id);

CREATE INDEX IF NOT EXISTS defectdojo_viewer_redmine_tickets_normalized_status_idx
    ON defectdojo_viewer_redmine_tickets (normalized_status);

CREATE INDEX IF NOT EXISTS defectdojo_viewer_redmine_tickets_finding_ids_idx
    ON defectdojo_viewer_redmine_tickets USING gin (finding_ids);

CREATE TABLE IF NOT EXISTS defectdojo_viewer_mitigation_rechecks (
    id bigserial PRIMARY KEY,
    sync_history_id bigint,
    ticket_key text,
    issue_id text,
    defectdojo_finding_id text,
    product_key text,
    product_id text,
    product_name text,
    engagement_key text,
    engagement_id text,
    engagement_name text,
    cve_id text,
    previous_status text,
    next_status text,
    result text NOT NULL,
    reason text NOT NULL DEFAULT '',
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS defectdojo_viewer_mitigation_rechecks_sync_idx
    ON defectdojo_viewer_mitigation_rechecks (sync_history_id);

CREATE INDEX IF NOT EXISTS defectdojo_viewer_mitigation_rechecks_product_engagement_idx
    ON defectdojo_viewer_mitigation_rechecks (product_id, engagement_id);

CREATE TABLE IF NOT EXISTS defectdojo_viewer_mitigation_reviews (
    review_key text PRIMARY KEY,
    sync_history_id bigint,
    ticket_key text,
    issue_id text,
    defectdojo_finding_id text,
    product_key text,
    product_id text,
    product_name text,
    engagement_key text,
    engagement_id text,
    engagement_name text,
    cve_id text,
    title text,
    endpoint text,
    severity text,
    redmine_status_id text,
    redmine_status_name text,
    mitigation_confirmed_at timestamptz,
    last_sync_history_id bigint,
    state text NOT NULL DEFAULT 'pending',
    ignored_reason text,
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    reviewed_by text,
    reviewed_at timestamptz
);

CREATE INDEX IF NOT EXISTS defectdojo_viewer_mitigation_reviews_state_idx
    ON defectdojo_viewer_mitigation_reviews (state);

CREATE INDEX IF NOT EXISTS defectdojo_viewer_mitigation_reviews_product_engagement_idx
    ON defectdojo_viewer_mitigation_reviews (product_id, engagement_id);

CREATE TABLE IF NOT EXISTS defectdojo_viewer_admin_actions (
    id bigserial PRIMARY KEY,
    action text NOT NULL,
    review_key text,
    ticket_key text,
    issue_id text,
    defectdojo_finding_id text,
    product_key text,
    product_id text,
    product_name text,
    engagement_key text,
    engagement_id text,
    engagement_name text,
    cve_id text,
    actor text NOT NULL DEFAULT '',
    actor_role text NOT NULL DEFAULT '',
    reason text NOT NULL DEFAULT '',
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS defectdojo_viewer_admin_actions_review_key_idx
    ON defectdojo_viewer_admin_actions (review_key);

CREATE INDEX IF NOT EXISTS defectdojo_viewer_admin_actions_product_engagement_idx
    ON defectdojo_viewer_admin_actions (product_id, engagement_id);
