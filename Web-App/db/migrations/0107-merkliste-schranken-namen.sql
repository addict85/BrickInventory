-- Die Tabelle heisst seit 0023 wanted; ihre Schranken und die Folge trugen noch
-- den alten Namen. Wer in Fehlermeldungen oder pg_constraint sucht, findet sie so
-- unter dem Namen der Tabelle.
ALTER TABLE wanted RENAME CONSTRAINT wishlist_pkey TO wanted_pkey;
ALTER TABLE wanted RENAME CONSTRAINT wishlist_user_id_fkey TO wanted_user_id_fkey;
ALTER TABLE wanted RENAME CONSTRAINT wishlist_user_id_set_number_condition_key TO wanted_user_id_set_number_condition_key;
ALTER SEQUENCE wishlist_id_seq RENAME TO wanted_id_seq;
