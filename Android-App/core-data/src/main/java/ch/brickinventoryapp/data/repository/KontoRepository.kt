package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.data.Entwertungsergebnis
import ch.brickinventoryapp.data.GetauschterToken
import ch.brickinventoryapp.model.fach.TOKEN_SCOPE_APP
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
import ch.brickinventoryapp.model.ui.model.GeraetAnsicht
import ch.brickinventoryapp.model.ui.model.ProfilAnsicht
import kotlinx.serialization.json.JsonObject

/**
 * Das eigene Konto: Anmeldung, Profil, Einstellungen, zweiter Faktor, Token.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (KontoRepositoryImpl).
 */
interface KontoRepository {
    suspend fun login(serverUrl: String, username: String, password: String, code: String? = null,
                      scope: String = TOKEN_SCOPE_APP, passkey: JsonObject? = null): Ergebnis<Anmeldeantwort>

    suspend fun passkeyOptionen(zweck: String): Ergebnis<JsonObject>

    suspend fun passkeyAnmelden(serverUrl: String, antwort: JsonObject, scope: String = TOKEN_SCOPE_APP): Ergebnis<Anmeldung>

    suspend fun qrLogin(token: String, label: String): Ergebnis<QrKopplung>
    /** [vorschau]: nach der Bestätigung im Browser nur das Konto, noch kein Token. */
    suspend fun qrAbholen(abholung: String, vorschau: Boolean = false): Ergebnis<QrAbholstand>
    /** Das Nein nach der Vorschau: Die Kopplung ist danach abgelehnt. */
    suspend fun qrVerwerfen(abholung: String): Ergebnis<Unit>

    suspend fun getMe(): Ergebnis<Kontoinhaber?>

    suspend fun getRegistrationStatus(): Ergebnis<Registrierungsstand>

    suspend fun register(anlage: Kontoanlage): Ergebnis<Registrierung>

    suspend fun forgotPassword(email: String): Ergebnis<String?>

    suspend fun getProfil(): Ergebnis<ProfilAnsicht>

    suspend fun zweiterFaktorStand(): Ergebnis<ZweiterFaktorStand>

    suspend fun zweiterFaktorEinrichten(passwort: String): Ergebnis<ZweiterFaktorEinrichtung>

    suspend fun zweiterFaktorBestaetigen(code: String): Ergebnis<List<String>>

    suspend fun zweiterFaktorAbschalten(passwort: String, code: String): Ergebnis<Unit>

    suspend fun zweiterFaktorNeueCodes(code: String): Ergebnis<List<String>>

    suspend fun updateProfil(aenderung: Profilaenderung): Ergebnis<ProfilGespeichert>

    suspend fun changePassword(aktuell: String, neu: String, code: String? = null): Ergebnis<Unit>

    suspend fun getTokens(): Ergebnis<List<GeraetAnsicht>>

    /** Wie viele Token entwertet wurden; 0, wenn er schon weg war. */
    suspend fun revokeToken(tokenId: String, bestaetigung: Bestaetigung): Ergebnis<Int>

    /** Wie viele Zugänge beendet wurden. */
    suspend fun andereBeenden(bestaetigung: Bestaetigung): Ergebnis<Int>

    suspend fun tokenRotieren(alterToken: String): Ergebnis<GetauschterToken>

    suspend fun abmeldenAmServer(grenzeMs: Long = 3_000): Boolean

    suspend fun entwertenAmServer(grenzeMs: Long = 3_000): Entwertungsergebnis

    suspend fun getSettings(): Ergebnis<Kontoeinstellungen>

    suspend fun getAppTheme(): Ergebnis<Designstand>

    suspend fun setzeEigenesDesign(theme: Design?): Ergebnis<Designstand>

    suspend fun updateSettings(currency: Waehrung, condition: Zustand): Ergebnis<Unit>

    suspend fun getDefaultCondition(): Ergebnis<Zustand>

    /** null: zurück auf die Vorgabe des Servers. */
    suspend fun setUserDefaultCondition(condition: Zustand?): Ergebnis<Unit>
}
