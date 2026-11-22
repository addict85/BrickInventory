package ch.brickinventoryapp.model.domain

import ch.brickinventoryapp.model.ui.theme.Design

// What the account repository delivers, in domain values: the areas read no field of the
// wire format, and a rename on the server breaks only the mapping in core-data.

/**
 * The response to a sign-in. [verwalter] applies only with a full token; [fehler] is the
 * server's sentence, e.g. on a wrong code.
 */
data class Anmeldung(
    val erfolg: Boolean,
    val token: String? = null,
    val benutzer: String? = null,
    val verwalter: Boolean = false,
    val zweiterFaktor: Boolean = false,
    val fehler: String? = null,
)

/**
 * Who is signed in, as the server sees it. [tokenEndsAt]: the token's hard end from /auth/me
 * (token_info.hard_expires_at, ISO instant); the swap does not move it.
 */
data class AccountOwner(
    val id: Int,
    val benutzer: String,
    val verwalter: Boolean,
    val zweiterFaktorPflicht: Boolean,
    val tokenEndsAt: String? = null,
)

/** A started QR pairing: [code] is shown by the app for comparison with the browser. */
data class QrPairing(val abholung: String, val code: String, val validSeconds: Int)

/** A look at the pickup of a QR pairing: waiting, as a preview of the account or with token. */
data class QrAbholstand(
    val token: String? = null,
    val benutzer: String? = null,
    val wartet: Boolean = false,
    val vorschau: Boolean = false,
    val fehler: String? = null,
)

/** What the server offers without sign-in. */
data class Registrierungsstand(val offen: Boolean, val passkey: Boolean, val passwortVergessen: Boolean, val mailVersand: Boolean)

/** A new account; [withoutMailversand]: the link stands in the server log instead of in an email. */
data class Registrierung(val meldung: String?, val withoutMailversand: Boolean)

/** The details of a new account; empty names mean „not given“. */
data class Kontoanlage(
    val benutzer: String,
    val email: String,
    val vorname: String?,
    val nachname: String?,
    val passwort: String,
    val sprache: String,
)

/** A profile change; [passwortAktuell] is always required by the server, [code] with a second factor. */
data class Profilaenderung(
    val benutzer: String,
    val email: String,
    val vorname: String?,
    val nachname: String?,
    val passwortAktuell: String,
    val code: String?,
)

/** A new address applies only after the link; [mailSent] says whether it is on its way. */
data class ProfilGespeichert(val newAddress: Boolean, val mailSent: Boolean)

/** Effective design, the admin's default and own choice; without [vorgabe] the server knows no design per account. */
data class Designstand(val wirksam: Design?, val vorgabe: Design?, val eigenes: Design?)

/** Password and, if required, second-factor code for a sensitive action. */
data class Confirmation(val passwort: String? = null, val code: String? = null)

data class ZweiterFaktorStand(val aktiv: Boolean, val codesUebrig: Int)

data class ZweiterFaktorEinrichtung(val geheimnis: String?, val otpauth: String?)

/** The account's settings; [effectiveState] is the own default or that of the server. */
data class AccountSettings(
    val waehrung: Waehrung,
    val priceState: Zustand,
    val defaultState: Zustand,
    val effectiveState: Zustand,
)
