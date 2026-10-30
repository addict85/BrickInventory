package ch.brickinventoryapp.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Anmeldung, Konto und Sitzung. Die Modelle liegen je Sachgebiet in einer Datei,
 * alle im Paket data.model.
 */

/**
 * Anmeldung mit Zugangsdaten. `neverExpires`: Über https bekommt die App einen
 * Token ohne Ablaufdatum, weil er ihr einziger Ausweis ist; ungenutzt verfällt er
 * trotzdem (TOKEN_IDLE_DAYS). Über http nie (KontoRepository.login).
 */
@Serializable
data class LoginRequest(
    val username: String,
    val password: String,
    val label: String = "Android App",
    @SerialName("never_expires") val neverExpires: Boolean = false,
    /** Code des zweiten Faktors — nur, wenn der Server danach gefragt hat. */
    val code: String? = null,
)

@Serializable
data class QrLoginRequest(val token: String)

@Serializable
data class LoginResponse(
    val success: Boolean,
    val token: String? = null,
    val user: User? = null,
    val error: String? = null,
    /** Passwort stimmt, der Server verlangt den Code aus der Authenticator-App. */
    @SerialName("zweiter_faktor") val zweiterFaktor: Boolean = false,
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
    @SerialName("app_theme") val appTheme: String = "classic" // Vorgabe des Verwalters; das des Kontos: /settings/theme
)

/**
 * Startzustand des Servers — GET /api/v1/startup-status, ohne Anmeldung. Der erste
 * Start einer Neuinstallation kann viele Minuten dauern; statt „keine Verbindung“
 * zeigt die App dann den Fortschritt wie die Webapp.
 *
 * @param ready    Server ist durch; ab hier ist alles wie immer.
 * @param step     Was gerade läuft, vom Server übersetzt.
 * @param progress Erledigte Schritte, `total` insgesamt; 0/0 = unbekannt.
 * @param sub      Feinfortschritt innerhalb eines Schritts, z. B. „40%“.
 */
@Serializable
data class StartupStatus(
    val ready: Boolean = false,
    val step: String? = null,
    val progress: Int = 0,
    val total: Int = 0,
    val sub: String? = null,
)

/**
 * GET /api/v1/settings/theme (auch ohne Anmeldung) und POST …/user/theme. Mit
 * Token ist [theme] das wirksame Design des Kontos: [eigenes], sonst die
 * [vorgabe] des Verwalters. Ältere Server kennen nur [theme].
 */
@Serializable
data class AppThemeResponse(
    val success: Boolean = false,
    val theme: String = "classic",
    val vorgabe: String? = null,
    val eigenes: String? = null,
    val error: String? = null,
)

@Serializable
data class SettingsResponse(
    val success: Boolean,
    val settings: UserSettings = UserSettings(),
    val error: String? = null
)

/**
 * Ein ausgestellter Zugang (GET /api/v1/settings/tokens). `tokenId` sind 16
 * Zeichen des SHA-256-Hashes; den Klartext hat der Server nie gespeichert.
 * `aktuell` markiert den Zugang dieser Anfrage, damit man sich nicht unbemerkt
 * selbst aussperrt.
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
 * Registrierung — POST /api/v1/auth/register. `language` steuert
 * Bestätigungs-E-Mail und Kontoeinstellung; die App schickt ihre Anzeigesprache
 * mit, statt den Server auf 'de' zurückfallen zu lassen.
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
 * Die Antwort auf eine Registrierung. `consoleMode`: Ohne Mailversand steht der
 * Bestätigungslink in der Konsole des Servers — ohne Hinweis wartete man auf eine
 * E-Mail, die nie kommt.
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
 * Die Antwort auf „Passwort vergessen“ ist absichtlich immer dieselbe, damit das
 * Formular nicht verrät, wer ein Konto hat. Die App zeigt den Satz des Servers und
 * leitet nichts daraus ab.
 */
@Serializable
data class ForgotPasswordResponse(
    val success: Boolean,
    val message: String? = null,
    val error: String? = null,
)

/**
 * Ist die Registrierung offen? GET /api/v1/auth/registration-status, ohne
 * Anmeldung. Ist sie abgeschaltet, fehlt der Link — ein Knopf, der immer zu einem
 * 403 führt, ist schlimmer als keiner.
 */
@Serializable
data class RegistrationStatusResponse(val enabled: Boolean = false)

// ── Profil und Passwort ──

/** Das eigene Konto — GET /api/v1/auth/profile. */
@Serializable
data class Profil(
    val id: Int,
    val username: String,
    val email: String? = null,
    @SerialName("first_name") val firstName: String? = null,
    @SerialName("last_name") val lastName: String? = null,
    /**
     * Ist die E-Mail-Adresse bestätigt? `Int`, weil der Server je nach Treiber 0/1
     * oder true/false liefert und eine 0 als Boolean nicht deserialisiert; gelesen als
     * `== 1`.
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
 * Profil ändern — PUT /api/v1/auth/profile. Das Passwort ändert nur
 * /change-password; eine neue E-Mail-Adresse verlangt `passwordCurrent`.
 */
@Serializable
data class ProfilAenderung(
    val username: String,
    val email: String,
    @SerialName("first_name") val firstName: String? = null,
    @SerialName("last_name") val lastName: String? = null,
    /** Nur bei neuer E-Mail-Adresse: Der Server verlangt dann das Passwort. */
    @SerialName("password_current") val passwordCurrent: String? = null,
)

/**
 * Passwort ändern — POST /api/v1/auth/change-password. Der Server verwirft danach
 * alle Bearer-Token des Kontos, auch den dieser Anfrage; die App ist abgemeldet,
 * und die Oberfläche sagt es vorher. Eine Ausnahme für den gerade benutzten wäre
 * genau die Lücke.
 */
@Serializable
data class PasswortAenderung(
    val current: String,
    @SerialName("newPassword") val neuesPasswort: String,
)

// ── Server-Protokoll (nur für Verwalter) ──
//
// Die Nutzerverwaltung gehört an den Rechner, ihre Modelle stehen deshalb nicht
// hier.

/**
 * Eine Zeile aus dem Server-Protokoll — GET /api/v1/admin/logs?minutes=15. Der
 * Server begrenzt selbst auf 2880 Minuten und 5000 Zeilen.
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

// ── Zweiter Faktor (Server: utils/zweiterFaktor.ts) ──────────────────────────
@Serializable
data class ZweiterFaktorStand(
    val success: Boolean,
    val aktiv: Boolean = false,
    @SerialName("codes_uebrig") val codesUebrig: Int = 0,
    val error: String? = null,
)

@Serializable
data class ZweiterFaktorEinrichtung(
    val success: Boolean,
    /** Base32-Schlüssel zum Abtippen. */
    val geheimnis: String? = null,
    /** otpauth://-Adresse; öffnet auf dem Telefon direkt die Authenticator-App. */
    val otpauth: String? = null,
    val error: String? = null,
)

@Serializable
data class ZweiterFaktorCodes(
    val success: Boolean,
    val codes: List<String> = emptyList(),
    val error: String? = null,
)

@Serializable
data class ZweiterFaktorAnfrage(
    val password: String? = null,
    val code: String? = null,
)
