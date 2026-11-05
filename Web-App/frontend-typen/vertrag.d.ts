// Erzeugt von scripts/vertrag-frontend-typen.js aus docs/openapi.json — nicht von Hand ändern.
// Neu schreiben: npm run vertrag:frontend

export type Acquisition = {
  id: number;
  quantity: number;
  purchase_price?: number | null;
  unit_price?: number | null;
  condition: string;
  created_at?: string | null;
  owner_user_id?: number | null;
  price_estimated: boolean;
  currency?: string | null;
  [feld: string]: unknown;
};
export type AcquisitionsResponse = {
  success: boolean;
  owner_user_id?: number;
  acquisitions: Acquisition[];
  totals: AcquisitionTotals;
  [feld: string]: unknown;
};
export type AcquisitionTotals = {
  quantity: number;
  amount?: number | null;
  priced_rows: number;
  [feld: string]: unknown;
};
export type AddMinifigResponse = {
  success: boolean;
  action?: string | null;
  fig_number?: string | null;
  fig_name?: string | null;
  price_from_condition?: string | null;
  error?: string | null;
  [feld: string]: unknown;
};
export type AddPartResponse = {
  success: boolean;
  action?: string | null;
  part_number?: string | null;
  part_name?: string | null;
  price_from_condition?: string | null;
  error?: string | null;
  [feld: string]: unknown;
};
export type AddSetResponse = {
  success?: boolean;
  action?: string | null;
  set_number?: string | null;
  name?: string | null;
  katalog_offen?: boolean;
  error?: string | null;
  [feld: string]: unknown;
};
export type AnleitungenGeladen = {
  success: true;
  count: number;
  instructions: Instruction[];
  [feld: string]: unknown;
};
export type AnleitungHochgeladen = {
  success: boolean;
  error?: string | null;
  set?: {
    set_number?: string;
    condition?: string | null;
    acq_count?: number | null;
    used_count?: number | null;
    conditions?: string[];
    max_purchase_price?: number | null;
    avg_purchase_price?: number | null;
    [feld: string]: unknown;
  } | null;
  parts?: number | null;
  minifigs?: number | null;
  source_emptied?: boolean;
  quantity?: number | null;
  instruction: {
    url: string;
    description: string | null;
    local_path: string;
    [feld: string]: unknown;
  };
  [feld: string]: unknown;
};
export type AnmeldeNutzer = {
  id: number;
  username: string;
  is_admin?: boolean;
  mustChangePassword?: boolean;
  zweiterFaktorPflicht?: boolean;
  [feld: string]: unknown;
};
export type ApiLimits = {
  rebrickable: number;
  bricklink: number;
  brickset: number;
  [feld: string]: unknown;
};
export type ApiLimitsResponse = {
  success: boolean;
  limits: ApiLimits;
  [feld: string]: unknown;
};
export type AppThemeResponse = {
  success: boolean;
  theme: string;
  vorgabe?: string | null;
  eigenes?: string | null;
  error?: string | null;
  [feld: string]: unknown;
};
export type AppToken = {
  token_id: string;
  label?: string | null;
  created_at?: string | null;
  last_used?: string | null;
  expires_at?: string | null;
  never_expires: boolean;
  aktuell: boolean;
  token_prefix?: string | null;
  hard_expires_at?: string | null;
  scope?: string | null;
  ip_bereich?: string | null;
  rotiert_am?: string | null;
  [feld: string]: unknown;
};
export type AuftraegeResponse = {
  success: boolean;
  auftraege: Auftrag[];
  zusammenfassung: AuftragZaehler[];
  pausen: AuftragPause[];
  bildbedarf: number;
  job_prozess: JobProzess;
  [feld: string]: unknown;
};
export type Auftrag = {
  id: string;
  art: string;
  status: string;
  versuche: number;
  max_versuche: number;
  faellig_ab: string | null;
  frist_bis: string | null;
  gestartet: string | null;
  erstellt: string | null;
  aktualisiert: string | null;
  fortschritt: AuftragFortschritt | null;
  fehler: string | null;
  user_id: number | null;
  geplant: boolean;
  set_number: string | null;
  [feld: string]: unknown;
};
export type AuftragAenderung = {
  success: boolean;
  id: string;
  status: string;
  [feld: string]: unknown;
};
export type AuftragFortschritt = {
  erledigt?: number | null;
  gesamt?: number | null;
  text?: string | null;
  [feld: string]: unknown;
};
export type AuftragPause = {
  art: string;
  bis: string | null;
  grund: string | null;
  [feld: string]: unknown;
};
export type AuftragsArtLeerung = {
  success: boolean;
  art: string;
  entfernt: number;
  [feld: string]: unknown;
};
export type AuftragsArtStart = {
  success: boolean;
  art: string;
  gestartet: boolean;
  [feld: string]: unknown;
};
export type AuftragZaehler = {
  art: string;
  status: string;
  anzahl: number;
  [feld: string]: unknown;
};
export type BarcodeResponse = {
  success: boolean;
  set_number: string;
  name?: string | null;
  year?: number | null;
  pieces?: number | null;
  theme?: string | null;
  minifigs?: number | null;
  image_url?: string | null;
  image_local?: string | null;
  source?: string | null;
  unsicher: boolean;
  error?: string | null;
  [feld: string]: unknown;
};
export type BestandEintrag = {
  gesamt?: number;
  lose?: number;
  [feld: string]: unknown;
};
export type BestandGeleert = {
  success: true;
  sets: number;
  teile: number;
  figuren: number;
  papierkorb: number[];
  [feld: string]: unknown;
};
export type BestandResponse = {
  success?: boolean;
  bestand?: Record<string, BestandEintrag>;
  error?: string | null;
  [feld: string]: unknown;
};
export type BildDiagnose = {
  success: true;
  set_number: string;
  hinweise: string[];
  datenbank: {
    zeilen: {
      user_id: number;
      [feld: string]: unknown;
    }[];
    katalog_bild: string | null;
    [feld: string]: unknown;
  };
  lokal: {
    original: {
      vorhanden: boolean;
      bytes: number;
      [feld: string]: unknown;
    };
    vorschau: {
      vorhanden: boolean;
      bytes: number;
      [feld: string]: unknown;
    };
    [feld: string]: unknown;
  };
  proxy: {
    gecacht: boolean;
    [feld: string]: unknown;
  };
  merker: {
    seit: string | null;
    grund: string | null;
    [feld: string]: unknown;
  } | null;
  [feld: string]: unknown;
};
export type BildMerkerVergessen = {
  success: true;
  entfernt: number;
  hinweis: string;
  [feld: string]: unknown;
};
export type BlFarbTabelle = {
  success: true;
  source: string;
  map: Record<string, unknown>;
  [feld: string]: unknown;
};
export type BrickColor = {
  id: number;
  name: string;
  hex?: string | null;
  [feld: string]: unknown;
};
export type BrickColorsResponse = {
  success: boolean;
  colors: BrickColor[];
  error?: string | null;
  [feld: string]: unknown;
};
export type BricklinkVerweise = {
  success: true;
  links: Record<string, unknown>;
  [feld: string]: unknown;
};
export type BricksetQueueEntry = {
  set_number: string;
  name?: string | null;
  attempts: number;
  retry_after?: string | null;
  last_error?: string | null;
  [feld: string]: unknown;
};
export type BricksetQueueResponse = {
  success: boolean;
  count: number;
  entries: BricksetQueueEntry[];
  [feld: string]: unknown;
};
export type CacheStatsResponse = {
  success: boolean;
  prices: number;
  subsets: number;
  catalog: number;
  price_stale: number;
  rate_limits?: RateLimits | null;
  [feld: string]: unknown;
};
export type CacheTtlResponse = {
  success: boolean;
  ttl: string;
  [feld: string]: unknown;
};
export type CatalogMetaResponse = {
  success: boolean;
  themes: CatalogTheme[];
  year_min?: number | null;
  year_max?: number | null;
  year_counts: CatalogYearCount[];
  error?: string | null;
  [feld: string]: unknown;
};
export type CatalogSetDetail = {
  set_number: string;
  name?: string | null;
  year?: number | null;
  theme_id?: number | null;
  theme_name?: string | null;
  num_parts?: number | null;
  image_url?: string | null;
  image_local?: string | null;
  minifigs: number;
  owned: boolean;
  owned_quantity: number;
  bricklink?: {
    type: string;
    number: string;
    url?: string | null;
    exact: boolean;
    resolved: boolean;
    [feld: string]: unknown;
  } | null;
  preisvergleich_url?: string | null;
  [feld: string]: unknown;
};
export type CatalogSetDetailResponse = {
  success: boolean;
  set?: CatalogSetDetail | null;
  error?: string | null;
  [feld: string]: unknown;
};
export type CatalogSetItem = {
  set_number: string;
  name?: string | null;
  year?: number | null;
  theme_id?: number | null;
  theme_name?: string | null;
  num_parts?: number | null;
  image_url?: string | null;
  image_local?: string | null;
  owned: boolean;
  owned_quantity: number;
  [feld: string]: unknown;
};
export type CatalogSetsResponse = {
  success: boolean;
  total: number;
  page: number;
  pages: number;
  sets: CatalogSetItem[];
  error?: string | null;
  [feld: string]: unknown;
};
export type CatalogTheme = {
  id: number;
  name: string;
  set_count: number;
  [feld: string]: unknown;
};
export type CatalogYearCount = {
  year: number;
  n: number;
  [feld: string]: unknown;
};
export type CatalogYearVerteilungResponse = {
  success: boolean;
  years: JahrAnzahl[];
  [feld: string]: unknown;
};
export type ChartPoint = {
  x_label: string;
  value: number;
  y_frac: number;
  [feld: string]: unknown;
};
export type ChartYAxis = {
  label: string;
  value: number;
  frac: number;
  [feld: string]: unknown;
};
export type ConditionValuation = {
  market_price?: number | null;
  purchase_price?: number | null;
  pnl_pct?: number | null;
  [feld: string]: unknown;
};
export type CsvImportStatus = {
  success: boolean;
  status?: string | null;
  total?: number | null;
  done?: number | null;
  current?: string | null;
  ok?: number | null;
  warn?: number | null;
  err?: number | null;
  error?: string | null;
  [feld: string]: unknown;
};
export type CurrentByCondition = {
  N?: CurrentPrice | null;
  U?: CurrentPrice | null;
  [feld: string]: unknown;
};
export type CurrentPrice = {
  condition: string;
  avg_price?: number | null;
  min_price?: number | null;
  max_price?: number | null;
  fetched_at?: string | null;
  [feld: string]: unknown;
};
export type DashboardStats = {
  total_sets: number;
  total_quantity: number;
  total_pieces: number;
  total_instructions: number;
  total_parts: number;
  set_parts?: number;
  manual_parts?: number;
  total_minifigs: number;
  [feld: string]: unknown;
};
export type DefaultConditionResponse = {
  success: boolean;
  condition: string;
  [feld: string]: unknown;
};
export type DELETE_api_v1_minifigs_figNumber = {
  success: boolean;
  error?: string | null;
  set?: {
    set_number?: string;
    condition?: string | null;
    acq_count?: number | null;
    used_count?: number | null;
    conditions?: string[];
    max_purchase_price?: number | null;
    avg_purchase_price?: number | null;
    [feld: string]: unknown;
  } | null;
  parts?: number | null;
  minifigs?: number | null;
  source_emptied?: boolean;
  quantity?: number | null;
  papierkorb: number[];
  [feld: string]: unknown;
};
export type DELETE_api_v1_papierkorb_id = {
  success: true;
  [feld: string]: unknown;
};
export type DeleteWithQuantityResponse = {
  success: boolean;
  new_quantity?: number;
  [feld: string]: unknown;
};
export type Diagnose = Record<string, unknown>;
export type Einrichtung = {
  success: true;
  offen: boolean;
  passwort_aendern: boolean;
  quellen: {
    rebrickable: boolean;
    bricklink: boolean;
    brickset: boolean;
    [feld: string]: unknown;
  };
  [feld: string]: unknown;
};
export type EinstellungenGespeichert = {
  success: boolean;
  error?: string | null;
  set?: {
    set_number?: string;
    condition?: string | null;
    acq_count?: number | null;
    used_count?: number | null;
    conditions?: string[];
    max_purchase_price?: number | null;
    avg_purchase_price?: number | null;
    [feld: string]: unknown;
  } | null;
  parts?: number | null;
  minifigs?: number | null;
  source_emptied?: boolean;
  quantity?: number | null;
  updated: number;
  [feld: string]: unknown;
};
export type Endpunkte = {
  api: string;
  version: string;
  endpoints: Record<string, unknown>;
  [feld: string]: unknown;
};
export type Fehler = {
  success: false;
  error: string;
  code: string;
  [feld: string]: unknown;
};
export type FigsValuationResponse = {
  success: boolean;
  currency: string;
  figs: Array<{
    id?: number | null;
    fig_number: string;
    bl_fig_number?: string | null;
    fig_name?: string | null;
    quantity: number;
    image_url?: string | null;
    image_local?: string | null;
    unit_price?: number | null;
    purchase_price?: number | null;
    avg_purchase_price?: number | null;
    qty_avg_price?: number | null;
    avg_price?: number | null;
    pnl_pct?: string | null;
    pnl_prozent?: number | null;
    display_value?: string | null;
    wert_gesamt?: number | null;
    condition?: string | null;
    conditions: string[];
    user_id?: number | null;
    owners?: {
      id: number;
      username: string;
      [feld: string]: unknown;
    }[];
    acquisitions: Array<{
      id: number;
      condition: string;
      quantity: number;
      purchase_price?: number | null;
      avg_price?: number | null;
      total_avg?: string | null;
      wert_gesamt?: number | null;
      pnl_pct?: string | null;
      pnl_prozent?: number | null;
      created_at?: string | null;
      owner_user_id?: number | null;
      [feld: string]: unknown;
    }>;
    storage?: string | null;
    [feld: string]: unknown;
  }>;
  total_value: string;
  kaufpreise_fremde_waehrung: number;
  error?: string | null;
  [feld: string]: unknown;
};
export type FigurTeile = {
  success: true;
  source: string;
  parts: Record<string, unknown>[];
  [feld: string]: unknown;
};
export type ForgotPasswordResponse = {
  success: boolean;
  message?: string | null;
  error?: string | null;
  [feld: string]: unknown;
};
export type GelesenerGutschein = {
  number?: string | null;
  pin?: string | null;
  amount?: number | null;
  currency?: string | null;
  [feld: string]: unknown;
};
export type Geloescht = {
  success: true;
  deleted: number;
  [feld: string]: unknown;
};
export type Gesundheit = {
  status: "ok" | "starting";
  startup?: StartupStatus;
  db_pool?: Record<string, unknown>;
  uptime_seconds?: number;
  [feld: string]: unknown;
};
export type GET_api_v1_minifigs = {
  success: boolean;
  total?: number;
  source?: string;
  figs: Array<{
    fig_number: string;
    condition?: string | null;
    conditions: string[];
    owners?: {
      id: number;
      username: string;
      [feld: string]: unknown;
    }[];
    avg_purchase_price?: number | null;
    fig_name?: string | null;
    quantity: number;
    total_quantity?: number | null;
    image_url?: string | null;
    image_local?: string | null;
    source: string;
    set_added_at?: string | null;
    [feld: string]: unknown;
  }>;
  error?: string | null;
  [feld: string]: unknown;
};
export type GET_api_v1_minifigs_figNumber_sets = {
  success: boolean;
  item?: {
    nummer: string;
    name?: string | null;
    color_id?: number | null;
    color_name?: string | null;
    color_hex?: string | null;
    category_name?: string | null;
    image_local?: string | null;
    image_url?: string | null;
    is_spare: boolean;
    storage?: string | null;
    owner_ids: number[];
    total_quantity: number;
    [feld: string]: unknown;
  } | null;
  sets: Array<{
    set_number: string;
    set_name?: string | null;
    quantity: number;
    image_local?: string | null;
    image_url?: string | null;
    owner_user_id: number;
    [feld: string]: unknown;
  }>;
  error?: string | null;
  [feld: string]: unknown;
};
export type GET_api_v1_sets_setNumber_parts_list = {
  success: boolean;
  total: number;
  page: number;
  page_size: number;
  parts: Array<{
    part_number: string;
    bl_part_number?: string | null;
    part_name?: string | null;
    color_id: number;
    bl_color_id?: number | null;
    color_name?: string | null;
    color_hex?: string | null;
    category_name?: string | null;
    image_url?: string | null;
    image_local?: string | null;
    total_quantity: number;
    in_sets?: string | null;
    is_spare: boolean;
    [feld: string]: unknown;
  }>;
  error?: string | null;
  [feld: string]: unknown;
};
export type GetrenntesKonto = {
  id: number;
  username: string;
  via?: string | null;
  [feld: string]: unknown;
};
export type GuthabenAntwort = {
  success?: boolean;
  voucher?: Gutschein | null;
  angezeigt?: string | null;
  waehrung_geaendert?: boolean;
  grund?: string | null;
  wartenSek?: number | null;
  error?: string | null;
  code?: string | null;
  [feld: string]: unknown;
};
export type Gutschein = {
  id: number;
  number: string;
  pin?: string | null;
  amount: number;
  currency: string;
  hat_pdf: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  guthaben_geprueft_am?: string | null;
  [feld: string]: unknown;
};
export type GutscheinAntwort = {
  success?: boolean;
  voucher?: Gutschein | null;
  mehrere?: GutscheinStapel | null;
  gelesen?: GelesenerGutschein | null;
  error?: string | null;
  code?: string | null;
  [feld: string]: unknown;
};
export type GutscheinKlartext = {
  success: true;
  id: number;
  number: string;
  pin: string | null;
  [feld: string]: unknown;
};
export type GutscheinListe = {
  success: boolean;
  vouchers: Gutschein[];
  [feld: string]: unknown;
};
export type GutscheinStapel = {
  added?: number;
  updated?: number;
  errors?: number;
  total?: number;
  [feld: string]: unknown;
};
export type HouseholdInviteCheckResponse = {
  success: boolean;
  inviter: {
    id: number;
    username: string;
    [feld: string]: unknown;
  };
  [feld: string]: unknown;
};
export type HouseholdInviteResponse = {
  success?: boolean;
  code?: string | null;
  expires_in?: number | null;
  error?: string | null;
  [feld: string]: unknown;
};
export type HouseholdMember = {
  id: number;
  username: string;
  is_self: boolean;
  [feld: string]: unknown;
};
export type HouseholdMembersResponse = {
  success: boolean;
  members: HouseholdMember[];
  [feld: string]: unknown;
};
export type HouseholdStatusResponse = {
  success: boolean;
  is_main: boolean;
  is_sub: boolean;
  currency: string;
  linked_to?: {
    id: number;
    username: string;
    [feld: string]: unknown;
  } | null;
  parents: {
    id: number;
    username: string;
    [feld: string]: unknown;
  }[];
  sub_accounts: HouseholdMember[];
  open_invites: number;
  former_links: GetrenntesKonto[];
  error?: string | null;
  [feld: string]: unknown;
};
export type Instruction = {
  id?: number | null;
  url: string;
  description?: string | null;
  local_path?: string | null;
  is_manual: boolean;
  [feld: string]: unknown;
};
export type JahrAnzahl = {
  year?: number | null;
  n: number;
  [feld: string]: unknown;
};
export type JobProzess = {
  lebenszeichen: string | null;
  alter_sekunden: number | null;
  laeuft: boolean;
  [feld: string]: unknown;
};
export type JobSchedule = {
  type: string;
  time?: string | null;
  minutes?: number | null;
  [feld: string]: unknown;
};
export type JobsResponse = {
  success: boolean;
  jobs: Record<string, JobStatus>;
  schedules: Record<string, JobSchedule>;
  [feld: string]: unknown;
};
export type JobStatus = {
  label: string;
  status: string;
  progress: number;
  total: number;
  sub?: string | null;
  [feld: string]: unknown;
};
export type KontenListe = {
  success: true;
  users: KontoInListe[];
  [feld: string]: unknown;
};
export type KontoAktiv = {
  success: true;
  is_active: boolean;
  [feld: string]: unknown;
};
export type KontoInListe = {
  id: number;
  username: string;
  is_admin: boolean;
  is_active: boolean;
  created_at: string | null;
  zweiter_faktor: boolean;
  wartet_auf_bestaetigung?: boolean;
  [feld: string]: unknown;
};
export type Lagerort = {
  ort: string;
  sets: number;
  teile: number;
  [feld: string]: unknown;
};
export type LagerortEintrag = {
  id: number;
  user_id: number;
  name: string;
  [feld: string]: unknown;
};
export type LagerortEintragResponse = {
  success?: boolean;
  ort?: LagerortEintrag | null;
  error?: string | null;
  [feld: string]: unknown;
};
export type LagerorteResponse = {
  success: boolean;
  orte: Lagerort[];
  error?: string | null;
  [feld: string]: unknown;
};
export type LagerortResponse = {
  success?: boolean;
  storage?: string | null;
  changed?: number;
  error?: string | null;
  [feld: string]: unknown;
};
export type LagerortVorgabeResponse = {
  success?: boolean;
  vorgabe?: LagerortEintrag | null;
  error?: string | null;
  [feld: string]: unknown;
};
export type LagerortVorratResponse = {
  success: boolean;
  orte: LagerortEintrag[];
  vorgabe?: LagerortEintrag | null;
  error?: string | null;
  [feld: string]: unknown;
};
export type Lebenszeichen = {
  status: "ok";
};
export type LoginResponse = {
  success: boolean;
  token?: string | null;
  user?: AnmeldeNutzer | null;
  error?: string | null;
  zweiter_faktor?: boolean;
  never_expires?: boolean;
  token_info?: TokenAngaben | null;
  [feld: string]: unknown;
};
export type ManualFigsResponse = {
  success: boolean;
  figs: Array<{
    id?: number | null;
    fig_number: string;
    bl_fig_number?: string | null;
    fig_name?: string | null;
    quantity: number;
    image_url?: string | null;
    image_local?: string | null;
    unit_price?: number | null;
    purchase_price?: number | null;
    avg_purchase_price?: number | null;
    qty_avg_price?: number | null;
    avg_price?: number | null;
    pnl_pct?: string | null;
    pnl_prozent?: number | null;
    display_value?: string | null;
    wert_gesamt?: number | null;
    condition?: string | null;
    conditions: string[];
    user_id?: number | null;
    owners?: {
      id: number;
      username: string;
      [feld: string]: unknown;
    }[];
    acquisitions?: Array<{
      id: number;
      condition: string;
      quantity: number;
      purchase_price?: number | null;
      avg_price?: number | null;
      total_avg?: string | null;
      wert_gesamt?: number | null;
      pnl_pct?: string | null;
      pnl_prozent?: number | null;
      created_at?: string | null;
      owner_user_id?: number | null;
      [feld: string]: unknown;
    }>;
    storage?: string | null;
    [feld: string]: unknown;
  }>;
  error?: string | null;
  [feld: string]: unknown;
};
export type ManualPartsResponse = {
  success: boolean;
  parts: Array<{
    id?: number | null;
    part_number: string;
    bl_part_number?: string | null;
    part_name?: string | null;
    color_id: number;
    color_name?: string | null;
    color_hex?: string | null;
    quantity: number;
    image_url?: string | null;
    image_local?: string | null;
    unit_price?: number | null;
    purchase_price?: number | null;
    avg_purchase_price?: number | null;
    qty_avg_price?: number | null;
    avg_price?: number | null;
    pnl_pct?: string | null;
    pnl_prozent?: number | null;
    display_value?: string | null;
    wert_gesamt?: number | null;
    condition?: string | null;
    conditions: string[];
    user_id?: number | null;
    owners?: {
      id: number;
      username: string;
      [feld: string]: unknown;
    }[];
    acquisitions?: Array<{
      id: number;
      condition: string;
      quantity: number;
      purchase_price?: number | null;
      avg_price?: number | null;
      total_avg?: string | null;
      wert_gesamt?: number | null;
      pnl_pct?: string | null;
      pnl_prozent?: number | null;
      created_at?: string | null;
      owner_user_id?: number | null;
      [feld: string]: unknown;
    }>;
    storage?: string | null;
    [feld: string]: unknown;
  }>;
  error?: string | null;
  [feld: string]: unknown;
};
export type MeResponse = {
  success: boolean;
  loggedIn: boolean;
  user?: {
    id: number;
    username: string;
    is_admin: boolean;
    mustChangePassword?: boolean;
    zweiterFaktorPflicht: boolean;
    [feld: string]: unknown;
  } | null;
  token_expires?: string | null;
  token_last_used?: string | null;
  token_info?: TokenInfo | null;
  [feld: string]: unknown;
};
export type MerklisteResponse = {
  success: boolean;
  merkposten: Merkposten[];
  error?: string | null;
  [feld: string]: unknown;
};
export type Merkposten = {
  set_number: string;
  condition: string;
  created_at?: string | null;
  user_id: number;
  name?: string | null;
  year?: number | null;
  num_parts?: number | null;
  image_url?: string | null;
  image_local?: string | null;
  marktpreis?: number | null;
  waehrung: string;
  owned: boolean;
  alarm?: MerkpostenAlarm | null;
  preisvergleich_url?: string | null;
  [feld: string]: unknown;
};
export type MerkpostenAlarm = {
  richtung: string;
  schwelle: number;
  ausgeloest: boolean;
  [feld: string]: unknown;
};
export type MerkpostenAntwort = {
  success?: boolean;
  war_neu?: boolean;
  merkposten?: Merkposten | null;
  error?: string | null;
  [feld: string]: unknown;
};
export type MerkpostenGeloescht = {
  success: boolean;
  error?: string | null;
  set?: {
    set_number?: string;
    condition?: string | null;
    acq_count?: number | null;
    used_count?: number | null;
    conditions?: string[];
    max_purchase_price?: number | null;
    avg_purchase_price?: number | null;
    [feld: string]: unknown;
  } | null;
  parts?: number | null;
  minifigs?: number | null;
  source_emptied?: boolean;
  quantity?: number | null;
  geloescht: number;
  [feld: string]: unknown;
};
export type MerkpostenInhaberAntwort = {
  success?: boolean;
  verschoben?: boolean;
  zusammengefuehrt?: boolean;
  owner_user_id?: number | null;
  error?: string | null;
  [feld: string]: unknown;
};
export type MerkpostenPreiseResponse = {
  success: boolean;
  set_number: string;
  currency: string;
  current: CurrentByCondition;
  error?: string | null;
  [feld: string]: unknown;
};
export type MerkpostenUebernahmeResponse = {
  success?: boolean;
  action?: string | null;
  set_number?: string | null;
  error?: string | null;
  [feld: string]: unknown;
};
export type MinifigStats = {
  types: number;
  total_quantity: number;
  manual: number;
  [feld: string]: unknown;
};
export type MinifigStatsResponse = {
  success: boolean;
  stats: MinifigStats;
  [feld: string]: unknown;
};
export type MoveSetResponse = {
  success?: boolean;
  set_number?: string;
  quantity?: number;
  acquisitions?: number;
  merged?: boolean;
  parts?: number;
  minifigs?: number;
  instructions?: number;
  source_emptied?: boolean;
  from_user_id?: number;
  to_user_id?: number;
  error?: string | null;
  [feld: string]: unknown;
};
export type Papierkorb = {
  success: true;
  eintraege: PapierkorbEintrag[];
  [feld: string]: unknown;
};
export type PapierkorbEintrag = {
  id: number;
  art: "set" | "teil" | "figur";
  nummer: string;
  farbe_id: number | null;
  bezeichnung: string | null;
  anzahl: number;
  user_id: number;
  geloescht_am: string;
  endgueltig_am: string;
  [feld: string]: unknown;
};
export type PapierkorbGeleert = {
  success: true;
  entfernt: number;
  [feld: string]: unknown;
};
export type PartsCategoriesResponse = {
  success: boolean;
  categories: PartsCategory[];
  [feld: string]: unknown;
};
export type PartsCategory = {
  category_name?: string | null;
  label?: string | null;
  unique_parts: number;
  total_quantity: number;
  [feld: string]: unknown;
};
export type PartsFilterColor = {
  color_name?: string | null;
  color_hex?: string | null;
  unique_parts: number;
  total_quantity: number;
  [feld: string]: unknown;
};
export type PartsFilterColorsResponse = {
  success: boolean;
  colors: PartsFilterColor[];
  [feld: string]: unknown;
};
export type PartsStats = {
  unique_parts: number;
  unique_colors: number;
  total_parts: number;
  manual_parts?: number;
  [feld: string]: unknown;
};
export type PartsStatsResponse = {
  success: boolean;
  stats?: PartsStats | null;
  [feld: string]: unknown;
};
export type PartsValuationResponse = {
  success: boolean;
  currency: string;
  parts: Array<{
    id?: number | null;
    part_number: string;
    bl_part_number?: string | null;
    part_name?: string | null;
    color_id: number;
    color_name?: string | null;
    color_hex?: string | null;
    quantity: number;
    image_url?: string | null;
    image_local?: string | null;
    unit_price?: number | null;
    purchase_price?: number | null;
    avg_purchase_price?: number | null;
    qty_avg_price?: number | null;
    avg_price?: number | null;
    pnl_pct?: string | null;
    pnl_prozent?: number | null;
    display_value?: string | null;
    wert_gesamt?: number | null;
    condition?: string | null;
    conditions: string[];
    user_id?: number | null;
    owners?: {
      id: number;
      username: string;
      [feld: string]: unknown;
    }[];
    acquisitions: Array<{
      id: number;
      condition: string;
      quantity: number;
      purchase_price?: number | null;
      avg_price?: number | null;
      total_avg?: string | null;
      wert_gesamt?: number | null;
      pnl_pct?: string | null;
      pnl_prozent?: number | null;
      created_at?: string | null;
      owner_user_id?: number | null;
      [feld: string]: unknown;
    }>;
    storage?: string | null;
    [feld: string]: unknown;
  }>;
  total_value: string;
  kaufpreise_fremde_waehrung: number;
  error?: string | null;
  [feld: string]: unknown;
};
export type Passkey = {
  id: number;
  name: string | null;
  transports?: string | null;
  created_at: string | null;
  last_used: string | null;
  [feld: string]: unknown;
};
export type PasskeyAngelegt = {
  success: true;
  passkey: {
    id: number;
    name: string;
    [feld: string]: unknown;
  };
  [feld: string]: unknown;
};
export type PasskeyAnmeldung = {
  success: true;
  token?: string | null;
  user: {
    id: number;
    username: string;
    is_admin: boolean;
    mustChangePassword?: boolean;
    zweiterFaktorPflicht?: boolean;
    [feld: string]: unknown;
  };
  error?: string | null;
  zweiter_faktor?: boolean;
  never_expires?: boolean;
  token_info?: TokenAngaben | null;
  [feld: string]: unknown;
};
export type PasskeyListe = {
  success: true;
  verfuegbar: boolean;
  passkeys: Passkey[];
  [feld: string]: unknown;
};
export type PasskeyOptionen = {
  success: true;
  optionen: Record<string, unknown>;
  [feld: string]: unknown;
};
export type PdfAuftrag = {
  success: true;
  jobId: string;
  [feld: string]: unknown;
};
export type PdfEingabe = {
  sets?: Array<{
    set_number: string;
    name?: string | null;
  }>;
  parts?: Array<{
    part_number: string;
    bl_part_number?: string | null;
    part_name?: string | null;
    color_name?: string | null;
    color_hex?: string | null;
    color_id?: number | null;
    quantity: number | string;
    is_fig?: boolean | number | null;
    image_url?: string | null;
    image_local?: string | null;
  }>;
};
export type PdfFreigabe = {
  success: true;
  ticket: string;
  gueltig_sek: number;
  [feld: string]: unknown;
};
export type PdfStand = {
  success: true;
  status: string;
  error?: string | null;
  etaSeconds?: number | null;
  missingImages?: unknown;
  [feld: string]: unknown;
};
export type PendingAlertsResponse = {
  success: boolean;
  alerts: Preisalarm[];
  now?: string | null;
  error?: string | null;
  [feld: string]: unknown;
};
export type PnlResponse = {
  success: boolean;
  currency: string;
  totals: PnlTotals;
  sets: PnlSetZeile[];
  error?: string | null;
  [feld: string]: unknown;
};
export type PnlSetZeile = {
  set_number: string;
  quantity: number;
  current_price?: number | null;
  baseline_price?: number | null;
  pnl_pct?: string | null;
  baseline_pnl_pct?: string | null;
  pnl_betrag?: number | null;
  pnl_prozent?: number | null;
  baseline_pnl_prozent?: number | null;
  kachel_preis?: number | null;
  kachel_pnl_pct?: number | null;
  kachel_quelle?: "markt" | "kauf" | null;
  [feld: string]: unknown;
};
export type PnlTotals = {
  purchase: string;
  current: string;
  pnl_pct?: string | null;
  pnl_prozent?: number | null;
  kaufpreise_fremde_waehrung: number;
  sets_purchase?: string | null;
  parts_purchase?: string | null;
  figs_purchase?: string | null;
  grand_total?: string | null;
  positionen?: number;
  positionen_bewertet?: number;
  positionen_ohne_marktpreis?: number;
  positionen_ohne_kaufpreis?: number;
  basis_einstand?: string;
  basis_marktwert?: string;
  basis_guv_betrag?: string;
  ohne_marktpreis_einstand?: string;
  ohne_kaufpreis_marktwert?: string;
  [feld: string]: unknown;
};
export type PortfolioHistoryResponse = {
  success: boolean;
  currency: string;
  period: string;
  points: ChartPoint[];
  y_axis: ChartYAxis[];
  period_change_pct?: number | null;
  purchase_total?: string | null;
  [feld: string]: unknown;
};
export type POST_api_v1_auth_email_bestaetigen_vorschau = {
  success: true;
  username: string;
  [feld: string]: unknown;
};
export type POST_api_v1_minifigs_import_csv = {
  success: boolean;
  skipped?: number;
  skipped_hint?: string;
  total?: number;
  added?: number;
  imported?: number;
  updated?: number;
  errors?: number;
  error?: string | null;
  [feld: string]: unknown;
};
export type POST_api_v1_sets_import_csv_cancel = {
  success: boolean;
  error?: string | null;
  enqueued?: number;
  [feld: string]: unknown;
};
export type Preisalarm = {
  set_number: string;
  condition: string;
  richtung: string;
  schwelle: number;
  currency_code: string;
  ausgeloest: boolean;
  zuletzt_am?: string | null;
  zuletzt_preis?: number | null;
  name?: string | null;
  image_local?: string | null;
  image_url?: string | null;
  set_img_url?: string | null;
  besitzt: boolean;
  [feld: string]: unknown;
};
export type PreisalarmeResponse = {
  success: boolean;
  alerts: Preisalarm[];
  error?: string | null;
  [feld: string]: unknown;
};
export type PreisalarmResponse = {
  success?: boolean;
  alert?: Preisalarm | null;
  removed?: number;
  error?: string | null;
  [feld: string]: unknown;
};
export type PreisJobStand = {
  success: boolean;
  job: {
    running: boolean;
    lastRun: string | null;
    nextRun: string | null;
    lastErrors: number;
    log: unknown[];
    [feld: string]: unknown;
  };
  rate_limit: {
    count: number;
    limit: number;
    remaining: number;
    [feld: string]: unknown;
  };
  [feld: string]: unknown;
};
export type PriceByCondition = {
  N?: ConditionValuation | null;
  U?: ConditionValuation | null;
  [feld: string]: unknown;
};
export type PriceChartData = {
  values: PriceChartSeries[];
  x: string[];
  [feld: string]: unknown;
};
export type PriceChartPoint = {
  x: string;
  y: number;
  [feld: string]: unknown;
};
export type PriceChartSeries = {
  name: string;
  values: PriceChartPoint[];
  firstRealIndex: number;
  [feld: string]: unknown;
};
export type PriceHistoryPoint = {
  recorded_at: string;
  qty_avg_price?: number | null;
  avg_price?: number | null;
  min_price?: number | null;
  max_price?: number | null;
  [feld: string]: unknown;
};
export type PriceHistoryResponse = {
  success: boolean;
  set_number?: string;
  currency: string;
  history_new: PriceHistoryPoint[];
  history_used: PriceHistoryPoint[];
  by_condition: PriceByCondition;
  chart: PriceChartData;
  pnl_pct?: string | null;
  pnl_prozent?: number | null;
  purchase_price?: number | null;
  [feld: string]: unknown;
};
export type Profil = {
  id: number;
  username: string;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email_verified: boolean;
  email_neu?: string | null;
  [feld: string]: unknown;
};
export type ProfilGespeichert = {
  success: boolean;
  error?: string | null;
  set?: {
    set_number?: string;
    condition?: string | null;
    acq_count?: number | null;
    used_count?: number | null;
    conditions?: string[];
    max_purchase_price?: number | null;
    avg_purchase_price?: number | null;
    [feld: string]: unknown;
  } | null;
  parts?: number | null;
  minifigs?: number | null;
  source_emptied?: boolean;
  quantity?: number | null;
  emailChanged?: boolean;
  emailSent?: boolean;
  [feld: string]: unknown;
};
export type ProfilResponse = {
  success: boolean;
  user?: Profil | null;
  error?: string | null;
  [feld: string]: unknown;
};
export type ProtokollEintraege = {
  success: true;
  eintraege: Record<string, unknown>[];
  [feld: string]: unknown;
};
export type ProtokollResponse = {
  success: boolean;
  minutes: number;
  count: number;
  logs: ProtokollZeile[];
  error?: string | null;
  [feld: string]: unknown;
};
export type ProtokollZeile = {
  id?: number | null;
  level?: string | null;
  message?: string | null;
  logged_at?: string | null;
  [feld: string]: unknown;
};
export type PUT_api_v1_sets_setNumber_acquisitions_acqId = {
  success: boolean;
  error?: string | null;
  set?: {
    set_number?: string;
    condition?: string | null;
    acq_count?: number | null;
    used_count?: number | null;
    conditions?: string[];
    max_purchase_price?: number | null;
    avg_purchase_price?: number | null;
    [feld: string]: unknown;
  } | null;
  parts?: number | null;
  minifigs?: number | null;
  source_emptied?: boolean;
  quantity?: number | null;
  [feld: string]: unknown;
};
export type QrLoginResponse = {
  success: boolean;
  token?: string | null;
  user?: AnmeldeNutzer | null;
  error?: string | null;
  zweiter_faktor?: boolean;
  never_expires?: boolean;
  token_info?: TokenAngaben | null;
  username: string;
  isAdmin: false;
  userId: number;
  [feld: string]: unknown;
};
export type QrToken = {
  success: true;
  token: string;
  expires_in: number;
  url: string;
  token_days?: number | null;
  fp?: string;
  [feld: string]: unknown;
};
export type RateLimit = {
  count: number;
  limit: number;
  remaining: number;
  [feld: string]: unknown;
};
export type RateLimits = {
  bricklink: RateLimit;
  rebrickable: RateLimit;
  brickset: RateLimit;
  [feld: string]: unknown;
};
export type RegisterResponse = {
  success: boolean;
  message?: string | null;
  email_sent?: boolean;
  console_mode?: boolean;
  error?: string | null;
  [feld: string]: unknown;
};
export type RegistrationStatusResponse = {
  enabled: boolean;
  passkey?: boolean;
  passwort_vergessen?: boolean;
  mail_versand?: boolean;
  [feld: string]: unknown;
};
export type RoheEinstellungen = {
  success: true;
  settings: Record<string, string>;
  [feld: string]: unknown;
};
export type SetExistsResponse = {
  success: boolean;
  exists: boolean;
  set_number: string;
  owner_user_id?: number | null;
  is_self?: boolean;
  [feld: string]: unknown;
};
export type SetInfoResponse = {
  success: boolean;
  set_number: string;
  name?: string | null;
  im_katalog?: boolean;
  [feld: string]: unknown;
};
export type SetItem = {
  set_number: string;
  name?: string | null;
  year?: number | null;
  theme?: string | null;
  pieces?: number | null;
  minifigs?: number | null;
  quantity: number;
  image_url?: string | null;
  image_local?: string | null;
  added_at?: string | null;
  condition?: string | null;
  storage?: string | null;
  conditions: string[];
  owners?: {
    id: number;
    username: string;
    [feld: string]: unknown;
  }[];
  max_purchase_price?: number | null;
  avg_purchase_price?: number | null;
  used_count?: number | null;
  instructions: Instruction[];
  bricklink?: {
    type: string;
    number: string;
    url?: string | null;
    exact: boolean;
    resolved: boolean;
    [feld: string]: unknown;
  } | null;
  preisvergleich_url?: string | null;
  [feld: string]: unknown;
};
export type SetPriceResponse = {
  success: boolean;
  set_number: string;
  currency: string;
  avg_price?: number | null;
  min_price?: number | null;
  max_price?: number | null;
  qty_avg_price?: number | null;
  no_price: boolean;
  [feld: string]: unknown;
};
export type SetResponse = {
  success: boolean;
  set?: SetItem | null;
  error?: string | null;
  [feld: string]: unknown;
};
export type SetsResponse = {
  success: boolean;
  count: number;
  sets: SetItem[];
  total: number;
  themes?: string[];
  error?: string | null;
  [feld: string]: unknown;
};
export type SettingsResponse = {
  success: boolean;
  settings: UserSettings;
  error?: string | null;
  [feld: string]: unknown;
};
export type Sicherung = {
  version: string;
  exported_at: string;
  exported_by: string | null;
  global: Record<string, string>;
  user_settings: Record<string, string>;
  [feld: string]: unknown;
};
export type SicherungEingespielt = {
  success: true;
  imported: number;
  note: string;
  smtp_uebergangen?: string[];
  [feld: string]: unknown;
};
export type SmtpProbe = {
  success: boolean;
  [feld: string]: unknown;
};
export type StartupStatus = {
  ready: boolean;
  step?: string | null;
  progress: number;
  total: number;
  sub?: string | null;
  [feld: string]: unknown;
};
export type StatsResponse = {
  success: boolean;
  stats?: DashboardStats | null;
  [feld: string]: unknown;
};
export type TeileGeladen = {
  success: true;
  count: number;
  [feld: string]: unknown;
};
export type TeilFarbeResponse = {
  success?: boolean;
  zusammengelegt?: boolean;
  verschoben?: number;
  vereint?: number;
  error?: string | null;
  [feld: string]: unknown;
};
export type TlsStand = {
  success: true;
  https: boolean;
  fp: string | null;
  fp_hex?: string;
  subject?: string;
  gueltig_bis?: string;
  download?: string;
  [feld: string]: unknown;
};
export type TokenAngaben = {
  scope: string;
  expires_at?: string | null;
  hard_expires_at?: string | null;
  never_expires: boolean;
  rotiert_am?: string | null;
  rotation_faellig?: boolean;
  [feld: string]: unknown;
};
export type TokenErstellt = {
  success: true;
  token: string;
  label: string | null;
  never_expires: boolean;
  token_info: TokenAngaben | null;
  [feld: string]: unknown;
};
export type TokenInfo = {
  scope: string;
  expires_at?: string | null;
  hard_expires_at?: string | null;
  never_expires: boolean;
  rotiert_am?: string | null;
  rotation_faellig: boolean;
  [feld: string]: unknown;
};
export type TokenRotation = {
  success: boolean;
  token?: string | null;
  token_info?: TokenAngaben | null;
  alt_gueltig_bis?: string | null;
  ueberlappung_sek?: number | null;
  [feld: string]: unknown;
};
export type TokensResponse = {
  success: boolean;
  tokens: AppToken[];
  error?: string | null;
  [feld: string]: unknown;
};
export type TokenWiderruf = {
  success: boolean;
  deleted?: number;
  [feld: string]: unknown;
};
export type Totals = {
  min: string;
  avg: string;
  max: string;
  qty_avg: string;
  [feld: string]: unknown;
};
export type User = {
  id: number;
  username: string;
  is_admin: boolean;
  [feld: string]: unknown;
};
export type UserSettings = {
  currency: string;
  price_condition: string;
  price_cache_ttl: string;
  default_price_condition: string;
  user_default_condition?: string | null;
  effective_condition: string;
  app_theme: string;
  [feld: string]: unknown;
};
export type ValuationResponse = {
  success: boolean;
  total_value: string;
  currency: string;
  condition: string;
  ttl_stunden?: number | null;
  kaufpreise_fremde_waehrung: number;
  sets: ValuationSet[];
  totals: Totals;
  error?: string | null;
  [feld: string]: unknown;
};
export type ValuationSet = {
  set_number: string;
  added_at?: string | null;
  name?: string | null;
  year?: number | null;
  quantity: number;
  image_local?: string | null;
  image_url?: string | null;
  min_price?: number | null;
  avg_price?: number | null;
  max_price?: number | null;
  qty_avg_price?: number | null;
  total_qty_avg?: string | null;
  total_avg?: string | null;
  wert_gesamt?: number | null;
  pnl_prozent?: number | null;
  purchase_price?: number | null;
  from_cache: boolean;
  is_fallback: boolean;
  condition_used?: string | null;
  no_price: boolean;
  acquisitions: Array<{
    id: number;
    condition: string;
    quantity: number;
    purchase_price?: number | null;
    avg_price?: number | null;
    total_avg?: string | null;
    wert_gesamt?: number | null;
    pnl_pct?: string | null;
    pnl_prozent?: number | null;
    created_at?: string | null;
    owner_user_id?: number | null;
    [feld: string]: unknown;
  }>;
  mixed: boolean;
  owners?: {
    id: number;
    username: string;
    [feld: string]: unknown;
  }[];
  error?: string | null;
  [feld: string]: unknown;
};
export type VerwaltungDesign = {
  success: boolean;
  error?: string | null;
  enqueued?: number;
  theme: string;
  [feld: string]: unknown;
};
export type VerwaltungGestartet = {
  success: boolean;
  error?: string | null;
  enqueued?: number;
  started: boolean;
  [feld: string]: unknown;
};
export type VerwaltungMeldung = {
  success: boolean;
  error?: string | null;
  enqueued?: number;
  message?: string;
  [feld: string]: unknown;
};
export type VerwaltungSet = {
  success: boolean;
  error?: string | null;
  enqueued?: number;
  set_number: string;
  [feld: string]: unknown;
};
export type VerwaltungTtl = {
  success: boolean;
  error?: string | null;
  enqueued?: number;
  ttl: string | number;
  [feld: string]: unknown;
};
export type VerwaltungZustand = {
  success: boolean;
  error?: string | null;
  enqueued?: number;
  condition: string | null;
  [feld: string]: unknown;
};
export type WantedXmlErgebnis = {
  success: true;
  vorschau: boolean;
  gelesen: number;
  angelegt: number;
  aufgestockt: number;
  fehler: number;
  posten: {
    art: string;
    blId: string;
    menge: number;
    ausgang: string;
    [feld: string]: unknown;
  }[];
  offen: {
    art: string;
    blId: string;
    [feld: string]: unknown;
  }[];
  [feld: string]: unknown;
};
export type Wiederhergestellt = {
  success: true;
  art: "set" | "teil" | "figur";
  nummer: string;
  user_id: number;
  [feld: string]: unknown;
};
export type ZweiterFaktorCodes = {
  success: boolean;
  codes?: string[];
  error?: string | null;
  [feld: string]: unknown;
};
export type ZweiterFaktorEinrichtung = {
  success: boolean;
  geheimnis?: string | null;
  otpauth?: string | null;
  error?: string | null;
  [feld: string]: unknown;
};
export type ZweiterFaktorStand = {
  success: boolean;
  aktiv: boolean;
  codes_uebrig: number;
  error?: string | null;
  [feld: string]: unknown;
};

/** Je Route: Methode, Pfad (Platzhalter als ${string}) und Antwort bei Erfolg. */
export type Route =
  | { m: 'GET'; p: '/v1/'; a: Endpunkte }
  | { m: 'GET'; p: '/v1/admin/api-limits'; a: ApiLimitsResponse }
  | { m: 'PUT'; p: '/v1/admin/api-limits'; a: POST_api_v1_sets_import_csv_cancel }
  | { m: 'GET'; p: '/v1/admin/auftraege'; a: AuftraegeResponse }
  | { m: 'POST'; p: `/v1/admin/auftraege/${string}/abbrechen`; a: AuftragAenderung }
  | { m: 'POST'; p: `/v1/admin/auftraege/${string}/wiederholen`; a: AuftragAenderung }
  | { m: 'DELETE'; p: `/v1/admin/auftraege/art/${string}`; a: AuftragsArtLeerung }
  | { m: 'POST'; p: `/v1/admin/auftraege/art/${string}/jetzt`; a: AuftragsArtStart }
  | { m: 'GET'; p: '/v1/admin/brickset-queue'; a: BricksetQueueResponse }
  | { m: 'DELETE'; p: `/v1/admin/brickset-queue/${string}`; a: VerwaltungSet }
  | { m: 'POST'; p: `/v1/admin/brickset-queue/${string}/retry`; a: VerwaltungSet }
  | { m: 'POST'; p: '/v1/admin/cache-clear'; a: VerwaltungMeldung }
  | { m: 'GET'; p: '/v1/admin/cache-stats'; a: CacheStatsResponse }
  | { m: 'GET'; p: '/v1/admin/cache-ttl'; a: CacheTtlResponse }
  | { m: 'POST'; p: '/v1/admin/cache-ttl'; a: VerwaltungTtl }
  | { m: 'POST'; p: '/v1/admin/catalog-images'; a: POST_api_v1_sets_import_csv_cancel }
  | { m: 'POST'; p: '/v1/admin/default-condition'; a: VerwaltungZustand }
  | { m: 'POST'; p: '/v1/admin/forget-image-misses'; a: BildMerkerVergessen }
  | { m: 'GET'; p: `/v1/admin/image-diag/${string}`; a: BildDiagnose }
  | { m: 'GET'; p: '/v1/admin/img-probe'; a: Diagnose }
  | { m: 'POST'; p: '/v1/admin/job-schedule'; a: POST_api_v1_sets_import_csv_cancel }
  | { m: 'GET'; p: '/v1/admin/job-status'; a: PreisJobStand }
  | { m: 'GET'; p: '/v1/admin/jobs'; a: JobsResponse }
  | { m: 'GET'; p: '/v1/admin/logs'; a: ProtokollResponse }
  | { m: 'GET'; p: '/v1/admin/price-probe'; a: Diagnose }
  | { m: 'GET'; p: '/v1/admin/protokoll'; a: ProtokollEintraege }
  | { m: 'POST'; p: '/v1/admin/redownload-missing-images'; a: VerwaltungGestartet }
  | { m: 'POST'; p: '/v1/admin/reimport-instructions'; a: VerwaltungMeldung }
  | { m: 'POST'; p: '/v1/admin/trigger-csv-sync'; a: VerwaltungMeldung }
  | { m: 'POST'; p: '/v1/admin/trigger-price-job'; a: VerwaltungGestartet }
  | { m: 'GET'; p: '/v1/alerts'; a: PreisalarmeResponse }
  | { m: 'POST'; p: '/v1/alerts/import/csv'; a: POST_api_v1_minifigs_import_csv }
  | { m: 'GET'; p: '/v1/alerts/pending'; a: PendingAlertsResponse }
  | { m: 'POST'; p: '/v1/auth/bestaetigung-erneut'; a: ForgotPasswordResponse }
  | { m: 'POST'; p: '/v1/auth/change-password'; a: PUT_api_v1_sets_setNumber_acquisitions_acqId }
  | { m: 'POST'; p: '/v1/auth/email-bestaetigen'; a: DELETE_api_v1_papierkorb_id }
  | { m: 'POST'; p: '/v1/auth/email-bestaetigen/vorschau'; a: POST_api_v1_auth_email_bestaetigen_vorschau }
  | { m: 'POST'; p: '/v1/auth/forgot-password'; a: ForgotPasswordResponse }
  | { m: 'DELETE'; p: '/v1/auth/konto'; a: DELETE_api_v1_papierkorb_id }
  | { m: 'POST'; p: '/v1/auth/login'; a: LoginResponse }
  | { m: 'POST'; p: '/v1/auth/logout'; a: PUT_api_v1_sets_setNumber_acquisitions_acqId }
  | { m: 'GET'; p: '/v1/auth/me'; a: MeResponse }
  | { m: 'POST'; p: '/v1/auth/passkey/anmelden'; a: PasskeyAnmeldung }
  | { m: 'POST'; p: '/v1/auth/passkey/anmelden/optionen'; a: PasskeyOptionen }
  | { m: 'POST'; p: '/v1/auth/passkey/registrieren'; a: PasskeyAngelegt }
  | { m: 'POST'; p: '/v1/auth/passkey/registrieren/optionen'; a: PasskeyOptionen }
  | { m: 'GET'; p: '/v1/auth/passkeys'; a: PasskeyListe }
  | { m: 'DELETE'; p: `/v1/auth/passkeys/${string}`; a: Geloescht }
  | { m: 'GET'; p: '/v1/auth/profile'; a: ProfilResponse }
  | { m: 'PUT'; p: '/v1/auth/profile'; a: ProfilGespeichert }
  | { m: 'POST'; p: '/v1/auth/qr-login'; a: QrLoginResponse }
  | { m: 'POST'; p: '/v1/auth/qr-token'; a: QrToken }
  | { m: 'POST'; p: '/v1/auth/register'; a: RegisterResponse }
  | { m: 'GET'; p: '/v1/auth/registration-status'; a: RegistrationStatusResponse }
  | { m: 'POST'; p: '/v1/auth/reset-password'; a: ForgotPasswordResponse }
  | { m: 'POST'; p: '/v1/auth/token-create'; a: TokenErstellt }
  | { m: 'POST'; p: '/v1/auth/token-rotieren'; a: TokenRotation }
  | { m: 'GET'; p: '/v1/auth/users'; a: KontenListe }
  | { m: 'POST'; p: '/v1/auth/users'; a: DELETE_api_v1_papierkorb_id }
  | { m: 'DELETE'; p: `/v1/auth/users/${string}`; a: DELETE_api_v1_papierkorb_id }
  | { m: 'PUT'; p: `/v1/auth/users/${string}/admin`; a: DELETE_api_v1_papierkorb_id }
  | { m: 'PUT'; p: `/v1/auth/users/${string}/aktiv`; a: KontoAktiv }
  | { m: 'PUT'; p: `/v1/auth/users/${string}/freischalten`; a: DELETE_api_v1_papierkorb_id }
  | { m: 'PUT'; p: `/v1/auth/users/${string}/password`; a: DELETE_api_v1_papierkorb_id }
  | { m: 'DELETE'; p: `/v1/auth/users/${string}/zweiter-faktor`; a: DELETE_api_v1_papierkorb_id }
  | { m: 'GET'; p: '/v1/auth/zweiter-faktor'; a: ZweiterFaktorStand }
  | { m: 'POST'; p: '/v1/auth/zweiter-faktor/abschalten'; a: PUT_api_v1_sets_setNumber_acquisitions_acqId }
  | { m: 'POST'; p: '/v1/auth/zweiter-faktor/bestaetigen'; a: ZweiterFaktorCodes }
  | { m: 'POST'; p: '/v1/auth/zweiter-faktor/codes'; a: ZweiterFaktorCodes }
  | { m: 'POST'; p: '/v1/auth/zweiter-faktor/einrichten'; a: ZweiterFaktorEinrichtung }
  | { m: 'DELETE'; p: '/v1/bestand'; a: BestandGeleert }
  | { m: 'GET'; p: '/v1/catalog/bricklink'; a: BricklinkVerweise }
  | { m: 'GET'; p: '/v1/catalog/meta'; a: CatalogMetaResponse }
  | { m: 'GET'; p: '/v1/catalog/sets'; a: CatalogSetsResponse }
  | { m: 'GET'; p: `/v1/catalog/sets/${string}`; a: CatalogSetDetailResponse }
  | { m: 'GET'; p: '/v1/catalog/year-verteilung'; a: CatalogYearVerteilungResponse }
  | { m: 'GET'; p: '/v1/finance/minifigs-valuation'; a: FigsValuationResponse }
  | { m: 'GET'; p: '/v1/finance/parts-valuation'; a: PartsValuationResponse }
  | { m: 'GET'; p: '/v1/finance/pnl'; a: PnlResponse }
  | { m: 'GET'; p: '/v1/finance/portfolio-history'; a: PortfolioHistoryResponse }
  | { m: 'GET'; p: '/v1/finance/valuation'; a: ValuationResponse }
  | { m: 'GET'; p: '/v1/health'; a: Gesundheit }
  | { m: 'GET'; p: '/v1/health/live'; a: Lebenszeichen }
  | { m: 'GET'; p: '/v1/health/ready'; a: Lebenszeichen }
  | { m: 'GET'; p: '/v1/minifigs'; a: GET_api_v1_minifigs }
  | { m: 'POST'; p: '/v1/minifigs'; a: AddMinifigResponse }
  | { m: 'PUT'; p: `/v1/minifigs/${string}`; a: PUT_api_v1_sets_setNumber_acquisitions_acqId }
  | { m: 'DELETE'; p: `/v1/minifigs/${string}`; a: DELETE_api_v1_minifigs_figNumber }
  | { m: 'GET'; p: `/v1/minifigs/${string}/acquisitions`; a: AcquisitionsResponse }
  | { m: 'PUT'; p: `/v1/minifigs/${string}/acquisitions/${string}`; a: PUT_api_v1_sets_setNumber_acquisitions_acqId }
  | { m: 'DELETE'; p: `/v1/minifigs/${string}/acquisitions/${string}`; a: DeleteWithQuantityResponse }
  | { m: 'GET'; p: `/v1/minifigs/${string}/parts`; a: FigurTeile }
  | { m: 'GET'; p: `/v1/minifigs/${string}/price-history`; a: PriceHistoryResponse }
  | { m: 'GET'; p: `/v1/minifigs/${string}/sets`; a: GET_api_v1_minifigs_figNumber_sets }
  | { m: 'PUT'; p: `/v1/minifigs/${string}/storage`; a: LagerortResponse }
  | { m: 'POST'; p: '/v1/minifigs/import/csv'; a: POST_api_v1_minifigs_import_csv }
  | { m: 'GET'; p: '/v1/minifigs/manual'; a: ManualFigsResponse }
  | { m: 'GET'; p: '/v1/minifigs/stats'; a: MinifigStatsResponse }
  | { m: 'GET'; p: '/v1/papierkorb'; a: Papierkorb }
  | { m: 'DELETE'; p: '/v1/papierkorb'; a: PapierkorbGeleert }
  | { m: 'DELETE'; p: `/v1/papierkorb/${string}`; a: DELETE_api_v1_papierkorb_id }
  | { m: 'POST'; p: `/v1/papierkorb/${string}/wiederherstellen`; a: Wiederhergestellt }
  | { m: 'GET'; p: '/v1/parts'; a: GET_api_v1_sets_setNumber_parts_list }
  | { m: 'POST'; p: '/v1/parts'; a: AddPartResponse }
  | { m: 'PUT'; p: `/v1/parts/${string}/${string}`; a: PUT_api_v1_sets_setNumber_acquisitions_acqId }
  | { m: 'DELETE'; p: `/v1/parts/${string}/${string}`; a: DELETE_api_v1_minifigs_figNumber }
  | { m: 'GET'; p: `/v1/parts/${string}/${string}/acquisitions`; a: AcquisitionsResponse }
  | { m: 'PUT'; p: `/v1/parts/${string}/${string}/acquisitions/${string}`; a: PUT_api_v1_sets_setNumber_acquisitions_acqId }
  | { m: 'DELETE'; p: `/v1/parts/${string}/${string}/acquisitions/${string}`; a: DeleteWithQuantityResponse }
  | { m: 'PUT'; p: `/v1/parts/${string}/${string}/color`; a: TeilFarbeResponse }
  | { m: 'GET'; p: `/v1/parts/${string}/${string}/price-history`; a: PriceHistoryResponse }
  | { m: 'GET'; p: `/v1/parts/${string}/${string}/sets`; a: GET_api_v1_minifigs_figNumber_sets }
  | { m: 'PUT'; p: `/v1/parts/${string}/${string}/storage`; a: LagerortResponse }
  | { m: 'GET'; p: '/v1/parts/bl-color-map'; a: BlFarbTabelle }
  | { m: 'GET'; p: '/v1/parts/brick-colors'; a: BrickColorsResponse }
  | { m: 'GET'; p: '/v1/parts/categories'; a: PartsCategoriesResponse }
  | { m: 'GET'; p: '/v1/parts/colors'; a: PartsFilterColorsResponse }
  | { m: 'POST'; p: '/v1/parts/import/csv'; a: POST_api_v1_minifigs_import_csv }
  | { m: 'GET'; p: '/v1/parts/manual'; a: ManualPartsResponse }
  | { m: 'POST'; p: '/v1/parts/owned'; a: BestandResponse }
  | { m: 'GET'; p: '/v1/parts/stats'; a: PartsStatsResponse }
  | { m: 'GET'; p: '/v1/sets'; a: SetsResponse }
  | { m: 'POST'; p: '/v1/sets'; a: AddSetResponse }
  | { m: 'GET'; p: `/v1/sets/${string}`; a: SetResponse }
  | { m: 'PUT'; p: `/v1/sets/${string}`; a: PUT_api_v1_sets_setNumber_acquisitions_acqId }
  | { m: 'DELETE'; p: `/v1/sets/${string}`; a: DELETE_api_v1_minifigs_figNumber }
  | { m: 'GET'; p: `/v1/sets/${string}/acquisitions`; a: AcquisitionsResponse }
  | { m: 'PUT'; p: `/v1/sets/${string}/acquisitions/${string}`; a: PUT_api_v1_sets_setNumber_acquisitions_acqId }
  | { m: 'DELETE'; p: `/v1/sets/${string}/acquisitions/${string}`; a: PUT_api_v1_sets_setNumber_acquisitions_acqId }
  | { m: 'GET'; p: `/v1/sets/${string}/alert`; a: PreisalarmeResponse }
  | { m: 'PUT'; p: `/v1/sets/${string}/alert`; a: PreisalarmResponse }
  | { m: 'DELETE'; p: `/v1/sets/${string}/alert`; a: PreisalarmResponse }
  | { m: 'POST'; p: `/v1/sets/${string}/instructions`; a: AnleitungenGeladen }
  | { m: 'DELETE'; p: `/v1/sets/${string}/instructions/${string}`; a: PUT_api_v1_sets_setNumber_acquisitions_acqId }
  | { m: 'POST'; p: `/v1/sets/${string}/instructions/upload`; a: AnleitungHochgeladen }
  | { m: 'GET'; p: `/v1/sets/${string}/minifigs-list`; a: GET_api_v1_minifigs }
  | { m: 'POST'; p: `/v1/sets/${string}/parts`; a: TeileGeladen }
  | { m: 'GET'; p: `/v1/sets/${string}/parts-list`; a: GET_api_v1_sets_setNumber_parts_list }
  | { m: 'GET'; p: `/v1/sets/${string}/price`; a: SetPriceResponse }
  | { m: 'GET'; p: `/v1/sets/${string}/price-history`; a: PriceHistoryResponse }
  | { m: 'PUT'; p: `/v1/sets/${string}/storage`; a: LagerortResponse }
  | { m: 'POST'; p: `/v1/sets/${string}/move`; a: MoveSetResponse }
  | { m: 'GET'; p: `/v1/sets/barcode/${string}`; a: BarcodeResponse }
  | { m: 'GET'; p: `/v1/sets/exists/${string}`; a: SetExistsResponse }
  | { m: 'GET'; p: '/v1/sets/household-members'; a: HouseholdMembersResponse }
  | { m: 'POST'; p: '/v1/sets/import/csv'; a: POST_api_v1_minifigs_import_csv }
  | { m: 'POST'; p: '/v1/sets/import/csv/cancel'; a: POST_api_v1_sets_import_csv_cancel }
  | { m: 'GET'; p: '/v1/sets/import/csv/status'; a: CsvImportStatus }
  | { m: 'GET'; p: `/v1/sets/info/${string}`; a: SetInfoResponse }
  | { m: 'POST'; p: '/v1/sets/partslist-pdf'; a: PdfAuftrag }
  | { m: 'GET'; p: `/v1/sets/partslist-pdf/status/${string}`; a: PdfStand }
  | { m: 'GET'; p: '/v1/settings'; a: SettingsResponse }
  | { m: 'PUT'; p: '/v1/settings'; a: EinstellungenGespeichert }
  | { m: 'POST'; p: '/v1/settings'; a: DELETE_api_v1_papierkorb_id }
  | { m: 'POST'; p: '/v1/settings/admin/theme'; a: VerwaltungDesign }
  | { m: 'GET'; p: '/v1/settings/default-condition'; a: DefaultConditionResponse }
  | { m: 'GET'; p: '/v1/settings/einrichtung'; a: Einrichtung }
  | { m: 'POST'; p: '/v1/settings/einrichtung/fertig'; a: DELETE_api_v1_papierkorb_id }
  | { m: 'GET'; p: '/v1/settings/export'; a: Sicherung }
  | { m: 'GET'; p: '/v1/settings/household'; a: HouseholdStatusResponse }
  | { m: 'POST'; p: '/v1/settings/household/former/dismiss'; a: PUT_api_v1_sets_setNumber_acquisitions_acqId }
  | { m: 'POST'; p: '/v1/settings/household/invite'; a: HouseholdInviteResponse }
  | { m: 'POST'; p: '/v1/settings/household/redeem'; a: PUT_api_v1_sets_setNumber_acquisitions_acqId }
  | { m: 'POST'; p: '/v1/settings/household/redeem/pruefen'; a: HouseholdInviteCheckResponse }
  | { m: 'POST'; p: '/v1/settings/household/unlink'; a: PUT_api_v1_sets_setNumber_acquisitions_acqId }
  | { m: 'POST'; p: '/v1/settings/import'; a: SicherungEingespielt }
  | { m: 'POST'; p: '/v1/settings/quelle-testen'; a: DELETE_api_v1_papierkorb_id }
  | { m: 'GET'; p: '/v1/settings/raw'; a: RoheEinstellungen }
  | { m: 'POST'; p: '/v1/settings/sessions/andere-beenden'; a: Geloescht }
  | { m: 'POST'; p: '/v1/settings/smtp-test'; a: SmtpProbe }
  | { m: 'GET'; p: '/v1/settings/theme'; a: AppThemeResponse }
  | { m: 'GET'; p: '/v1/settings/tls'; a: TlsStand }
  | { m: 'GET'; p: '/v1/settings/tokens'; a: TokensResponse }
  | { m: 'DELETE'; p: `/v1/settings/tokens/${string}`; a: TokenWiderruf }
  | { m: 'POST'; p: '/v1/settings/user/default-condition'; a: VerwaltungZustand }
  | { m: 'GET'; p: '/v1/settings/user/default-condition'; a: DefaultConditionResponse }
  | { m: 'POST'; p: '/v1/settings/user/theme'; a: AppThemeResponse }
  | { m: 'GET'; p: '/v1/startup-status'; a: StartupStatus }
  | { m: 'GET'; p: '/v1/stats'; a: StatsResponse }
  | { m: 'GET'; p: '/v1/storage'; a: LagerorteResponse }
  | { m: 'PUT'; p: '/v1/storage/default'; a: LagerortVorgabeResponse }
  | { m: 'GET'; p: '/v1/storage/locations'; a: LagerortVorratResponse }
  | { m: 'POST'; p: '/v1/storage/locations'; a: LagerortEintragResponse }
  | { m: 'PUT'; p: `/v1/storage/locations/${string}`; a: LagerortEintragResponse }
  | { m: 'DELETE'; p: `/v1/storage/locations/${string}`; a: LagerortResponse }
  | { m: 'GET'; p: '/v1/vouchers'; a: GutscheinListe }
  | { m: 'POST'; p: '/v1/vouchers'; a: GutscheinAntwort }
  | { m: 'PUT'; p: `/v1/vouchers/${string}`; a: GutscheinAntwort }
  | { m: 'DELETE'; p: `/v1/vouchers/${string}`; a: PUT_api_v1_sets_setNumber_acquisitions_acqId }
  | { m: 'POST'; p: `/v1/vouchers/${string}/guthaben`; a: GuthabenAntwort }
  | { m: 'POST'; p: `/v1/vouchers/${string}/klartext`; a: GutscheinKlartext }
  | { m: 'POST'; p: `/v1/vouchers/${string}/pdf-freigabe`; a: PdfFreigabe }
  | { m: 'POST'; p: '/v1/vouchers/export/pdf-freigabe'; a: PdfFreigabe }
  | { m: 'POST'; p: '/v1/vouchers/pdf'; a: GutscheinAntwort }
  | { m: 'GET'; p: '/v1/wanted'; a: MerklisteResponse }
  | { m: 'POST'; p: '/v1/wanted'; a: MerkpostenAntwort }
  | { m: 'POST'; p: '/v1/wanted-list/import/xml'; a: WantedXmlErgebnis }
  | { m: 'DELETE'; p: `/v1/wanted/${string}/${string}`; a: MerkpostenGeloescht }
  | { m: 'PUT'; p: `/v1/wanted/${string}/${string}/inhaber`; a: MerkpostenInhaberAntwort }
  | { m: 'POST'; p: `/v1/wanted/${string}/${string}/uebernehmen`; a: MerkpostenUebernahmeResponse }
  | { m: 'GET'; p: `/v1/wanted/${string}/preise`; a: MerkpostenPreiseResponse }
  | { m: 'POST'; p: '/v1/wanted/import/csv'; a: POST_api_v1_minifigs_import_csv };
