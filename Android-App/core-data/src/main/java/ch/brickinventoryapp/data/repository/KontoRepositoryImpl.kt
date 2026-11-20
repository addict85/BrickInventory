package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import ch.brickinventoryapp.data.api.AccountApi
import ch.brickinventoryapp.model.fach.Anmeldung
import ch.brickinventoryapp.model.fach.Confirmation
import ch.brickinventoryapp.model.fach.Designstand
import ch.brickinventoryapp.model.fach.Kontoanlage
import ch.brickinventoryapp.model.fach.AccountSettings
import ch.brickinventoryapp.model.fach.AccountOwner
import ch.brickinventoryapp.model.fach.ProfilGespeichert
import ch.brickinventoryapp.model.fach.Profilaenderung
import ch.brickinventoryapp.model.fach.QrAbholstand
import ch.brickinventoryapp.model.fach.QrPairing
import ch.brickinventoryapp.model.fach.Registrierung
import ch.brickinventoryapp.model.fach.Registrierungsstand
import ch.brickinventoryapp.model.fach.ZweiterFaktorEinrichtung
import ch.brickinventoryapp.model.fach.ZweiterFaktorStand
import ch.brickinventoryapp.model.fach.DeviceView
import ch.brickinventoryapp.model.fach.ProfileView
import ch.brickinventoryapp.vertrag.ProfilAenderung
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht
import ch.brickinventoryapp.vertrag.abbildung.asDevice
import ch.brickinventoryapp.vertrag.abbildung.verwalter
import ch.brickinventoryapp.vertrag.AndereBeendenAnfrage
import ch.brickinventoryapp.vertrag.ForgotPasswordRequest
import ch.brickinventoryapp.vertrag.LoginRequest
import ch.brickinventoryapp.vertrag.LoginResponse
import ch.brickinventoryapp.vertrag.PasskeyAnmeldungAnfrage
import ch.brickinventoryapp.vertrag.PasskeyOptionenAnfrage
import ch.brickinventoryapp.vertrag.PasswortAenderung
import ch.brickinventoryapp.vertrag.QrVerwerfen
import ch.brickinventoryapp.vertrag.RegisterRequest
import ch.brickinventoryapp.vertrag.ZweiterFaktorAnfrage
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import ch.brickinventoryapp.model.json.BrickJson
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import ch.brickinventoryapp.model.koroutinen.BrickDispatchers
import ch.brickinventoryapp.model.koroutinen.Dispatcher
import kotlinx.coroutines.CoroutineDispatcher
import javax.inject.Inject
import javax.inject.Singleton
import ch.brickinventoryapp.data.Entwertungsergebnis
import ch.brickinventoryapp.data.SwappedToken
import ch.brickinventoryapp.data.classifyRedemption
import ch.brickinventoryapp.vertrag.QrAbholRequest
import ch.brickinventoryapp.vertrag.QrLoginRequest
import ch.brickinventoryapp.netz.util.NetworkPolicy
import ch.brickinventoryapp.netz.util.Protokoll

/**
 * Anmeldung und das eigene Konto: Profil, Passwort, zweiter Faktor, Geräte, Design und Einstellungen — über Retrofit; die gemeinsame Abruflogik steht in Abruf.kt.
 */
@Singleton
class KontoRepositoryImpl @Inject constructor(
    private val api: AccountApi,
    /** Für den blockierenden Tausch. */
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
    private val json: Json = BrickJson,
) : AccountRepository {

    // Kein Authorization-Header hier: Der OkHttp-Interceptor in di/ServerClient.kt
    // setzt "Bearer <token>" für alle Anfragen an unseren Server (aus dem
    // Speicher-Spiegel der TokenAblage), auch für die SSE-Ströme.

    /**
     * Verlangt der Server den zweiten Faktor, antwortet er mit 401 und
     * `zweiter_faktor: true`. Das wird hier zu einer gewöhnlichen Antwort mit
     * success=false umgebogen (wie VouchersRepository.guthaben), sonst gingen
     * Kennzeichen und Satz in sicherAufrufen verloren. [passkey] ersetzt den Code.
     */
    override suspend fun login(serverUrl: String, username: String, password: String, code: String?,
                      scope: String, passkey: JsonObject?): Ergebnis<Anmeldeantwort> {
        var routes = SecondFactorRoutes()
        val r = sicherAufrufen {
            val https = NetworkPolicy.istHttps(serverUrl)
            val antwort = if (passkey != null)
                api.loginWithPasskey(LoginRequest(username = username, password = password, passkey = passkey, scope = scope, neverExpires = https))
            else api.login(LoginRequest(username = username, password = password, code = code, scope = scope, neverExpires = https))
            if (antwort.code() == 401) {
                val rumpf = antwort.errorBody()?.string()
                val parsed = rumpf?.let { runCatching { json.decodeFromString<LoginResponse>(it) }.getOrNull() }
                rumpf?.let { runCatching { json.decodeFromString<SecondFactorRoutes>(it) }.getOrNull() }?.let { routes = it }
                if (parsed?.zweiterFaktor == true) retrofit2.Response.success(parsed) else antwort
            } else antwort
        }
        return when (r) {
            is Ergebnis.Erfolg -> Ergebnis.Erfolg(Anmeldeantwort(r.data.asLogin(), routes.passkey), stand = r.stand, gepuffert = r.gepuffert)
            is Ergebnis.Fehler -> r
        }
    }

    /** Die Optionen für den Credential Manager; [zweck] wie PASSKEY_SIGN_IN. */
    override suspend fun passkeyOptions(zweck: String): Ergebnis<JsonObject> =
        sicherAufrufen { api.passkeyOptions(PasskeyOptionenAnfrage(zweck = zweck)) }.shown { it.optionen }

    /** Ohne Passwort; derselbe Token wie bei [login], mit denselben Regeln für den Ablauf. */
    override suspend fun signInPasskey(serverUrl: String, antwort: JsonObject, scope: String): Ergebnis<Anmeldung> =
        sicherAufrufen { api.signInPasskey(PasskeyAnmeldungAnfrage(antwort = antwort, scope = scope,
            neverExpires = NetworkPolicy.istHttps(serverUrl))) }.shown { it.asLogin() }

    override suspend fun qrLogin(token: String, label: String): Ergebnis<QrPairing> =
        sicherAufrufen { api.qrLogin(QrLoginRequest(token = token, label = label)) }
            .promised({ it.success && it.abholung.isNotEmpty() && it.code.isNotEmpty() }, { null }) {
                QrPairing(it.abholung, it.code, it.expiresIn)
            }

    override suspend fun pickUpQr(abholung: String, vorschau: Boolean): Ergebnis<QrAbholstand> =
        sicherAufrufen { api.pickUpQr(QrAbholRequest(abholung = abholung, vorschau = vorschau)) }.shown {
            QrAbholstand(token = it.token, benutzer = it.username ?: it.user?.username, wartet = it.wartet,
                vorschau = it.vorschau, fehler = it.error)
        }

    override suspend fun discardQr(abholung: String): Ergebnis<Unit> =
        sicherAufrufen { api.discardQr(QrVerwerfen(abholung = abholung)) }.withoutContent()

    override suspend fun getMe(): Ergebnis<AccountOwner?> = sicherAufrufen { api.getMe() }.shown { r ->
        r.user?.let { AccountOwner(it.id, it.username, it.isAdmin, it.zweiterFaktorPflicht) }
    }

    // Konto anlegen und Passwort vergessen — beides ohne bestehende Anmeldung.
    override suspend fun getRegistrationStatus(): Ergebnis<Registrierungsstand> =
        sicherAufrufen { api.getRegistrationStatus() }.shown {
            Registrierungsstand(it.enabled, it.passkey, it.passwortVergessen, it.mailVersand)
        }

    override suspend fun register(anlage: Kontoanlage): Ergebnis<Registrierung> =
        sicherAufrufen {
            api.register(RegisterRequest(username = anlage.benutzer, email = anlage.email, firstName = anlage.vorname,
                lastName = anlage.nachname, password = anlage.passwort, language = anlage.sprache))
        }.promised({ it.success }, { it.error }) { Registrierung(it.message, it.consoleMode) }

    override suspend fun forgotPassword(email: String): Ergebnis<String?> =
        sicherAufrufen { api.forgotPassword(ForgotPasswordRequest(email = email)) }.promised({ it.success }, { it.error }) { it.message }

    override suspend fun getProfile(): Ergebnis<ProfileView> =
        sicherAufrufen { api.getProfile() }.promised({ it.user != null }, { it.error }) { it.user!!.alsAnsicht() }

    override suspend fun secondFactorStatus(): Ergebnis<ZweiterFaktorStand> =
        sicherAufrufen { api.secondFactorStatus() }.promised({ it.success }, { it.error }) { ZweiterFaktorStand(it.aktiv, it.codesUebrig) }

    override suspend fun setUpSecondFactor(passwort: String): Ergebnis<ZweiterFaktorEinrichtung> =
        sicherAufrufen { api.setUpSecondFactor(ZweiterFaktorAnfrage(password = passwort)) }
            .promised({ it.success }, { it.error }) { ZweiterFaktorEinrichtung(it.geheimnis, it.otpauth) }

    override suspend fun zweiterFaktorBestaetigen(code: String): Ergebnis<List<String>> =
        sicherAufrufen { api.zweiterFaktorBestaetigen(ZweiterFaktorAnfrage(code = code)) }.promised({ it.success }, { it.error }) { it.codes }

    override suspend fun disableSecondFactor(passwort: String, code: String): Ergebnis<Unit> =
        sicherAufrufen { api.disableSecondFactor(ZweiterFaktorAnfrage(password = passwort, code = code)) }.erledigt()

    override suspend fun secondFactorNewCodes(code: String): Ergebnis<List<String>> =
        sicherAufrufen { api.secondFactorNewCodes(ZweiterFaktorAnfrage(code = code)) }.promised({ it.success }, { it.error }) { it.codes }

    override suspend fun updateProfile(aenderung: Profilaenderung): Ergebnis<ProfilGespeichert> =
        sicherAufrufen {
            api.updateProfile(ProfilAenderung(username = aenderung.benutzer, email = aenderung.email, firstName = aenderung.vorname,
                lastName = aenderung.nachname, passwordCurrent = aenderung.passwortAktuell, code = aenderung.code))
        }.promised({ it.success }) { ProfilGespeichert(newAddress = it.emailChanged == true, mailSent = it.emailSent == true) }

    override suspend fun changePassword(aktuell: String, neu: String, code: String?): Ergebnis<Unit> =
        sicherAufrufen { api.changePassword(PasswortAenderung(current = aktuell, newPassword = neu, code = code)) }.erledigt()

    override suspend fun getTokens(): Ergebnis<List<DeviceView>> =
        sicherAufrufen { api.getTokens() }.promised({ it.success }, { it.error }) { r -> r.tokens.map { it.asDevice() } }

    override suspend fun revokeToken(tokenId: String, confirmation: Confirmation): Ergebnis<Int> =
        sicherAufrufen { api.revokeToken(tokenId, confirmation.asRequest()) }.shown { it.deleted }

    override suspend fun endOther(confirmation: Confirmation): Ergebnis<Int> =
        sicherAufrufen { api.endOther(AndereBeendenAnfrage(password = confirmation.passwort, code = confirmation.code)) }
            .shown { it.zugaenge }

    /**
     * Den Token tauschen; [alterToken] geht ausdrücklich mit (siehe data/TokenSwap).
     * Synchron auf einem IO-Faden, am Dispatcher von OkHttp vorbei (AccountApi.rotateToken).
     * Die Herkunft kommt aus der Anfrage, die tatsächlich ging: Nur an sie ist der neue Token gebunden.
     */
    override suspend fun rotateToken(alterToken: String): Ergebnis<SwappedToken> {
        var herkunft: String? = null
        val r = sicherAufrufen {
            kotlinx.coroutines.withContext(io) { api.rotateToken("Bearer $alterToken").execute() }
                .also { herkunft = NetworkPolicy.herkunft(it.raw().request.url.toString()) }
        }
        return when (r) {
            is Ergebnis.Erfolg -> Ergebnis.Erfolg(SwappedToken(r.data.token, herkunft), stand = r.stand, gepuffert = r.gepuffert)
            is Ergebnis.Fehler -> r
        }
    }

    /**
     * Den Token am Server entwerten, bevor er lokal verschwindet — sonst bliebe er
     * gültig, bis er verfällt. Höchstens [limitMs]: Abmelden darf nicht am Netz
     * hängen. Was dann noch offen ist, holt data/Abmeldung nach.
     */
    override suspend fun signOutAtServer(limitMs: Long): Boolean =
        redeemAtServer(limitMs) == Entwertungsergebnis.ENTWERTET

    /** Wie [signOutAtServer], aber mit dem Grund: Nur LATER lohnt eine Wiederholung. */
    override suspend fun redeemAtServer(limitMs: Long): Entwertungsergebnis = fangeAusserAbbruch {
        kotlinx.coroutines.withTimeoutOrNull(limitMs) { classifyRedemption(api.logout().code()) }
            ?: Entwertungsergebnis.LATER.also {
                Protokoll.warnung("Abmelden", "Server antwortete nicht in $limitMs ms")
            }
    }.getOrElse { e ->
        Protokoll.warnung("Abmelden", "Token am Server nicht entwertet", e)
        Entwertungsergebnis.LATER
    }

    override suspend fun getSettings(): Ergebnis<AccountSettings> =
        sicherAufrufen { api.getSettings() }.shown {
            val e = it.settings
            AccountSettings(e.currency, e.priceCondition, e.defaultPriceCondition, e.effectiveCondition)
        }

    /** Das wirksame Design: mit Token das des Kontos, sonst die Vorgabe. Siehe AccountApi.getAppTheme. */
    override suspend fun getAppTheme(): Ergebnis<Designstand> =
        sicherAufrufen { api.getAppTheme() }.promised({ it.success }) { Designstand(it.theme, it.vorgabe, it.eigenes) }

    /** Eigenes Design setzen; null stellt auf die Vorgabe des Verwalters zurück ("" auf der Leitung). */
    override suspend fun setOwnDesign(theme: Design?): Ergebnis<Designstand> =
        sicherAufrufen { api.setOwnDesign(mapOf("theme" to (theme?.kennung ?: ""))) }
            .promised({ it.success }) { Designstand(it.theme, it.vorgabe, it.eigenes) }

    override suspend fun updateSettings(currency: Waehrung, condition: Zustand): Ergebnis<Unit> =
        sicherAufrufen { api.updateSettings(mapOf("currency" to currency.code, "price_condition" to condition.kennung)) }.erledigt()

    override suspend fun getDefaultCondition(): Ergebnis<Zustand> = sicherAufrufen { api.getDefaultCondition() }.shown { it.condition }

    // User-level: saves per-user default (empty string = revert to global)
    override suspend fun setUserDefaultCondition(condition: Zustand?): Ergebnis<Unit> =
        sicherAufrufen { api.setUserDefaultCondition(mapOf("condition" to condition?.kennung.orEmpty())) }.promised({ it.success }) { }
}

/** Die Antwort auf [AccountRepository.login]; [passkeyStattCode], wenn der Server beim
 * zweiten Faktor auch einen Passkey nimmt. */
data class Anmeldeantwort(val antwort: Anmeldung, val passkeyStattCode: Boolean = false)

private fun LoginResponse.asLogin() =
    Anmeldung(erfolg = success, token = token, benutzer = user?.username, verwalter = verwalter,
        zweiterFaktor = zweiterFaktor, fehler = error)

private fun Confirmation.asRequest() = ZweiterFaktorAnfrage(password = passwort, code = code)

/** Aus der 401-Antwort auf den zweiten Faktor: Geht statt des Codes ein Passkey? Steht nicht im Vertrag (Fehler trägt Zusatzfelder frei). */
@Serializable
private data class SecondFactorRoutes(val passkey: Boolean = false)
