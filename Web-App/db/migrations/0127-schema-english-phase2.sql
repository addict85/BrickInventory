-- Phase 2 of the English schema: the names of constraints, indexes, triggers,
-- policies and functions, and the session setting app.konto (now app.account).
-- Stored values (job status, job kinds, enum-like checks) stay: they are part of
-- API v1 and change together with the v2 mapping.
--
-- Function bodies are plain text: after the renames every SQL/PL/pgSQL body in
-- public is rewritten with the new function names and the new setting. Row
-- security reads only app.account; a process still running the old code sets
-- app.konto and sees no rows until it restarts (fails closed).

-- Constraints (a primary key or unique constraint renames its index too).
ALTER TABLE admin_log RENAME CONSTRAINT verwaltungsprotokoll_pkey TO admin_log_pkey;
ALTER TABLE admin_log RENAME CONSTRAINT verwaltungsprotokoll_verwalter_id_fkey TO admin_log_admin_id_fkey;
ALTER TABLE admin_takeovers RENAME CONSTRAINT verwalter_uebernahmen_art_check TO admin_takeovers_type_check;
ALTER TABLE admin_takeovers RENAME CONSTRAINT verwalter_uebernahmen_check TO admin_takeovers_check;
ALTER TABLE admin_takeovers RENAME CONSTRAINT verwalter_uebernahmen_durch_id_fkey TO admin_takeovers_initiator_id_fkey;
ALTER TABLE admin_takeovers RENAME CONSTRAINT verwalter_uebernahmen_pkey TO admin_takeovers_pkey;
ALTER TABLE admin_takeovers RENAME CONSTRAINT verwalter_uebernahmen_ziel_id_fkey TO admin_takeovers_target_id_fkey;
ALTER TABLE api_cadence RENAME CONSTRAINT api_takt_pkey TO api_cadence_pkey;
ALTER TABLE api_calls RENAME CONSTRAINT api_aufrufe_anzahl_check TO api_calls_count_check;
ALTER TABLE api_calls RENAME CONSTRAINT api_aufrufe_api_check TO api_calls_api_check;
ALTER TABLE api_calls RENAME CONSTRAINT api_aufrufe_pkey TO api_calls_pkey;
ALTER TABLE api_tokens_consumed RENAME CONSTRAINT api_tokens_verbraucht_pkey TO api_tokens_consumed_pkey;
ALTER TABLE api_tokens_consumed RENAME CONSTRAINT api_tokens_verbraucht_user_id_fkey TO api_tokens_consumed_user_id_fkey;
ALTER TABLE bl_mapping RENAME CONSTRAINT bl_zuordnung_art TO bl_mapping_type;
ALTER TABLE bl_mapping RENAME CONSTRAINT bl_zuordnung_pkey TO bl_mapping_pkey;
ALTER TABLE bl_mapping_custom RENAME CONSTRAINT bl_zuordnung_eigen_art TO bl_mapping_custom_type;
ALTER TABLE bl_mapping_custom RENAME CONSTRAINT bl_zuordnung_eigen_pkey TO bl_mapping_custom_pkey;
ALTER TABLE bl_mapping_custom RENAME CONSTRAINT bl_zuordnung_eigen_user_id_fkey TO bl_mapping_custom_user_id_fkey;
ALTER TABLE catalog_cache RENAME CONSTRAINT catalog_cache_setnummer_mit_version TO catalog_cache_set_number_with_version;
ALTER TABLE device_keys RENAME CONSTRAINT geraete_schluessel_pkey TO device_keys_pkey;
ALTER TABLE device_keys RENAME CONSTRAINT geraete_schluessel_user_id_fkey TO device_keys_user_id_fkey;
ALTER TABLE device_nonces RENAME CONSTRAINT geraete_nonces_pkey TO device_nonces_pkey;
ALTER TABLE device_nonces RENAME CONSTRAINT geraete_nonces_user_id_fkey TO device_nonces_user_id_fkey;
ALTER TABLE exchange_rates RENAME CONSTRAINT wechselkurse_je_eur_check TO exchange_rates_per_eur_check;
ALTER TABLE exchange_rates RENAME CONSTRAINT wechselkurse_pkey TO exchange_rates_pkey;
ALTER TABLE exchange_rates RENAME CONSTRAINT wechselkurse_waehrung_check TO exchange_rates_currency_check;
ALTER TABLE idempotency RENAME CONSTRAINT idempotenz_pkey TO idempotency_pkey;
ALTER TABLE idempotency RENAME CONSTRAINT idempotenz_schluessel_check TO idempotency_key_check;
ALTER TABLE idempotency RENAME CONSTRAINT idempotenz_user_id_fkey TO idempotency_user_id_fkey;
ALTER TABLE import_status RENAME CONSTRAINT csv_import_jobs_pkey TO import_status_pkey;
ALTER TABLE import_status RENAME CONSTRAINT csv_import_jobs_status_check TO import_status_status_check;
ALTER TABLE import_status RENAME CONSTRAINT csv_import_jobs_user_fk TO import_status_user_fk;
ALTER TABLE instructions RENAME CONSTRAINT instructions_setnummer_mit_version TO instructions_set_number_with_version;
ALTER TABLE job_exclusive_locks RENAME CONSTRAINT auftrag_exklusiv_pkey TO job_exclusive_locks_pkey;
ALTER TABLE job_pauses RENAME CONSTRAINT auftrag_pausen_art_fkey TO job_pauses_type_fkey;
ALTER TABLE job_pauses RENAME CONSTRAINT auftrag_pausen_pkey TO job_pauses_pkey;
ALTER TABLE job_types RENAME CONSTRAINT auftrags_arten_pkey TO job_types_pkey;
ALTER TABLE jobs RENAME CONSTRAINT auftraege_art_fkey TO jobs_type_fkey;
ALTER TABLE jobs RENAME CONSTRAINT auftraege_max_versuche_check TO jobs_max_attempts_check;
ALTER TABLE jobs RENAME CONSTRAINT auftraege_pkey TO jobs_pkey;
ALTER TABLE jobs RENAME CONSTRAINT auftraege_status_check TO jobs_status_check;
ALTER TABLE jobs RENAME CONSTRAINT auftraege_user_id_fkey TO jobs_user_id_fkey;
ALTER TABLE minifig_acquisitions RENAME CONSTRAINT minifig_acquisitions_menge_positiv TO minifig_acquisitions_quantity_positive;
ALTER TABLE minifig_acquisitions RENAME CONSTRAINT minifig_acquisitions_unit_price_nicht_negativ TO minifig_acquisitions_unit_price_not_negative;
ALTER TABLE minifig_acquisitions RENAME CONSTRAINT minifig_acquisitions_zustand TO minifig_acquisitions_condition;
ALTER TABLE minifig_custom RENAME CONSTRAINT figur_eigen_pkey TO minifig_custom_pkey;
ALTER TABLE minifig_custom RENAME CONSTRAINT figur_eigen_user_id_fkey TO minifig_custom_user_id_fkey;
ALTER TABLE minifig_price_cache RENAME CONSTRAINT minifig_price_cache_avg_price_nicht_negativ TO minifig_price_cache_avg_price_not_negative;
ALTER TABLE minifig_price_cache RENAME CONSTRAINT minifig_price_cache_qty_avg_price_nicht_negativ TO minifig_price_cache_qty_avg_price_not_negative;
ALTER TABLE minifig_price_cache RENAME CONSTRAINT minifig_price_cache_zustand TO minifig_price_cache_condition;
ALTER TABLE minifig_price_history RENAME CONSTRAINT minifig_price_history_avg_price_nicht_negativ TO minifig_price_history_avg_price_not_negative;
ALTER TABLE minifig_price_history RENAME CONSTRAINT minifig_price_history_qty_avg_price_nicht_negativ TO minifig_price_history_qty_avg_price_not_negative;
ALTER TABLE minifig_price_history RENAME CONSTRAINT minifig_price_history_zustand TO minifig_price_history_condition;
ALTER TABLE minifigs RENAME CONSTRAINT minifigs_setnummer_mit_version TO minifigs_set_number_with_version;
ALTER TABLE part_acquisitions RENAME CONSTRAINT part_acquisitions_menge_positiv TO part_acquisitions_quantity_positive;
ALTER TABLE part_acquisitions RENAME CONSTRAINT part_acquisitions_unit_price_nicht_negativ TO part_acquisitions_unit_price_not_negative;
ALTER TABLE part_acquisitions RENAME CONSTRAINT part_acquisitions_zustand TO part_acquisitions_condition;
ALTER TABLE part_color_custom RENAME CONSTRAINT teil_farbe_eigen_pkey TO part_color_custom_pkey;
ALTER TABLE part_color_custom RENAME CONSTRAINT teil_farbe_eigen_user_id_fkey TO part_color_custom_user_id_fkey;
ALTER TABLE part_custom RENAME CONSTRAINT teil_eigen_pkey TO part_custom_pkey;
ALTER TABLE part_custom RENAME CONSTRAINT teil_eigen_user_id_fkey TO part_custom_user_id_fkey;
ALTER TABLE part_price_cache RENAME CONSTRAINT part_price_cache_avg_price_nicht_negativ TO part_price_cache_avg_price_not_negative;
ALTER TABLE part_price_cache RENAME CONSTRAINT part_price_cache_qty_avg_price_nicht_negativ TO part_price_cache_qty_avg_price_not_negative;
ALTER TABLE part_price_cache RENAME CONSTRAINT part_price_cache_zustand TO part_price_cache_condition;
ALTER TABLE part_price_history RENAME CONSTRAINT part_price_history_avg_price_nicht_negativ TO part_price_history_avg_price_not_negative;
ALTER TABLE part_price_history RENAME CONSTRAINT part_price_history_qty_avg_price_nicht_negativ TO part_price_history_qty_avg_price_not_negative;
ALTER TABLE part_price_history RENAME CONSTRAINT part_price_history_zustand TO part_price_history_condition;
ALTER TABLE parts RENAME CONSTRAINT parts_setnummer_mit_version TO parts_set_number_with_version;
ALTER TABLE parts_catalog_pending RENAME CONSTRAINT parts_katalog_offen_pkey TO parts_catalog_pending_pkey;
ALTER TABLE price_alerts RENAME CONSTRAINT price_alerts_richtung TO price_alerts_direction;
ALTER TABLE price_alerts RENAME CONSTRAINT price_alerts_schwelle TO price_alerts_threshold;
ALTER TABLE price_alerts RENAME CONSTRAINT price_alerts_setnummer_mit_version TO price_alerts_set_number_with_version;
ALTER TABLE price_alerts RENAME CONSTRAINT price_alerts_zustand TO price_alerts_condition;
ALTER TABLE price_cache RENAME CONSTRAINT price_cache_avg_price_nicht_negativ TO price_cache_avg_price_not_negative;
ALTER TABLE price_cache RENAME CONSTRAINT price_cache_max_price_nicht_negativ TO price_cache_max_price_not_negative;
ALTER TABLE price_cache RENAME CONSTRAINT price_cache_min_price_nicht_negativ TO price_cache_min_price_not_negative;
ALTER TABLE price_cache RENAME CONSTRAINT price_cache_qty_avg_price_nicht_negativ TO price_cache_qty_avg_price_not_negative;
ALTER TABLE price_cache RENAME CONSTRAINT price_cache_zustand TO price_cache_condition;
ALTER TABLE price_history RENAME CONSTRAINT price_history_avg_price_nicht_negativ TO price_history_avg_price_not_negative;
ALTER TABLE price_history RENAME CONSTRAINT price_history_max_price_nicht_negativ TO price_history_max_price_not_negative;
ALTER TABLE price_history RENAME CONSTRAINT price_history_min_price_nicht_negativ TO price_history_min_price_not_negative;
ALTER TABLE price_history RENAME CONSTRAINT price_history_qty_avg_price_nicht_negativ TO price_history_qty_avg_price_not_negative;
ALTER TABLE price_history RENAME CONSTRAINT price_history_zustand TO price_history_condition;
ALTER TABLE rb_inventories RENAME CONSTRAINT rb_inventories_setnummer_mit_version TO rb_inventories_set_number_with_version;
ALTER TABLE rb_sets RENAME CONSTRAINT rb_sets_herkunft TO rb_sets_origin;
ALTER TABLE run_state RENAME CONSTRAINT laufzustand_pkey TO run_state_pkey;
ALTER TABLE second_factor RENAME CONSTRAINT zweiter_faktor_pkey TO second_factor_pkey;
ALTER TABLE second_factor RENAME CONSTRAINT zweiter_faktor_user_id_fkey TO second_factor_user_id_fkey;
ALTER TABLE second_factor_codes RENAME CONSTRAINT zweiter_faktor_codes_pkey TO second_factor_codes_pkey;
ALTER TABLE second_factor_codes RENAME CONSTRAINT zweiter_faktor_codes_user_id_fkey TO second_factor_codes_user_id_fkey;
ALTER TABLE set_acquisitions RENAME CONSTRAINT set_acquisitions_bestand_fkey TO set_acquisitions_holding_fkey;
ALTER TABLE set_acquisitions RENAME CONSTRAINT set_acquisitions_menge_positiv TO set_acquisitions_quantity_positive;
ALTER TABLE set_acquisitions RENAME CONSTRAINT set_acquisitions_purchase_price_nicht_negativ TO set_acquisitions_purchase_price_not_negative;
ALTER TABLE set_acquisitions RENAME CONSTRAINT set_acquisitions_setnummer_mit_version TO set_acquisitions_set_number_with_version;
ALTER TABLE set_acquisitions RENAME CONSTRAINT set_acquisitions_zustand TO set_acquisitions_condition;
ALTER TABLE set_catalog RENAME CONSTRAINT set_catalog_setnummer_mit_version TO set_catalog_set_number_with_version;
ALTER TABLE set_minifigs RENAME CONSTRAINT set_figuren_menge_positiv TO set_minifigs_quantity_positive;
ALTER TABLE set_minifigs RENAME CONSTRAINT set_figuren_pkey TO set_minifigs_pkey;
ALTER TABLE set_minifigs RENAME CONSTRAINT set_figuren_setnummer_mit_version TO set_minifigs_set_number_with_version;
ALTER TABLE set_parts RENAME CONSTRAINT set_teile_pkey TO set_parts_pkey;
ALTER TABLE set_parts RENAME CONSTRAINT set_teile_setnummer_mit_version TO set_parts_set_number_with_version;
ALTER TABLE sets RENAME CONSTRAINT sets_setnummer_mit_version TO sets_set_number_with_version;
ALTER TABLE step_up_approvals RENAME CONSTRAINT schritt_freigaben_aktion_check TO step_up_approvals_action_check;
ALTER TABLE step_up_approvals RENAME CONSTRAINT schritt_freigaben_pkey TO step_up_approvals_pkey;
ALTER TABLE step_up_approvals RENAME CONSTRAINT schritt_freigaben_user_id_fkey TO step_up_approvals_user_id_fkey;
ALTER TABLE step_up_challenges RENAME CONSTRAINT schritt_challenges_aktion_check TO step_up_challenges_action_check;
ALTER TABLE step_up_challenges RENAME CONSTRAINT schritt_challenges_pkey TO step_up_challenges_pkey;
ALTER TABLE step_up_challenges RENAME CONSTRAINT schritt_challenges_user_id_fkey TO step_up_challenges_user_id_fkey;
ALTER TABLE storage_locations RENAME CONSTRAINT storage_locations_konto_id TO storage_locations_account_id;
ALTER TABLE trash RENAME CONSTRAINT papierkorb_art_check TO trash_type_check;
ALTER TABLE trash RENAME CONSTRAINT papierkorb_pkey TO trash_pkey;
ALTER TABLE trash RENAME CONSTRAINT papierkorb_user_id_fkey TO trash_user_id_fkey;
ALTER TABLE voucher_balance_throttle RENAME CONSTRAINT gutschein_guthaben_schranke_id_check TO voucher_balance_throttle_id_check;
ALTER TABLE voucher_balance_throttle RENAME CONSTRAINT gutschein_guthaben_schranke_pkey TO voucher_balance_throttle_pkey;
ALTER TABLE vouchers RENAME CONSTRAINT vouchers_amount_nicht_negativ TO vouchers_amount_not_negative;
ALTER TABLE vouchers RENAME CONSTRAINT vouchers_nummer_verschluesselt TO vouchers_number_encrypted;
ALTER TABLE vouchers RENAME CONSTRAINT vouchers_user_id_nummer_suche_key TO vouchers_user_id_number_search_key;
ALTER TABLE wanted RENAME CONSTRAINT wanted_setnummer_mit_version TO wanted_set_number_with_version;
ALTER TABLE wanted RENAME CONSTRAINT wanted_zustand TO wanted_condition;
ALTER TABLE webauthn_challenges RENAME CONSTRAINT webauthn_challenges_zweck_check TO webauthn_challenges_purpose_check;

-- Indexes without a constraint.
ALTER INDEX idx_verwaltungsprotokoll_verwalter RENAME TO idx_admin_log_admin;
ALTER INDEX idx_verwaltungsprotokoll_zeit RENAME TO idx_admin_log_time;
ALTER INDEX idx_verwalter_uebernahmen_abbruch RENAME TO idx_admin_takeovers_cancel;
ALTER INDEX idx_verwalter_uebernahmen_durch RENAME TO idx_admin_takeovers_initiator;
ALTER INDEX idx_api_tokens_verbraucht_familie RENAME TO idx_api_tokens_consumed_family;
ALTER INDEX idx_bl_zuordnung_bl RENAME TO idx_bl_mapping_bl;
ALTER INDEX idx_bl_zuordnung_eigen_bl RENAME TO idx_bl_mapping_custom_bl;
ALTER INDEX idx_geraete_nonces_familie RENAME TO idx_device_nonces_family;
ALTER INDEX idx_idempotenz_angelegt RENAME TO idx_idempotency_created;
ALTER INDEX idx_auftraege_art RENAME TO idx_jobs_type;
ALTER INDEX idx_auftraege_frist RENAME TO idx_jobs_deadline;
ALTER INDEX idx_auftraege_offen_faellig RENAME TO idx_jobs_open_due;
ALTER INDEX idx_auftraege_schluessel RENAME TO idx_jobs_key;
ALTER INDEX idx_auftraege_user RENAME TO idx_jobs_user;
ALTER INDEX idx_minifig_acq_erfassungstag RENAME TO idx_minifig_acq_acquisition_day;
ALTER INDEX idx_minifig_price_history_tag RENAME TO idx_minifig_price_history_day;
ALTER INDEX idx_minifigs_eindeutig RENAME TO idx_minifigs_unique;
ALTER INDEX idx_minifigs_catalog_bild_stamm RENAME TO idx_minifigs_catalog_image_master;
ALTER INDEX idx_part_acq_erfassungstag RENAME TO idx_part_acq_acquisition_day;
ALTER INDEX idx_part_color_catalog_bild_stamm RENAME TO idx_part_color_catalog_image_master;
ALTER INDEX idx_part_price_history_tag RENAME TO idx_part_price_history_day;
ALTER INDEX idx_parts_eindeutig RENAME TO idx_parts_unique;
ALTER INDEX idx_parts_gruppe RENAME TO idx_parts_group;
ALTER INDEX idx_passkeys_konto RENAME TO idx_passkeys_account;
ALTER INDEX idx_price_history_tag RENAME TO idx_price_history_day;
ALTER INDEX idx_qr_login_abholung RENAME TO idx_qr_login_pickup;
ALTER INDEX idx_rb_inv_setnum RENAME TO idx_rb_inv_set_num;
ALTER INDEX idx_rb_sets_setnum_trgm RENAME TO idx_rb_sets_set_num_trgm;
ALTER INDEX idx_zweiter_faktor_codes_konto RENAME TO idx_second_factor_codes_account;
ALTER INDEX idx_set_acq_erfassungstag RENAME TO idx_set_acq_acquisition_day;
ALTER INDEX idx_set_catalog_bild_stamm RENAME TO idx_set_catalog_image_master;
ALTER INDEX idx_set_figuren_fig RENAME TO idx_set_minifigs_fig;
ALTER INDEX idx_sets_setnum RENAME TO idx_sets_set_num;
ALTER INDEX idx_schritt_challenges_familie RENAME TO idx_step_up_challenges_family;
ALTER INDEX storage_locations_konto_name RENAME TO storage_locations_account_name;
ALTER INDEX idx_papierkorb_konto RENAME TO idx_trash_account;
ALTER INDEX idx_webauthn_challenges_frist RENAME TO idx_webauthn_challenges_deadline;
ALTER INDEX idx_webauthn_challenges_konto RENAME TO idx_webauthn_challenges_account;

-- Triggers.
ALTER TRIGGER trg_teilekatalog_del ON bl_mapping RENAME TO trg_parts_catalog_del;
ALTER TRIGGER trg_teilekatalog_ins ON bl_mapping RENAME TO trg_parts_catalog_ins;
ALTER TRIGGER trg_teilekatalog_upd ON bl_mapping RENAME TO trg_parts_catalog_upd;
ALTER TRIGGER trg_teilekatalog_del ON bl_mapping_custom RENAME TO trg_parts_catalog_del;
ALTER TRIGGER trg_teilekatalog_ins ON bl_mapping_custom RENAME TO trg_parts_catalog_ins;
ALTER TRIGGER trg_teilekatalog_upd ON bl_mapping_custom RENAME TO trg_parts_catalog_upd;
ALTER TRIGGER catalog_cache_setnummer ON catalog_cache RENAME TO catalog_cache_set_number;
ALTER TRIGGER instructions_setnummer ON instructions RENAME TO instructions_set_number;
ALTER TRIGGER auftrag_exklusiv ON jobs RENAME TO job_exclusive;
ALTER TRIGGER minifig_acquisitions_tag ON minifig_acquisitions RENAME TO minifig_acquisitions_day;
ALTER TRIGGER minifig_acquisitions_waehrung ON minifig_acquisitions RENAME TO minifig_acquisitions_currency;
ALTER TRIGGER minifigs_setnummer ON minifigs RENAME TO minifigs_set_number;
ALTER TRIGGER part_acquisitions_tag ON part_acquisitions RENAME TO part_acquisitions_day;
ALTER TRIGGER part_acquisitions_waehrung ON part_acquisitions RENAME TO part_acquisitions_currency;
ALTER TRIGGER trg_teilekatalog_del ON part_catalog RENAME TO trg_parts_catalog_del;
ALTER TRIGGER trg_teilekatalog_ins ON part_catalog RENAME TO trg_parts_catalog_ins;
ALTER TRIGGER trg_teilekatalog_upd ON part_catalog RENAME TO trg_parts_catalog_upd;
ALTER TRIGGER trg_teilekatalog_del ON part_color_catalog RENAME TO trg_parts_catalog_del;
ALTER TRIGGER trg_teilekatalog_ins ON part_color_catalog RENAME TO trg_parts_catalog_ins;
ALTER TRIGGER trg_teilekatalog_upd ON part_color_catalog RENAME TO trg_parts_catalog_upd;
ALTER TRIGGER trg_teilekatalog_del ON part_color_custom RENAME TO trg_parts_catalog_del;
ALTER TRIGGER trg_teilekatalog_ins ON part_color_custom RENAME TO trg_parts_catalog_ins;
ALTER TRIGGER trg_teilekatalog_upd ON part_color_custom RENAME TO trg_parts_catalog_upd;
ALTER TRIGGER trg_teilekatalog_del ON part_custom RENAME TO trg_parts_catalog_del;
ALTER TRIGGER trg_teilekatalog_ins ON part_custom RENAME TO trg_parts_catalog_ins;
ALTER TRIGGER trg_teilekatalog_upd ON part_custom RENAME TO trg_parts_catalog_upd;
ALTER TRIGGER parts_setnummer ON parts RENAME TO parts_set_number;
ALTER TRIGGER price_alerts_setnummer ON price_alerts RENAME TO price_alerts_set_number;
ALTER TRIGGER rb_inventories_setnummer ON rb_inventories RENAME TO rb_inventories_set_number;
ALTER TRIGGER set_acquisitions_setnummer ON set_acquisitions RENAME TO set_acquisitions_set_number;
ALTER TRIGGER set_acquisitions_tag ON set_acquisitions RENAME TO set_acquisitions_day;
ALTER TRIGGER set_acquisitions_waehrung ON set_acquisitions RENAME TO set_acquisitions_currency;
ALTER TRIGGER set_catalog_setnummer ON set_catalog RENAME TO set_catalog_set_number;
ALTER TRIGGER set_figuren_setnummer ON set_minifigs RENAME TO set_minifigs_set_number;
ALTER TRIGGER set_teile_setnummer ON set_parts RENAME TO set_parts_set_number;
ALTER TRIGGER trg_teilekatalog_del ON set_parts RENAME TO trg_parts_catalog_del;
ALTER TRIGGER trg_teilekatalog_ins ON set_parts RENAME TO trg_parts_catalog_ins;
ALTER TRIGGER trg_teilekatalog_upd ON set_parts RENAME TO trg_parts_catalog_upd;
ALTER TRIGGER sets_setnummer ON sets RENAME TO sets_set_number;
ALTER TRIGGER vouchers_waehrung ON vouchers RENAME TO vouchers_currency;
ALTER TRIGGER wanted_setnummer ON wanted RENAME TO wanted_set_number;

-- Policies.
ALTER POLICY zeilenschutz ON account_link_invites RENAME TO row_security;
ALTER POLICY lesen ON account_links RENAME TO read;
ALTER POLICY loesen ON account_links RENAME TO unlink;
ALTER POLICY zeilenschutz ON api_tokens RENAME TO row_security;
ALTER POLICY zeilenschutz ON api_tokens_consumed RENAME TO row_security;
ALTER POLICY zeilenschutz ON bl_mapping_custom RENAME TO row_security;
ALTER POLICY zeilenschutz ON device_keys RENAME TO row_security;
ALTER POLICY zeilenschutz ON device_nonces RENAME TO row_security;
ALTER POLICY loesen ON household_former_links RENAME TO unlink;
ALTER POLICY zeilenschutz ON household_former_links RENAME TO row_security;
ALTER POLICY zeilenschutz ON idempotency RENAME TO row_security;
ALTER POLICY zeilenschutz ON import_status RENAME TO row_security;
ALTER POLICY zeilenschutz ON instructions RENAME TO row_security;
ALTER POLICY zeilenschutz ON jobs RENAME TO row_security;
ALTER POLICY zeilenschutz ON minifig_acquisitions RENAME TO row_security;
ALTER POLICY zeilenschutz ON minifig_custom RENAME TO row_security;
ALTER POLICY zeilenschutz ON minifigs RENAME TO row_security;
ALTER POLICY zeilenschutz ON part_acquisitions RENAME TO row_security;
ALTER POLICY zeilenschutz ON part_color_custom RENAME TO row_security;
ALTER POLICY zeilenschutz ON part_custom RENAME TO row_security;
ALTER POLICY zeilenschutz ON parts RENAME TO row_security;
ALTER POLICY zeilenschutz ON parts_summary RENAME TO row_security;
ALTER POLICY zeilenschutz ON parts_summary_state RENAME TO row_security;
ALTER POLICY zeilenschutz ON parts_version_user RENAME TO row_security;
ALTER POLICY zeilenschutz ON passkeys RENAME TO row_security;
ALTER POLICY zeilenschutz ON price_alerts RENAME TO row_security;
ALTER POLICY zeilenschutz ON qr_login_tokens RENAME TO row_security;
ALTER POLICY zeilenschutz ON second_factor RENAME TO row_security;
ALTER POLICY zeilenschutz ON second_factor_codes RENAME TO row_security;
ALTER POLICY zeilenschutz ON set_acquisitions RENAME TO row_security;
ALTER POLICY zeilenschutz ON sets RENAME TO row_security;
ALTER POLICY zeilenschutz ON step_up_approvals RENAME TO row_security;
ALTER POLICY zeilenschutz ON step_up_challenges RENAME TO row_security;
ALTER POLICY zeilenschutz ON storage_locations RENAME TO row_security;
ALTER POLICY zeilenschutz ON trash RENAME TO row_security;
ALTER POLICY zeilenschutz ON user_settings RENAME TO row_security;
ALTER POLICY namen_aendern ON users RENAME TO names_change;
ALTER POLICY zeilenschutz ON users RENAME TO row_security;
ALTER POLICY zeilenschutz ON vouchers RENAME TO row_security;
ALTER POLICY zeilenschutz ON wanted RENAME TO row_security;
ALTER POLICY zeilenschutz ON webauthn_challenges RENAME TO row_security;

-- Functions; triggers and policies refer to them by OID and follow.
ALTER FUNCTION auftrag_exklusiv_belegen() RENAME TO job_exclusive_claim;
ALTER FUNCTION bild_stamm(pfad text) RENAME TO image_master;
ALTER FUNCTION bump_parts_version_erfassung_upd() RENAME TO bump_parts_version_acquisition_upd;
ALTER FUNCTION bump_parts_version_lagerort_upd() RENAME TO bump_parts_version_storage_upd;
ALTER FUNCTION erfassung_tag() RENAME TO acquisition_day;
ALTER FUNCTION erfassung_waehrung() RENAME TO acquisition_currency;
ALTER FUNCTION in_waehrung(betrag numeric, von text, nach text, t date) RENAME TO in_currency;
ALTER FUNCTION konten_mit_set(sn text) RENAME TO accounts_with_set;
ALTER FUNCTION konto_aus_sicherungen_loeschen(uid integer) RENAME TO delete_account_from_backups;
ALTER FUNCTION konto_waehrung(uid integer) RENAME TO account_currency;
ALTER FUNCTION kurs_je_eur(w text, t date) RENAME TO rate_per_eur;
ALTER FUNCTION merke_teilekatalog_alt() RENAME TO remember_parts_catalog_old;
ALTER FUNCTION merke_teilekatalog_beide() RENAME TO remember_parts_catalog_both;
ALTER FUNCTION merke_teilekatalog_neu() RENAME TO remember_parts_catalog_new;
ALTER FUNCTION set_nummer_mit_version(n text) RENAME TO set_number_with_version;
ALTER FUNCTION setnum_normalisieren() RENAME TO set_num_normalize;
ALTER FUNCTION setnummer_normalisieren() RENAME TO set_number_normalize;
ALTER FUNCTION verwaltungsprotokoll_aufraeumen() RENAME TO admin_log_cleanup;
ALTER FUNCTION zeilenschutz_konten() RENAME TO row_security_accounts;
ALTER FUNCTION zeilenschutz_konto() RENAME TO row_security_account;

-- Bodies that call a renamed function or read app.konto are recreated with the new names.
DO $$
DECLARE
  f record;
  def text;
  neu text;
  pair text[];
  names text[] := ARRAY[
    ARRAY['auftrag_exklusiv_belegen', 'job_exclusive_claim'],
    ARRAY['bild_stamm', 'image_master'],
    ARRAY['bump_parts_version_erfassung_upd', 'bump_parts_version_acquisition_upd'],
    ARRAY['bump_parts_version_lagerort_upd', 'bump_parts_version_storage_upd'],
    ARRAY['erfassung_tag', 'acquisition_day'],
    ARRAY['erfassung_waehrung', 'acquisition_currency'],
    ARRAY['in_waehrung', 'in_currency'],
    ARRAY['konten_mit_set', 'accounts_with_set'],
    ARRAY['konto_aus_sicherungen_loeschen', 'delete_account_from_backups'],
    ARRAY['konto_waehrung', 'account_currency'],
    ARRAY['kurs_je_eur', 'rate_per_eur'],
    ARRAY['merke_teilekatalog_alt', 'remember_parts_catalog_old'],
    ARRAY['merke_teilekatalog_beide', 'remember_parts_catalog_both'],
    ARRAY['merke_teilekatalog_neu', 'remember_parts_catalog_new'],
    ARRAY['set_nummer_mit_version', 'set_number_with_version'],
    ARRAY['setnum_normalisieren', 'set_num_normalize'],
    ARRAY['setnummer_normalisieren', 'set_number_normalize'],
    ARRAY['verwaltungsprotokoll_aufraeumen', 'admin_log_cleanup'],
    ARRAY['zeilenschutz_konten', 'row_security_accounts'],
    ARRAY['zeilenschutz_konto', 'row_security_account']
  ];
BEGIN
  FOR f IN
    SELECT p.oid FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND l.lanname IN ('sql', 'plpgsql')
  LOOP
    def := pg_get_functiondef(f.oid);
    neu := def;
    FOREACH pair SLICE 1 IN ARRAY names LOOP
      neu := regexp_replace(neu, '\m' || pair[1] || '\M', pair[2], 'g');
    END LOOP;
    neu := replace(neu, '''app.konto''', '''app.account''');
    IF neu <> def THEN
      EXECUTE neu;
    END IF;
  END LOOP;
END
$$;
