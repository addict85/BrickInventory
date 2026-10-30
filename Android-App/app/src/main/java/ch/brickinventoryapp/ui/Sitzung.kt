package ch.brickinventoryapp.ui

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Die Sitzung der App: Server, Anmeldung, Einstellungen des Kontos.
 *
 * Ein Singleton und kein Feld eines ViewModels, weil jeder Bildschirm sie liest,
 * aber jedes Bereichs-ViewModel nur so lange lebt wie sein Ziel. Geschrieben
 * wird sie vom AppViewModel (aus den Einstellungen) und von der Anmeldung.
 */
@Singleton
class Sitzung @Inject constructor() {

    private val _state = MutableStateFlow(AppUiState())
    val state: StateFlow<AppUiState> = _state.asStateFlow()

    fun aendere(aenderung: (AppUiState) -> AppUiState) = _state.update(aenderung)

    private val _abmeldungen = MutableSharedFlow<Unit>(
        extraBufferCapacity = 1, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    /**
     * Jede Abmeldung einmal. Die Bereichs-ViewModels leeren darauf ihren
     * Zustand: Ein gemerkter Reiter überlebt das Abmelden, und der nächste
     * Nutzer auf demselben Gerät sähe sonst die Daten des vorigen.
     */
    val abmeldungen: SharedFlow<Unit> = _abmeldungen.asSharedFlow()

    /**
     * Der Server bleibt eingetragen — abgemeldet heisst nicht „anderer Server“.
     * Das Design bleibt, bis die Vorgabe des Servers da ist; sonst blitzte „classic“ auf.
     */
    fun abgemeldet() {
        _state.update { AppUiState(serverUrl = it.serverUrl, appTheme = it.appTheme) }
        _abmeldungen.tryEmit(Unit)
    }
}

/**
 * Die Einstellungen des Kontos vom Server in die Sitzung. Die Bedingung für
 * neue Einträge ist die vom Server aufgelöste (Nutzer → global → „N“). Das
 * Design nicht: /settings nennt in app_theme die Vorgabe des Verwalters, das
 * des Kontos kommt von /settings/theme (AppViewModel.loadAppTheme).
 */
internal suspend fun Sitzung.ladeEinstellungen(admin: ch.brickinventoryapp.data.repository.AdminRepository) {
    val r = admin.getSettings()
    if (r is ch.brickinventoryapp.data.repository.Result.Success) {
        val e = r.data.settings
        aendere { it.copy(
            currency = e.currency,
            priceCondition = e.priceCondition,
            defaultPriceCondition = e.defaultPriceCondition,
            userDefaultCondition = e.effectiveCondition,
        ) }
    }
}

/** Das wirksame Design, z. B. nach einer Wahl im Konto; das AppViewModel merkt es sich für den Kaltstart. */
internal fun Sitzung.setzeDesign(theme: String) = aendere { it.copy(appTheme = theme) }

/**
 * Ein gescheiterter QR-Anlauf, während die App schon angemeldet ist, ist kein
 * Fehler: Der Scanner löste doppelt aus, der erste Anlauf hat den einmaligen
 * Token verbraucht und angemeldet. Gibt die Meldung zurück, oder null.
 */
internal fun qrFehler(bereitsAngemeldet: Boolean, meldung: String): String? =
    if (bereitsAngemeldet) null else meldung
