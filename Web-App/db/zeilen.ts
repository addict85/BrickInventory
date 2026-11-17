// Erzeugt von scripts/zeilentypen.js aus db/schema-stand.sql; nicht von Hand ändern.
// Neu erzeugen nach jeder Migration: npm run schema:stand && npm run schema:zeilen

/** Je Tabelle die Spalten, wie node-pg sie liefert (NUMERIC als Zahl, BIGINT als Text). */
export interface Tabellen {
  account_link_invites: {
    token_hash: string;
    main_user_id: number;
    created_at: Date;
    expires_at: Date;
    used_at: Date | null;
    used_by: number | null;
  };
  account_links: {
    main_user_id: number;
    sub_user_id: number;
    created_at: Date;
  };
  api_aufrufe: {
    tag: Date;
    api: string;
    konto: number;
    anzahl: number;
  };
  api_takt: {
    api: string;
    naechster: Date;
  };
  api_tokens: {
    token: string;
    user_id: number;
    created_at: Date | null;
    last_used: Date | null;
    expires_at: Date | null;
    sliding: boolean;
    hard_expires_at: Date | null;
    never_expires: boolean;
    label: string | null;
    scope: string;
    ip_bereich: string | null;
    rotiert_am: Date;
    vorgaenger: string | null;
    ersetzt_durch: string | null;
  };
  api_tokens_verbraucht: {
    token: string;
    user_id: number;
    familie: Date;
    verbraucht_am: Date;
  };
  app_logs: {
    id: string;
    level: string;
    message: string;
    logged_at: Date;
  };
  auftraege: {
    id: string;
    art: string;
    nutzlast: unknown;
    user_id: number | null;
    schluessel: string | null;
    status: string;
    versuche: number;
    max_versuche: number;
    faellig_ab: Date;
    belegt_von: string | null;
    fehler: string | null;
    erstellt: Date;
    aktualisiert: Date;
    frist_bis: Date | null;
    gestartet: Date | null;
    fortschritt: unknown | null;
    ergebnis: unknown | null;
    wartet: boolean;
  };
  auftrag_exklusiv: {
    art: string;
  };
  auftrag_pausen: {
    art: string;
    bis: Date;
    grund: string | null;
    stufe: number;
  };
  auftrags_arten: {
    art: string;
  };
  bl_zuordnung: {
    art: string;
    rb_id: string;
    bl_id: string | null;
    fetched_at: Date | null;
  };
  bl_zuordnung_eigen: {
    user_id: number;
    art: string;
    rb_id: string;
    bl_id: string;
    updated_at: Date;
  };
  catalog_cache: {
    set_number: string;
    is_gear: boolean;
    bl_type: string | null;
    fetched_at: Date | null;
  };
  figur_eigen: {
    user_id: number;
    fig_number: string;
    fig_name: string | null;
    image_url: string | null;
    updated_at: Date;
  };
  geraete_nonces: {
    nonce: string;
    user_id: number;
    familie: Date;
    aus_qr: boolean;
    angelegt_am: Date;
    ablauf: Date;
  };
  geraete_schluessel: {
    user_id: number;
    familie: Date;
    oeffentlich: string;
    angelegt_am: Date;
    attestiert: boolean;
  };
  global_settings: {
    key: string;
    value: string;
    updated_at: Date | null;
  };
  gutschein_guthaben_schranke: {
    id: number;
    letzter_abruf: Date | null;
    sperre_bis: Date | null;
  };
  household_former_links: {
    main_user_id: number;
    sub_user_id: number;
    via_user_id: number | null;
    created_at: Date;
  };
  idempotenz: {
    user_id: number;
    schluessel: string;
    anfrage: string;
    status: number | null;
    antwort: string | null;
    angelegt: Date;
    wirkung: boolean;
  };
  image_misses: {
    cache_key: string;
    checked_at: Date;
    reason: string | null;
  };
  image_wanted: {
    url: string;
    set_number: string | null;
    requested_at: Date;
  };
  import_stand: {
    user_id: number;
    status: string;
    total: number;
    done: number;
    current: string | null;
    results: unknown;
    error: string | null;
    started_at: Date;
    updated_at: Date;
    run_id: string | null;
  };
  instructions: {
    id: number;
    user_id: number;
    set_number: string;
    url: string;
    description: string | null;
    local_path: string | null;
    downloaded_at: Date | null;
  };
  laufzustand: {
    schluessel: string;
    wert: string;
    aktualisiert: Date;
  };
  minifig_acquisitions: {
    id: number;
    user_id: number;
    fig_number: string;
    quantity: number;
    unit_price: number | null;
    condition: string;
    created_at: Date;
    currency: string;
    price_estimated: boolean;
    tag: Date | null;
  };
  minifig_parts_cache: {
    fig_number: string;
    data: string;
    fetched_at: Date | null;
  };
  minifig_price_cache: {
    id: number;
    fig_number: string;
    condition: string;
    currency_code: string;
    avg_price: number | null;
    qty_avg_price: number | null;
    fetched_at: Date | null;
    geschaetzt: boolean;
    abdeckung: number | null;
  };
  minifig_price_history: {
    id: number;
    fig_number: string;
    condition: string;
    currency_code: string;
    avg_price: number | null;
    qty_avg_price: number | null;
    recorded_at: Date;
    geschaetzt: boolean;
    abdeckung: number | null;
  };
  minifigs: {
    id: number;
    user_id: number;
    set_number: string | null;
    fig_number: string;
    source: string | null;
    storage_id: number | null;
  };
  minifigs_catalog: {
    fig_number: string;
    fig_name: string | null;
    image_url: string | null;
    image_local: string | null;
    updated_at: Date | null;
  };
  papierkorb: {
    id: number;
    user_id: number;
    art: string;
    nummer: string;
    farbe_id: number | null;
    bezeichnung: string | null;
    zeilen: unknown;
    geloescht_am: Date;
  };
  part_acquisitions: {
    id: number;
    user_id: number;
    part_number: string;
    color_id: number;
    quantity: number;
    unit_price: number | null;
    condition: string;
    created_at: Date;
    currency: string;
    price_estimated: boolean;
    tag: Date | null;
  };
  part_catalog: {
    part_number: string;
    part_name: string | null;
    category_name: string | null;
    updated_at: Date | null;
  };
  part_color_catalog: {
    part_number: string;
    color_id: number;
    color_name: string | null;
    color_hex: string | null;
    image_url: string | null;
    image_local: string | null;
    updated_at: Date | null;
  };
  part_price_cache: {
    id: number;
    part_number: string;
    color_id: number;
    condition: string;
    currency_code: string;
    avg_price: number | null;
    qty_avg_price: number | null;
    fetched_at: Date | null;
  };
  part_price_history: {
    id: number;
    part_number: string;
    color_id: number;
    condition: string;
    currency_code: string;
    avg_price: number | null;
    qty_avg_price: number | null;
    recorded_at: Date;
  };
  parts: {
    id: number;
    user_id: number;
    set_number: string | null;
    part_number: string;
    color_id: number;
    source: string | null;
    storage_id: number | null;
    added_at: Date | null;
  };
  parts_katalog_offen: {
    id: string;
    nummer: string;
  };
  parts_summary: {
    user_id: number;
    part_key: string;
    color_id: number;
    part_number: string | null;
    bl_part_number: string | null;
    part_name: string | null;
    color_name: string | null;
    color_hex: string | null;
    category_name: string | null;
    image_url: string | null;
    image_local: string | null;
    is_spare: boolean;
    total_quantity: string | null;
    in_sets: string | null;
    storage: string | null;
  };
  parts_summary_state: {
    user_id: number;
    built_version: string;
    built_at: Date | null;
  };
  parts_version_user: {
    user_id: number;
    v: string;
  };
  passkeys: {
    id: number;
    user_id: number;
    credential_id: string;
    public_key: Buffer;
    sign_count: string;
    transports: string | null;
    name: string | null;
    created_at: Date;
    last_used: Date | null;
  };
  price_alerts: {
    user_id: number;
    set_number: string;
    condition: string;
    richtung: string;
    schwelle: number;
    currency_code: string;
    ausgeloest: boolean;
    zuletzt_am: Date | null;
    zuletzt_preis: number | null;
    created_at: Date;
  };
  price_cache: {
    id: number;
    set_number: string;
    condition: string;
    currency_code: string;
    min_price: number | null;
    avg_price: number | null;
    max_price: number | null;
    qty_avg_price: number | null;
    total_quantity: number | null;
    fetched_at: Date | null;
  };
  price_history: {
    id: number;
    set_number: string;
    condition: string;
    currency_code: string;
    avg_price: number | null;
    qty_avg_price: number | null;
    min_price: number | null;
    max_price: number | null;
    recorded_at: Date | null;
  };
  qr_login_tokens: {
    token: string;
    user_id: number;
    expires_at: Date;
    used_at: Date | null;
    token_days: number | null;
    id: string;
    abholung: string | null;
    code_hash: string | null;
    geraet: string | null;
    ip_bereich: string | null;
    fehlversuche: number;
    bestaetigt_am: Date | null;
    abgelehnt_am: Date | null;
    abgeholt_am: Date | null;
  };
  rate_limit_attempts: {
    key: string;
    count: number;
    first_at: Date;
    last_at: Date | null;
    laufend: number;
    laufend_seit: Date | null;
  };
  rb_colors: {
    id: number;
    name: string | null;
    rgb: string | null;
    is_trans: boolean;
    bl_color_id: number | null;
  };
  rb_inventories: {
    id: number;
    set_num: string | null;
    version: number | null;
  };
  rb_inventory_minifigs: {
    id: number;
    inventory_id: number;
    fig_num: string;
    quantity: number | null;
  };
  rb_inventory_parts: {
    id: number;
    inventory_id: number;
    part_num: string;
    color_id: number | null;
    quantity: number | null;
    is_spare: boolean;
    img_url: string | null;
  };
  rb_part_categories: {
    id: number;
    name: string | null;
  };
  rb_parts: {
    part_num: string;
    name: string | null;
    part_cat_id: number | null;
    part_img_url: string | null;
  };
  rb_sets: {
    set_num: string;
    name: string | null;
    year: number | null;
    theme_id: number | null;
    num_parts: number | null;
    set_img_url: string | null;
    herkunft: string;
  };
  rb_themes: {
    id: number;
    name: string | null;
    parent_id: number | null;
  };
  schema_migrations: {
    name: string;
    applied_at: Date;
    pruefsumme: string | null;
  };
  schritt_challenges: {
    challenge: string;
    user_id: number;
    familie: Date;
    aktion: string;
    angelegt_am: Date;
    ablauf: Date;
  };
  schritt_freigaben: {
    user_id: number;
    familie: Date;
    aktion: string;
    bis: Date;
    hoechstens: Date;
  };
  set_acquisitions: {
    id: number;
    user_id: number;
    set_number: string;
    quantity: number;
    purchase_price: number | null;
    created_at: Date;
    condition: string;
    currency: string;
    price_estimated: boolean;
    tag: Date | null;
  };
  set_catalog: {
    set_number: string;
    minifigs: number | null;
    image_url: string | null;
    image_local: string | null;
    brickset_id: number | null;
    updated_at: Date | null;
  };
  set_figuren: {
    set_number: string;
    fig_number: string;
    quantity: number;
    updated_at: Date;
  };
  set_teile: {
    set_number: string;
    part_number: string;
    color_id: number;
    is_spare: boolean;
    quantity: number | null;
    updated_at: Date | null;
  };
  sets: {
    id: number;
    user_id: number;
    set_number: string;
    added_at: Date | null;
    updated_at: Date | null;
    storage_id: number | null;
  };
  shared_instructions: {
    id: number;
    set_number: string;
    url: string;
    description: string | null;
    local_path: string | null;
    fetched_at: Date | null;
  };
  storage_locations: {
    id: number;
    user_id: number;
    name: string;
    created_at: Date | null;
  };
  subsets_cache: {
    set_number: string;
    data: string;
    fetched_at: Date | null;
  };
  teil_eigen: {
    user_id: number;
    part_number: string;
    part_name: string | null;
    category_name: string | null;
    updated_at: Date;
  };
  teil_farbe_eigen: {
    user_id: number;
    part_number: string;
    color_id: number;
    color_name: string | null;
    color_hex: string | null;
    image_url: string | null;
    updated_at: Date;
  };
  user_sessions: {
    sid: string;
    sess: unknown;
    expire: Date;
  };
  user_settings: {
    user_id: number;
    key: string;
    value: string;
    updated_at: Date | null;
  };
  users: {
    id: number;
    username: string;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
    password_hash: string;
    is_admin: boolean;
    is_active: boolean;
    email_verified: boolean;
    verification_token: string | null;
    token_expires: Date | null;
    reset_token: string | null;
    reset_token_expires: Date | null;
    must_change_password: boolean;
    created_at: Date | null;
    sitzungs_version: number;
    registrierung_offen: boolean;
    email_neu: string | null;
    email_neu_token: string | null;
    email_neu_bis: Date | null;
  };
  verwalter_uebernahmen: {
    ziel_id: number;
    art: string;
    durch_id: number;
    passwort_hash: string | null;
    angelegt_am: Date;
    wirksam_ab: Date;
    abbruch_hash: string | null;
  };
  verwaltungsprotokoll: {
    id: number;
    zeit: Date;
    verwalter_id: number | null;
    ziel_id: number | null;
    ziel_name: string | null;
    aktion: string;
    einzelheiten: string | null;
  };
  vouchers: {
    id: number;
    user_id: number;
    number: string;
    pin: string | null;
    amount: number;
    currency: string;
    pdf_path: string | null;
    created_at: Date;
    updated_at: Date;
    guthaben_geprueft_am: Date | null;
    nummer_suche: string | null;
  };
  wanted: {
    id: number;
    user_id: number;
    set_number: string;
    condition: string;
    created_at: Date;
  };
  webauthn_challenges: {
    challenge: string;
    user_id: number | null;
    zweck: string;
    expires_at: Date;
  };
  wechselkurse: {
    tag: Date;
    waehrung: string;
    je_eur: number;
  };
  zweiter_faktor: {
    user_id: number;
    geheimnis: string;
    aktiv: boolean;
    letzter_schritt: string;
    eingerichtet_am: Date;
  };
  zweiter_faktor_codes: {
    id: number;
    user_id: number;
    code_hash: string;
    verbraucht_am: Date | null;
    alt_gilt_bis: Date | null;
  };
}

/** Ausgewählte Spalten einer Tabelle: `Spalten<"sets", "user_id" | "set_number">`. */
export type Spalten<T extends keyof Tabellen, S extends keyof Tabellen[T]> = Pick<Tabellen[T], S>;
