package ch.brickinventoryapp.model.fach

import ch.brickinventoryapp.model.ui.theme.Design

// Was das Konto-Repository liefert, in Fachwerten: Die Bereiche lesen kein Feld des
// Wire-Formats, und eine Umbenennung am Server bricht nur die Abbildung in core-data.

/**
 * Die Antwort auf eine Anmeldung. [verwalter] gilt nur mit vollem Token; [fehler] ist der
 * Satz des Servers, etwa zu einem falschen Code.
 */
data class Anmeldung(
    val erfolg: Boolean,
    val token: String? = null,
    val benutzer: String? = null,
    val verwalter: Boolean = false,
    val zweiterFaktor: Boolean = false,
    val fehler: String? = null,
)

/** Wer angemeldet ist, wie der Server es sieht. */
data class AccountOwner(val id: Int, val benutzer: String, val verwalter: Boolean, val zweiterFaktorPflicht: Boolean)

/** Eine begonnene QR-Kopplung: [code] zeigt die App zum Vergleich mit dem Browser. */
data class QrPairing(val abholung: String, val code: String, val validSeconds: Int)

/** Ein Blick auf die Abholung einer QR-Kopplung: wartend, als Vorschau des Kontos oder mit Token. */
data class QrAbholstand(
    val token: String? = null,
    val benutzer: String? = null,
    val wartet: Boolean = false,
    val vorschau: Boolean = false,
    val fehler: String? = null,
)

/** Was der Server ohne Anmeldung anbietet. */
data class Registrierungsstand(val offen: Boolean, val passkey: Boolean, val passwortVergessen: Boolean, val mailVersand: Boolean)

/** Ein neues Konto; [withoutMailversand]: Der Link steht im Serverprotokoll statt in einer E-Mail. */
data class Registrierung(val meldung: String?, val withoutMailversand: Boolean)

/** Die Angaben eines neuen Kontos; leere Namen heissen „nicht angegeben“. */
data class Kontoanlage(
    val benutzer: String,
    val email: String,
    val vorname: String?,
    val nachname: String?,
    val passwort: String,
    val sprache: String,
)

/** Eine Profiländerung; [passwortAktuell] verlangt der Server immer, [code] bei zweitem Faktor. */
data class Profilaenderung(
    val benutzer: String,
    val email: String,
    val vorname: String?,
    val nachname: String?,
    val passwortAktuell: String,
    val code: String?,
)

/** Eine neue Adresse gilt erst nach dem Link; [mailSent] sagt, ob er unterwegs ist. */
data class ProfilGespeichert(val newAddress: Boolean, val mailSent: Boolean)

/** Wirksames Design, Vorgabe des Verwalters und eigene Wahl; ohne [vorgabe] kennt der Server kein Design je Konto. */
data class Designstand(val wirksam: Design?, val vorgabe: Design?, val eigenes: Design?)

/** Passwort und, wenn verlangt, Code des zweiten Faktors für eine heikle Aktion. */
data class Confirmation(val passwort: String? = null, val code: String? = null)

data class ZweiterFaktorStand(val aktiv: Boolean, val codesUebrig: Int)

data class ZweiterFaktorEinrichtung(val geheimnis: String?, val otpauth: String?)

/** Die Einstellungen des Kontos; [effectiveState] ist die eigene Vorgabe oder die des Servers. */
data class AccountSettings(
    val waehrung: Waehrung,
    val priceState: Zustand,
    val defaultState: Zustand,
    val effectiveState: Zustand,
)
