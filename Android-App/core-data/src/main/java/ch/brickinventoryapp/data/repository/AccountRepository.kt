package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.data.Entwertungsergebnis
import ch.brickinventoryapp.data.SwappedToken
import ch.brickinventoryapp.model.domain.TOKEN_SCOPE_APP
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
import kotlinx.serialization.json.JsonObject

/**
 * Das eigene Konto: Anmeldung, Profil, Einstellungen, zweiter Faktor, Token.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (KontoRepositoryImpl).
 */
interface AccountRepository {
    suspend fun login(serverUrl: String, username: String, password: String, code: String? = null,
                      scope: String = TOKEN_SCOPE_APP, passkey: JsonObject? = null): Ergebnis<Anmeldeantwort>

    suspend fun passkeyOptions(zweck: String): Ergebnis<JsonObject>

    suspend fun signInPasskey(serverUrl: String, antwort: JsonObject, scope: String = TOKEN_SCOPE_APP): Ergebnis<Anmeldung>

    suspend fun qrLogin(token: String, label: String): Ergebnis<QrPairing>
    /** [vorschau]: nach der Bestätigung im Browser nur das Konto, noch kein Token. */
    suspend fun pickUpQr(abholung: String, vorschau: Boolean = false): Ergebnis<QrAbholstand>
    /** Das Nein nach der Vorschau: Die Kopplung ist danach abgelehnt. */
    suspend fun discardQr(abholung: String): Ergebnis<Unit>

    suspend fun getMe(): Ergebnis<AccountOwner?>

    suspend fun getRegistrationStatus(): Ergebnis<Registrierungsstand>

    suspend fun register(anlage: Kontoanlage): Ergebnis<Registrierung>

    suspend fun forgotPassword(email: String): Ergebnis<String?>

    suspend fun getProfile(): Ergebnis<ProfileView>

    suspend fun secondFactorStatus(): Ergebnis<ZweiterFaktorStand>

    suspend fun setUpSecondFactor(passwort: String): Ergebnis<ZweiterFaktorEinrichtung>

    suspend fun zweiterFaktorBestaetigen(code: String): Ergebnis<List<String>>

    suspend fun disableSecondFactor(passwort: String, code: String): Ergebnis<Unit>

    suspend fun secondFactorNewCodes(code: String): Ergebnis<List<String>>

    suspend fun updateProfile(aenderung: Profilaenderung): Ergebnis<ProfilGespeichert>

    suspend fun changePassword(aktuell: String, neu: String, code: String? = null): Ergebnis<Unit>

    suspend fun getTokens(): Ergebnis<List<DeviceView>>

    /** Wie viele Token entwertet wurden; 0, wenn er schon weg war. */
    suspend fun revokeToken(tokenId: String, confirmation: Confirmation): Ergebnis<Int>

    /** Wie viele Zugänge beendet wurden. */
    suspend fun endOther(confirmation: Confirmation): Ergebnis<Int>

    suspend fun rotateToken(alterToken: String): Ergebnis<SwappedToken>

    suspend fun signOutAtServer(limitMs: Long = 3_000): Boolean

    suspend fun redeemAtServer(limitMs: Long = 3_000): Entwertungsergebnis

    suspend fun getSettings(): Ergebnis<AccountSettings>

    suspend fun getAppTheme(): Ergebnis<Designstand>

    suspend fun setOwnDesign(theme: Design?): Ergebnis<Designstand>

    suspend fun updateSettings(currency: Waehrung, condition: Zustand): Ergebnis<Unit>

    suspend fun getDefaultCondition(): Ergebnis<Zustand>

    /** null: zurück auf die Vorgabe des Servers. */
    suspend fun setUserDefaultCondition(condition: Zustand?): Ergebnis<Unit>
}
