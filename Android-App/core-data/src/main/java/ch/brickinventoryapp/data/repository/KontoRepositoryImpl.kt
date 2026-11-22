package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import ch.brickinventoryapp.data.api.AccountApi
import ch.brickinventoryapp.model.domain.Anmeldung
import ch.brickinventoryapp.model.domain.Confirmation
import ch.brickinventoryapp.model.domain.Designstand
import ch.brickinventoryapp.model.domain.Kontoanlage
import ch.brickinventoryapp.model.domain.AccountSettings
import ch.brickinventoryapp.model.domain.AccountOwner
import ch.brickinventoryapp.model.domain.ProfilGespeichert
import ch.brickinventoryapp.model.domain.Profilaenderung
import ch.brickinventoryapp.model.domain.QrAbholstand
import ch.brickinventoryapp.model.domain.QrPairing
import ch.brickinventoryapp.model.domain.Registrierung
import ch.brickinventoryapp.model.domain.Registrierungsstand
import ch.brickinventoryapp.model.domain.ZweiterFaktorEinrichtung
import ch.brickinventoryapp.model.domain.ZweiterFaktorStand
import ch.brickinventoryapp.model.domain.DeviceView
import ch.brickinventoryapp.model.domain.ProfileView
import ch.brickinventoryapp.contract.ProfilAenderung
import ch.brickinventoryapp.contract.mapping.alsAnsicht
import ch.brickinventoryapp.contract.mapping.asDevice
import ch.brickinventoryapp.contract.mapping.verwalter
import ch.brickinventoryapp.contract.AndereBeendenAnfrage
import ch.brickinventoryapp.contract.ForgotPasswordRequest
import ch.brickinventoryapp.contract.LoginRequest
import ch.brickinventoryapp.contract.LoginResponse
import ch.brickinventoryapp.contract.PasskeyAnmeldungAnfrage
import ch.brickinventoryapp.contract.PasskeyOptionenAnfrage
import ch.brickinventoryapp.contract.PasswortAenderung
import ch.brickinventoryapp.contract.QrVerwerfen
import ch.brickinventoryapp.contract.RegisterRequest
import ch.brickinventoryapp.contract.ZweiterFaktorAnfrage
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import ch.brickinventoryapp.model.json.BrickJson
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import ch.brickinventoryapp.model.coroutines.BrickDispatchers
import ch.brickinventoryapp.model.coroutines.Dispatcher
import kotlinx.coroutines.CoroutineDispatcher
import javax.inject.Inject
import javax.inject.Singleton
import ch.brickinventoryapp.data.Entwertungsergebnis
import ch.brickinventoryapp.data.SwappedToken
import ch.brickinventoryapp.data.classifyRedemption
import ch.brickinventoryapp.contract.QrAbholRequest
import ch.brickinventoryapp.contract.QrLoginRequest
import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.model.util.zeitpunkt
import ch.brickinventoryapp.network.util.Protokoll

/**
 * Sign-in and the own account: profile, password, second factor, devices, design and settings — via Retrofit; the common fetch logic stands in Abruf.kt.
 */
@Singleton
class KontoRepositoryImpl @Inject constructor(
    private val api: AccountApi,
    /** For the blocking swap. */
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
    private val json: Json = BrickJson,
) : AccountRepository {

    // No Authorization header here: the OkHttp interceptor in di/ServerClient.kt
    // sets "Bearer <token>" for all requests to our server (from the
    // in-memory mirror of the TokenAblage), also for the SSE streams.

    /**
     * If the server requires the second factor, it answers with 401 and
     * `zweiter_faktor: true`. That is bent here into an ordinary response with
     * success=false (like VouchersRepository.guthaben), otherwise
     * flag and sentence would be lost in sicherAufrufen. [passkey] replaces the code.
     */
    override suspend fun login(serverUrl: String, username: String, password: String, code: String?,
                      scope: String, passkey: JsonObject?): Ergebnis<Anmeldeantwort> {
        var routes = SecondFactorRoutes()
        val r = sicherAufrufen {
            // never_expires means „persistent up to the server's maximum lifetime“ (TOKEN_MAX_DAYS,
            // default 90), not „without an end“: the server caps it, the app signs out itself.
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

    /** The options for the Credential Manager; [zweck] like PASSKEY_SIGN_IN. */
    override suspend fun passkeyOptions(zweck: String): Ergebnis<JsonObject> =
        sicherAufrufen { api.passkeyOptions(PasskeyOptionenAnfrage(zweck = zweck)) }.shown { it.optionen }

    /** Without a password; the same token as with [login], with the same rules for expiry. */
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
        r.user?.let { AccountOwner(it.id, it.username, it.isAdmin, it.zweiterFaktorPflicht, zeitpunkt(r.tokenInfo?.hardExpiresAt)) }
    }

    // Create account and forgot password — both without an existing sign-in.
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
     * Swap the token; [alterToken] explicitly goes along (see data/TokenSwap).
     * Synchronous on an IO thread, bypassing OkHttp's dispatcher (AccountApi.rotateToken).
     * The origin comes from the request that actually went: the new token is bound only to it.
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
     * Invalidate the token at the server before it disappears locally — otherwise it would stay
     * valid until it expires. At most [limitMs]: sign-out must not depend on the
     * network. What is then still open is caught up by data/Abmeldung.
     */
    override suspend fun signOutAtServer(limitMs: Long): Boolean =
        redeemAtServer(limitMs) == Entwertungsergebnis.ENTWERTET

    /** Like [signOutAtServer], but with the reason: only LATER makes a retry worthwhile. */
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

    /** The effective design: with a token the account's, otherwise the default. See AccountApi.getAppTheme. */
    override suspend fun getAppTheme(): Ergebnis<Designstand> =
        sicherAufrufen { api.getAppTheme() }.promised({ it.success }) { Designstand(it.theme, it.vorgabe, it.eigenes) }

    /** Set the own design; null resets to the admin's default ("" on the wire). */
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

/** The response to [AccountRepository.login]; [passkeyStattCode] if the server also
 * takes a passkey for the second factor. */
data class Anmeldeantwort(val antwort: Anmeldung, val passkeyStattCode: Boolean = false)

private fun LoginResponse.asLogin() =
    Anmeldung(erfolg = success, token = token, benutzer = user?.username, verwalter = verwalter,
        zweiterFaktor = zweiterFaktor, fehler = error)

private fun Confirmation.asRequest() = ZweiterFaktorAnfrage(password = passwort, code = code)

/** From the 401 response to the second factor: does a passkey work instead of the code? Not in the contract (the error carries extra fields freely). */
@Serializable
private data class SecondFactorRoutes(val passkey: Boolean = false)
