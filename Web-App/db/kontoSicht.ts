/** Konten, wie Bereiche unter `konto` sie lesen: users gehört dem Konto. Nur Name und Rolle
 * reisen nach unten; Passwort und Schlüssel bleiben beim Besitzer. */

/** Unterabfrage mit den Spalten id, username, is_admin. */
export const KONTEN = '(SELECT id, username, is_admin FROM users)';
