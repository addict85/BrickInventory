package ch.brickinventoryapp.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Anmeldung, Konto und Sitzung.
 *
 * ── Warum diese Datei existiert (Nachtrag 155) ──────────────────────────────
 *
 * Alle 92 Datenklassen der App standen in EINER Datei, Models.kt, mit 1158
 * Zeilen. Jede Aenderung an irgendeinem Modell beruehrte dieselbe Datei — bei
 * parallelen Aenderungen ein sicherer Konflikt, und beim Suchen war der Weg
 * immer derselbe: eine Datei oeffnen und scrollen.
 *
 * Aufgeteilt wurde entlang der Sachgebiete. Die Klassen selbst sind WORTGLEICH
 * uebernommen: Es wurde nichts umbenannt, nichts zusammengefasst und kein Feld
 * angefasst. Sie liegen weiter im Paket ch.brickinventoryapp.data.model, also
 * aendert sich fuer keinen Aufrufer etwas — Kotlin bindet an das Paket, nicht
 * an die Datei.
 */

/**
 * Anmeldung mit Zugangsdaten.
 *
 * `neverExpires` sagt dem Server, dass dieses Geraet einen Token OHNE
 * Ablaufdatum bekommen soll. Bis zum Zusammenlegen der beiden Anmeldungen
 * steckte diese Entscheidung in der ADRESSE: /api/v1/auth/login gab dauerhafte
 * Token aus, /api/auth/login solche mit sieben Tagen Laufzeit. Jetzt gibt es
 * nur noch eine Adresse, und der Unterschied steht da, wo man ihn sieht.
 *
 * Fuer die App ist `true` richtig: Der Token ist ihr einziger Ausweis, und wer
 * die App oeffnet, soll nicht jedes Mal sein Passwort eintippen. Ungenutzt
 * verfaellt er trotzdem (TOKEN_IDLE_DAYS auf dem Server, Vorgabe 90 Tage).
 */
@Serializable
data class LoginRequest(
    val username: String,
    val password: String,
    val label: String = "Android App",
    @SerialName("never_expires") val neverExpires: Boolean = true,
)

@Serializable
data class QrLoginRequest(val token: String)

@Serializable
data class LoginResponse(
    val success: Boolean,
    val token: String? = null,
    val user: User? = null,
    val error: String? = null
)

@Serializable
data class User(
    val id: Int,
    val username: String,
    @SerialName("is_admin") val isAdmin: Boolean = false
)

@Serializable
data class UserSettings(
    val currency: String = "EUR",
    @SerialName("price_condition") val priceCondition: String = "N",
    @SerialName("price_cache_ttl") val priceCacheTtl: String = "24",
    @SerialName("default_price_condition") val defaultPriceCondition: String = "N",
    @SerialName("user_default_condition") val userDefaultCondition: String? = null,
    @SerialName("effective_condition") val effectiveCondition: String = "N", // resolved: user→global→'N'
    @SerialName("app_theme") val appTheme: String = "classic" // global vom Admin gewähltes Design
)

/** Antwort von GET /api/v1/settings/theme — die einzige Adresse ohne Anmeldung. */
@Serializable
data class AppThemeResponse(val success: Boolean = false, val theme: String = "classic")

@Serializable
data class SettingsResponse(
    val success: Boolean,
    val settings: UserSettings = UserSettings(),
    val error: String? = null
)

/**
 * Ein ausgestellter Zugang, wie ihn GET /api/v1/settings/tokens auflistet.
 *
 * `tokenId` sind die ersten 16 Zeichen des SHA-256-HASHES, nicht des Tokens.
 * Der Klartext existiert auf dem Server nicht mehr — er wurde einmal
 * ausgegeben und nie gespeichert. Zum Wiederfinden der Zeile reicht der Hash.
 *
 * `aktuell` markiert den Zugang, mit dem GERADE gefragt wird. Ohne das kann
 * man sich mit dem eigenen Knopf selbst aussperren, ohne es zu merken.
 */
@Serializable
data class AppToken(
    @SerialName("token_id") val tokenId: String,
    val label: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("last_used") val lastUsed: String? = null,
    @SerialName("expires_at") val expiresAt: String? = null,
    @SerialName("never_expires") val neverExpires: Boolean = false,
    val aktuell: Boolean = false,
)

@Serializable
data class TokensResponse(
    val success: Boolean,
    val tokens: List<AppToken> = emptyList(),
    val error: String? = null,
)

@Serializable
data class MeResponse(
    val success: Boolean,
    val user: User? = null
)

// ── Konto anlegen und Passwort vergessen ────────────────────────────────────
//
// Die Webapp konnte das von Anfang an, die App nicht: Wer die App als Erstes
// installierte, brauchte zwingend einen Browser, um ueberhaupt ein Konto zu
// bekommen. Dieselben Adressen, dieselben Felder wie in public/js/01-core.js.

/**
 * Registrierung — POST /api/v1/auth/register.
 *
 * `language` steuert die Sprache der Bestaetigungs-E-Mail UND die
 * Nutzereinstellung des neuen Kontos (routes/auth.ts schreibt sie direkt in
 * user_settings). Die App schickt deshalb ihre eigene Anzeigesprache mit,
 * statt den Server auf 'de' zurueckfallen zu lassen.
 */
@Serializable
data class RegisterRequest(
    val username: String,
    val email: String,
    @SerialName("first_name") val firstName: String? = null,
    @SerialName("last_name") val lastName: String? = null,
    val password: String,
    val language: String = "de",
)

/**
 * Die Antwort auf eine Registrierung.
 *
 * `consoleMode` ist der Fall ohne eingerichteten Mailversand: Der Server legt
 * das Konto an und schreibt den Bestaetigungslink in seine Konsole. Ohne diesen
 * Hinweis wartet man auf eine E-Mail, die nie kommt — die Webapp haengt dafuer
 * einen eigenen Satz an, und die App tut jetzt dasselbe.
 */
@Serializable
data class RegisterResponse(
    val success: Boolean,
    val message: String? = null,
    @SerialName("email_sent") val emailSent: Boolean = false,
    @SerialName("console_mode") val consoleMode: Boolean = false,
    val error: String? = null,
)

@Serializable
data class ForgotPasswordRequest(val email: String)

/**
 * Die Antwort auf „Passwort vergessen".
 *
 * Sie ist ABSICHTLICH immer dieselbe — „Falls die E-Mail existiert, wurde ein
 * Link gesendet." Der Server unterscheidet nicht zwischen bekannter und
 * unbekannter Adresse, sonst verriete das Formular, wer hier ein Konto hat.
 * Die App darf daraus also keine Erfolgs- oder Fehlermeldung ableiten; sie
 * zeigt den Satz des Servers.
 */
@Serializable
data class ForgotPasswordResponse(
    val success: Boolean,
    val message: String? = null,
    val error: String? = null,
)

/**
 * Ist die Registrierung ueberhaupt offen? — GET /api/v1/auth/registration-status.
 *
 * OHNE Anmeldung erreichbar, wie im Web. Der Verwalter kann Registrierungen
 * global abschalten (global_settings.registration_enabled); dann blendet die
 * Webapp den Link aus, und die App tut jetzt dasselbe. Ein Knopf, der immer zu
 * einem 403 fuehrt, ist schlimmer als kein Knopf.
 */
@Serializable
data class RegistrationStatusResponse(val enabled: Boolean = false)

// ── Profil und Passwort ─────────────────────────────────────────────────────
//
// Die Routen gab es laengst; die App kam nur nicht daran. /auth/profile und
// /auth/change-password hingen an einem sitzungsgebundenen Waechter, und die
// App hat keine Sitzung (Nachtrag 127). Seit beide Waechter dieselbe Frage
// stellen, sind es normale Aufrufe wie jeder andere.

/** Das eigene Konto — GET /api/v1/auth/profile. */
@Serializable
data class Profil(
    val id: Int,
    val username: String,
    val email: String? = null,
    @SerialName("first_name") val firstName: String? = null,
    @SerialName("last_name") val lastName: String? = null,
    /**
     * Ist die E-Mail-Adresse bestaetigt?
     *
     * Der Server liefert hier je nach Treiber 0/1 oder true/false, deshalb
     * `Int`: Als Boolean deserialisiert eine 0 nicht. Gelesen wird sie als
     * `emailVerified == 1`.
     */
    @SerialName("email_verified") val emailVerified: Int = 0,
)

@Serializable
data class ProfilResponse(
    val success: Boolean,
    val user: Profil? = null,
    val error: String? = null,
)

/**
 * Profil aendern — PUT /api/v1/auth/profile.
 *
 * Das Passwort kann hier MITGEAENDERT werden, dann verlangt der Server
 * `passwordCurrent`. Die App benutzt dafuer trotzdem /change-password: Nur
 * dieser Weg verwirft anschliessend alle offenen Zugaenge, und genau das will,
 * wer sein Passwort aendert. Die beiden Felder stehen hier, weil die
 * Schnittstelle sie kennt — belegt werden sie nicht.
 */
@Serializable
data class ProfilAenderung(
    val username: String,
    val email: String,
    @SerialName("first_name") val firstName: String? = null,
    @SerialName("last_name") val lastName: String? = null,
)

/**
 * Passwort aendern — POST /api/v1/auth/change-password.
 *
 * ACHTUNG, und die Oberflaeche sagt es dem Nutzer vorher: Der Server verwirft
 * danach ALLE Bearer-Token des Kontos — auch den, mit dem diese Anfrage kam.
 * Die App ist nach einem erfolgreichen Wechsel abgemeldet. Das ist richtig so:
 * Wer sein Passwort aendert, will bestehende Zugaenge loswerden, und eine
 * Ausnahme fuer den gerade benutzten waere genau die Luecke.
 */
@Serializable
data class PasswortAenderung(
    val current: String,
    @SerialName("newPassword") val neuesPasswort: String,
)

// ── Server-Protokoll (nur fuer Verwalter) ───────────────────────────────────
//
// Auch das konnte die Webapp seit jeher. Die Route lag hinter dem
// sitzungsgebundenen requireAdmin; seit der Waechter beide Ausweise nimmt
// (Nachtrag 127), erreicht die App sie mit ihrem Token.
//
// Die Modelle der NUTZERVERWALTUNG standen hier ebenfalls (Konto,
// KontenResponse, NeuesKonto, VerwalterAenderung, FremdesPasswort) und sind
// auf Marcos Entscheidung wieder entfernt: Konten verwaltet man am Rechner,
// nicht auf einem Telefon (Nachtrag 129).

/**
 * Eine Zeile aus dem Server-Protokoll — GET /api/v1/admin/logs?minutes=15.
 *
 * Der Server begrenzt selbst auf 2880 Minuten und 5000 Zeilen; die App muss
 * dafuer nichts tun ausser die Zeitspanne zu schicken.
 */
@Serializable
data class ProtokollZeile(
    val id: Int? = null,
    val level: String? = null,
    val message: String? = null,
    @SerialName("logged_at") val loggedAt: String? = null,
)

@Serializable
data class ProtokollResponse(
    val success: Boolean,
    val minutes: Int = 0,
    val count: Int = 0,
    val logs: List<ProtokollZeile> = emptyList(),
    val error: String? = null,
)
