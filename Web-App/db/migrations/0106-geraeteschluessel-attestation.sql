-- Geräteschlüssel nur noch mit Android Key Attestation. Bestehende Schlüssel
-- bleiben bis GERAETESCHLUESSEL_ALT_BIS gültig (attestiert = false); die Nonce,
-- die die App als Attestation-Challenge einsetzt, gilt einmal und nur für ihre
-- Token-Familie. aus_qr: bei der QR-Abholung ausgegeben, dann gilt nur diese.
ALTER TABLE geraete_schluessel ADD COLUMN attestiert boolean NOT NULL DEFAULT false;

CREATE TABLE geraete_nonces (
  nonce text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  familie timestamptz NOT NULL,
  aus_qr boolean NOT NULL DEFAULT false,
  angelegt_am timestamptz NOT NULL DEFAULT now(),
  ablauf timestamptz NOT NULL
);
CREATE INDEX idx_geraete_nonces_familie ON geraete_nonces (user_id, familie);
