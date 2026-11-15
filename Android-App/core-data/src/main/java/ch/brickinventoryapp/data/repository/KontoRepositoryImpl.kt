package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import ch.brickinventoryapp.data.api.KontoApi
import ch.brickinventoryapp.model.fach.Anmeldung
import ch.brickinventoryapp.model.fach.Bestaetigung
import ch.brickinventoryapp.model.fach.Designstand
import ch.brickinventoryapp.model.fach.Kontoanlage
import ch.brickinventoryapp.model.fach.Kontoeinstellungen
import ch.brickinventoryapp.model.fach.Kontoinhaber
import ch.brickinventoryapp.model.fach.ProfilGespeichert
import ch.brickinventoryapp.model.fach.Profilaenderung
import ch.brickinventoryapp.model.fach.QrAbholstand
import ch.brickinventoryapp.model.fach.QrKopplung
import ch.brickinventoryapp.model.fach.Registrierung
import ch.brickinventoryapp.model.fach.Registrierungsstand
import ch.brickinventoryapp.model.fach.ZweiterFaktorEinrichtung
import ch.brickinventoryapp.model.fach.ZweiterFaktorStand
import ch.brickinventoryapp.model.fach.GeraetAnsicht
import ch.brickinventoryapp.model.fach.ProfilAnsicht
import ch.brickinventoryapp.vertrag.ProfilAenderung
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht
import ch.brickinventoryapp.vertrag.abbildung.alsGeraet
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
import ch.brickinventoryapp.data.GetauschterToken
import ch.brickinventoryapp.data.einordnenEntwertung
import ch.brickinventoryapp.vertrag.QrAbholRequest
import ch.brickinventoryapp.vertrag.QrLoginRequest
import ch.brickinventoryapp.netz.util.NetworkPolicy
import ch.brickinventoryapp.netz.util.Protokoll

/**
 * Anmeldung und das eigene Konto: Profil, Passwort, zweiter Faktor, Geräte, Design und Einstellungen — über Retrofit; die gemeinsame Abruflogik steht in Abruf.kt.
 */
@Singleton
class KontoRepositoryImpl @Inject constructor(
    private val api: KontoApi,
    /** Für den blockierenden Tausch. */
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
    private val json: Json = BrickJson,
) : KontoRepository {

    // Kein Authorization-Header hier: Der OkHttp-Interceptor in di/ServerClient.kt
    // setzt "Bearer <token>" für alle Anfragen an unseren Server (aus dem
    // Speicher-Spiegel der TokenAblage), auch für die SSE-Ströme.

    /**
     * Verlangt der Server den zweiten Faktor, antwortet er mit 401 und
     * `zweiter_faktor: true`. Das wird hier zu einer gewöhnlichen Antwort mit
     * success=false umgebogen (wie GutscheineRepository.guthaben), sonst gingen
     * Kennzeichen und Satz in sicherAufrufen verloren. [passkey] ersetzt den Code.
     */
    override suspend fun login(serverUrl: String, username: String, password: String, code: String?,
                      scope: String, passkey: JsonObject?): Ergebnis<Anmeldeantwort> {
        var wege = ZweiterFaktorWege()
        val r = sicherAufrufen {
            val https = NetworkPolicy.istHttps(serverUrl)
            val antwort = if (passkey != null)
                api.loginMitPasskey(LoginRequest(username = username, password = password, passkey = passkey, scope = scope, neverExpires = https))
            else api.login(LoginRequest(username = username, password = password, code = code, scope = scope, neverExpires = https))
            if (antwort.code() == 401) {
                val rumpf = antwort.errorBody()?.string()
                val geparst = rumpf?.let { runCatching { json.decodeFromString<LoginResponse>(it) }.getOrNull() }
                rumpf?.let { runCatching { json.decodeFromString<ZweiterFaktorWege>(it) }.getOrNull() }?.let { wege = it }
                if (geparst?.zweiterFaktor == true) retrofit2.Response.success(geparst) else antwort
            } else antwort
        }
        return when (r) {
            is Ergebnis.Erfolg -> Ergebnis.Erfolg(Anmeldeantwort(r.data.alsAnmeldung(), wege.passkey), stand = r.stand, gepuffert = r.gepuffert)
            is Ergebnis.Fehler -> r
        }
    }

    /** Die Optionen für den Credential Manager; [zweck] wie PASSKEY_ANMELDEN. */
    override suspend fun passkeyOptionen(zweck: String): Ergebnis<JsonObject> =
        sicherAufrufen { api.passkeyOptionen(PasskeyOptionenAnfrage(zweck = zweck)) }.abgebildet { it.optionen }

    /** Ohne Passwort; derselbe Token wie bei [login], mit denselben Regeln für den Ablauf. */
    override suspend fun passkeyAnmelden(serverUrl: String, antwort: JsonObject, scope: String): Ergebnis<Anmeldung> =
        sicherAufrufen { api.passkeyAnmelden(PasskeyAnmeldungAnfrage(antwort = antwort, scope = scope,
            neverExpires = NetworkPolicy.istHttps(serverUrl))) }.abgebildet { it.alsAnmeldung() }

    override suspend fun qrLogin(token: String, label: String): Ergebnis<QrKopplung> =
        sicherAufrufen { api.qrLogin(QrLoginRequest(token = token, label = label)) }
            .zugesagt({ it.success && it.abholung.isNotEmpty() && it.code.isNotEmpty() }, { null }) {
                QrKopplung(it.abholung, it.code, it.expiresIn)
            }

    override suspend fun qrAbholen(abholung: String, vorschau: Boolean): Ergebnis<QrAbholstand> =
        sicherAufrufen { api.qrAbholen(QrAbholRequest(abholung = abholung, vorschau = vorschau)) }.abgebildet {
            QrAbholstand(token = it.token, benutzer = it.username ?: it.user?.username, wartet = it.wartet,
                vorschau = it.vorschau, fehler = it.error)
        }

    override suspend fun qrVerwerfen(abholung: String): Ergebnis<Unit> =
        sicherAufrufen { api.qrVerwerfen(QrVerwerfen(abholung = abholung)) }.ohneInhalt()

    override suspend fun getMe(): Ergebnis<Kontoinhaber?> = sicherAufrufen { api.getMe() }.abgebildet { r ->
        r.user?.let { Kontoinhaber(it.id, it.username, it.isAdmin, it.zweiterFaktorPflicht) }
    }

    // Konto anlegen und Passwort vergessen — beides ohne bestehende Anmeldung.
    override suspend fun getRegistrationStatus(): Ergebnis<Registrierungsstand> =
        sicherAufrufen { api.getRegistrationStatus() }.abgebildet {
            Registrierungsstand(it.enabled, it.passkey, it.passwortVergessen, it.mailVersand)
        }

    override suspend fun register(anlage: Kontoanlage): Ergebnis<Registrierung> =
        sicherAufrufen {
            api.register(RegisterRequest(username = anlage.benutzer, email = anlage.email, firstName = anlage.vorname,
                lastName = anlage.nachname, password = anlage.passwort, language = anlage.sprache))
        }.zugesagt({ it.success }, { it.error }) { Registrierung(it.message, it.consoleMode) }

    override suspend fun forgotPassword(email: String): Ergebnis<String?> =
        sicherAufrufen { api.forgotPassword(ForgotPasswordRequest(email = email)) }.zugesagt({ it.success }, { it.error }) { it.message }

    override suspend fun getProfil(): Ergebnis<ProfilAnsicht> =
        sicherAufrufen { api.getProfil() }.zugesagt({ it.user != null }, { it.error }) { it.user!!.alsAnsicht() }

    override suspend fun zweiterFaktorStand(): Ergebnis<ZweiterFaktorStand> =
        sicherAufrufen { api.zweiterFaktorStand() }.zugesagt({ it.success }, { it.error }) { ZweiterFaktorStand(it.aktiv, it.codesUebrig) }

    override suspend fun zweiterFaktorEinrichten(passwort: String): Ergebnis<ZweiterFaktorEinrichtung> =
        sicherAufrufen { api.zweiterFaktorEinrichten(ZweiterFaktorAnfrage(password = passwort)) }
            .zugesagt({ it.success }, { it.error }) { ZweiterFaktorEinrichtung(it.geheimnis, it.otpauth) }

    override suspend fun zweiterFaktorBestaetigen(code: String): Ergebnis<List<String>> =
        sicherAufrufen { api.zweiterFaktorBestaetigen(ZweiterFaktorAnfrage(code = code)) }.zugesagt({ it.success }, { it.error }) { it.codes }

    override suspend fun zweiterFaktorAbschalten(passwort: String, code: String): Ergebnis<Unit> =
        sicherAufrufen { api.zweiterFaktorAbschalten(ZweiterFaktorAnfrage(password = passwort, code = code)) }.erledigt()

    override suspend fun zweiterFaktorNeueCodes(code: String): Ergebnis<List<String>> =
        sicherAufrufen { api.zweiterFaktorNeueCodes(ZweiterFaktorAnfrage(code = code)) }.zugesagt({ it.success }, { it.error }) { it.codes }

    override suspend fun updateProfil(aenderung: Profilaenderung): Ergebnis<ProfilGespeichert> =
        sicherAufrufen {
            api.updateProfil(ProfilAenderung(username = aenderung.benutzer, email = aenderung.email, firstName = aenderung.vorname,
                lastName = aenderung.nachname, passwordCurrent = aenderung.passwortAktuell, code = aenderung.code))
        }.zugesagt({ it.success }, { it.error }) { ProfilGespeichert(neueAdresse = it.emailChanged == true, mailGesendet = it.emailSent == true) }

    override suspend fun changePassword(aktuell: String, neu: String, code: String?): Ergebnis<Unit> =
        sicherAufrufen { api.changePassword(PasswortAenderung(current = aktuell, newPassword = neu, code = code)) }.erledigt()

    override suspend fun getTokens(): Ergebnis<List<GeraetAnsicht>> =
        sicherAufrufen { api.getTokens() }.zugesagt({ it.success }, { it.error }) { r -> r.tokens.map { it.alsGeraet() } }

    override suspend fun revokeToken(tokenId: String, bestaetigung: Bestaetigung): Ergebnis<Int> =
        sicherAufrufen { api.revokeToken(tokenId, bestaetigung.alsAnfrage()) }.abgebildet { it.deleted }

    override suspend fun andereBeenden(bestaetigung: Bestaetigung): Ergebnis<Int> =
        sicherAufrufen { api.andereBeenden(AndereBeendenAnfrage(password = bestaetigung.passwort, code = bestaetigung.code)) }
            .abgebildet { it.zugaenge }

    /**
     * Den Token tauschen; [alterToken] geht ausdrücklich mit (siehe data/TokenTausch).
     * Synchron auf einem IO-Faden, am Dispatcher von OkHttp vorbei (KontoApi.tokenRotieren).
     * Die Herkunft kommt aus der Anfrage, die tatsächlich ging: Nur an sie ist der neue Token gebunden.
     */
    override suspend fun tokenRotieren(alterToken: String): Ergebnis<GetauschterToken> {
        var herkunft: String? = null
        val r = sicherAufrufen {
            kotlinx.coroutines.withContext(io) { api.tokenRotieren("Bearer $alterToken").execute() }
                .also { herkunft = NetworkPolicy.herkunft(it.raw().request.url.toString()) }
        }
        return when (r) {
            is Ergebnis.Erfolg -> Ergebnis.Erfolg(GetauschterToken(r.data.token, herkunft), stand = r.stand, gepuffert = r.gepuffert)
            is Ergebnis.Fehler -> r
        }
    }

    /**
     * Den Token am Server entwerten, bevor er lokal verschwindet — sonst bliebe er
     * gültig, bis er verfällt. Höchstens [grenzeMs]: Abmelden darf nicht am Netz
     * hängen. Was dann noch offen ist, holt data/Abmeldung nach.
     */
    override suspend fun abmeldenAmServer(grenzeMs: Long): Boolean =
        entwertenAmServer(grenzeMs) == Entwertungsergebnis.ENTWERTET

    /** Wie [abmeldenAmServer], aber mit dem Grund: Nur SPAETER lohnt eine Wiederholung. */
    override suspend fun entwertenAmServer(grenzeMs: Long): Entwertungsergebnis = fangeAusserAbbruch {
        kotlinx.coroutines.withTimeoutOrNull(grenzeMs) { einordnenEntwertung(api.logout().code()) }
            ?: Entwertungsergebnis.SPAETER.also {
                Protokoll.warnung("Abmelden", "Server antwortete nicht in $grenzeMs ms")
            }
    }.getOrElse { e ->
        Protokoll.warnung("Abmelden", "Token am Server nicht entwertet", e)
        Entwertungsergebnis.SPAETER
    }

    override suspend fun getSettings(): Ergebnis<Kontoeinstellungen> =
        sicherAufrufen { api.getSettings() }.abgebildet {
            val e = it.settings
            Kontoeinstellungen(e.currency, e.priceCondition, e.defaultPriceCondition, e.effectiveCondition)
        }

    /** Das wirksame Design: mit Token das des Kontos, sonst die Vorgabe. Siehe KontoApi.getAppTheme. */
    override suspend fun getAppTheme(): Ergebnis<Designstand> =
        sicherAufrufen { api.getAppTheme() }.zugesagt({ it.success }, { it.error }) { Designstand(it.theme, it.vorgabe, it.eigenes) }

    /** Eigenes Design setzen; null stellt auf die Vorgabe des Verwalters zurück ("" auf der Leitung). */
    override suspend fun setzeEigenesDesign(theme: Design?): Ergebnis<Designstand> =
        sicherAufrufen { api.setzeEigenesDesign(mapOf("theme" to (theme?.kennung ?: ""))) }
            .zugesagt({ it.success }, { it.error }) { Designstand(it.theme, it.vorgabe, it.eigenes) }

    override suspend fun updateSettings(currency: Waehrung, condition: Zustand): Ergebnis<Unit> =
        sicherAufrufen { api.updateSettings(mapOf("currency" to currency.code, "price_condition" to condition.kennung)) }.erledigt()

    override suspend fun getDefaultCondition(): Ergebnis<Zustand> = sicherAufrufen { api.getDefaultCondition() }.abgebildet { it.condition }

    // User-level: saves per-user default (empty string = revert to global)
    override suspend fun setUserDefaultCondition(condition: Zustand?): Ergebnis<Unit> =
        sicherAufrufen { api.setUserDefaultCondition(mapOf("condition" to condition?.kennung.orEmpty())) }.zugesagt({ it.success }, { it.error }) { }
}

/** Die Antwort auf [KontoRepository.login]; [passkeyStattCode], wenn der Server beim
 * zweiten Faktor auch einen Passkey nimmt. */
data class Anmeldeantwort(val antwort: Anmeldung, val passkeyStattCode: Boolean = false)

private fun LoginResponse.alsAnmeldung() =
    Anmeldung(erfolg = success, token = token, benutzer = user?.username, verwalter = verwalter,
        zweiterFaktor = zweiterFaktor, fehler = error)

private fun Bestaetigung.alsAnfrage() = ZweiterFaktorAnfrage(password = passwort, code = code)

/** Aus der 401-Antwort auf den zweiten Faktor: Geht statt des Codes ein Passkey? Steht nicht im Vertrag (Fehler trägt Zusatzfelder frei). */
@Serializable
private data class ZweiterFaktorWege(val passkey: Boolean = false)
