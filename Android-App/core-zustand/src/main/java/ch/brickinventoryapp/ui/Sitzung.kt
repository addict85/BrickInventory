package ch.brickinventoryapp.ui

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton
import ch.brickinventoryapp.data.ZweiterFaktorPflicht
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.ui.model.StartzustandAnsicht

/**
 * Die Sitzung der App: Server, Anmeldung, Einstellungen des Kontos. Geändert wird sie
 * nur über diese benannten Schritte; ein allgemeines „ändere“ liesse jeden Bildschirm
 * beliebige Felder setzen, und niemand wüsste mehr, wer die Währung überschrieb.
 */
interface Sitzung {
    val state: StateFlow<AppUiState>

    /**
     * Zählt die Abmeldungen. Ein Zustand statt eines Ereignisses: Ein Sammler, der
     * gerade nicht lief, verlöre ein Ereignis; einen Zähler liest er beim nächsten Mal.
     */
    val abmeldungen: StateFlow<Long>

    /** Die Anmeldung ist gelungen; das Verwalterrecht gilt bis zur nächsten Antwort von /auth/me. */
    fun angemeldet(admin: Boolean)

    /** Adresse und Token haben sich geändert (SitzungsDienst folgt der Ablage). */
    fun anmeldungGeaendert(serverUrl: String, angemeldet: Boolean)

    /** /auth/me hat das Verwalterrecht genannt. */
    fun verwalterGeaendert(admin: Boolean)

    /** Der Server hat Währung und Bedingung des Kontos gespeichert. */
    fun einstellungenGespeichert(currency: String, priceCondition: String)

    /** Die Einstellungen des Kontos vom Server; die Bedingung ist die aufgelöste (Nutzer → global → „N“). */
    fun einstellungenGeladen(currency: String, priceCondition: String, defaultPriceCondition: String, userDefaultCondition: String?)

    /** Eine Antwort des Servers nennt die Währung des Kontos (etwa die Bewertung). */
    fun waehrungUebernommen(currency: String)

    fun spracheGeaendert(language: String)

    /** Das wirksame Design, z. B. nach einer Wahl im Konto; der SitzungsDienst merkt es sich für den Kaltstart. */
    fun setzeDesign(theme: String)

    /** Startzustand des Servers, solange er nicht bereit ist; null heisst durch oder nicht erreichbar. */
    fun serverstartGeaendert(stand: StartzustandAnsicht?)

    /**
     * Der Server bleibt eingetragen — abgemeldet heisst nicht „anderer Server“.
     * Das Design bleibt, bis die Vorgabe des Servers da ist; sonst blitzte „classic“ auf.
     */
    fun abgemeldet()
}

/** Für Tests und Vorschauen ohne Hilt. */
fun Sitzung(): Sitzung = SitzungsZustand()

/**
 * Ein Singleton und kein Feld eines ViewModels, weil jeder Bildschirm die Sitzung
 * liest, aber jedes Bereichs-ViewModel nur so lange lebt wie sein Ziel.
 */
@Singleton
class SitzungsZustand @Inject constructor() : Sitzung {

    private val _state = MutableStateFlow(AppUiState())
    override val state: StateFlow<AppUiState> = _state.asStateFlow()

    private val _abmeldungen = MutableStateFlow(0L)
    override val abmeldungen: StateFlow<Long> = _abmeldungen.asStateFlow()

    override fun angemeldet(admin: Boolean) = _state.update { it.copy(isLoggedIn = true, isAdmin = admin) }

    override fun anmeldungGeaendert(serverUrl: String, angemeldet: Boolean) =
        _state.update { it.copy(serverUrl = serverUrl, isLoggedIn = angemeldet) }

    override fun verwalterGeaendert(admin: Boolean) = _state.update { it.copy(isAdmin = admin) }

    override fun einstellungenGespeichert(currency: String, priceCondition: String) =
        _state.update { it.copy(currency = currency, priceCondition = priceCondition) }

    override fun einstellungenGeladen(
        currency: String, priceCondition: String, defaultPriceCondition: String, userDefaultCondition: String?,
    ) = _state.update {
        it.copy(currency = currency, priceCondition = priceCondition,
            defaultPriceCondition = defaultPriceCondition, userDefaultCondition = userDefaultCondition)
    }

    override fun waehrungUebernommen(currency: String) = _state.update { it.copy(currency = currency) }

    override fun spracheGeaendert(language: String) = _state.update { it.copy(language = language) }

    override fun setzeDesign(theme: String) = _state.update { it.copy(appTheme = theme) }

    override fun serverstartGeaendert(stand: StartzustandAnsicht?) = _state.update { it.copy(startupStatus = stand) }

    override fun abgemeldet() {
        _state.update { AppUiState(serverUrl = it.serverUrl, appTheme = it.appTheme) }
        _abmeldungen.update { it + 1 }
    }
}

/**
 * Die Einstellungen des Kontos vom Server in die Sitzung. Das Design nicht:
 * /settings nennt in app_theme die Vorgabe des Verwalters, das des Kontos kommt
 * von /settings/theme (SitzungsDienst).
 */
suspend fun Sitzung.ladeEinstellungen(konto: KontoRepository) {
    val r = konto.getSettings()
    if (r is Ergebnis.Success) {
        val e = r.data.settings
        einstellungenGeladen(e.currency, e.priceCondition, e.defaultPriceCondition, e.effectiveCondition)
    }
}

/**
 * Nach einem 403 `nur_admins`: das Verwalterrecht aus /auth/me nachziehen. Nur
 * aus dem Verwalterzustand heraus — wiederholte 403 (eine pollende Seite)
 * lösen so höchstens einen Abruf aus. @return true, wenn das Recht wegfiel
 */
suspend fun Sitzung.rechteNachziehen(konto: KontoRepository): Boolean {
    if (!state.value.isAdmin) return false
    val me = konto.getMe()
    // Ohne Antwort gilt das 403: Der Server hat das Recht eben verneint.
    val verwalter = me is Ergebnis.Success && me.data.user?.isAdmin == true
    verwalterGeaendert(verwalter)
    return !verwalter
}

/**
 * Nach dem Anmelden: Verwalterrecht und Pflicht zum zweiten Faktor aus /auth/me.
 * /me antwortet auch ohne eingerichteten Faktor; so steht die Einrichtungsmaske
 * da, bevor die übrigen Abrufe mit 403 scheitern. Ohne Antwort bleibt alles, wie es ist.
 */
suspend fun Sitzung.kontoUebernehmen(
    konto: KontoRepository,
    faktorPflicht: ZweiterFaktorPflicht,
) {
    val me = konto.getMe()
    if (me !is Ergebnis.Success) return
    val nutzer = me.data.user
    verwalterGeaendert(nutzer?.isAdmin == true)
    if (nutzer?.zweiterFaktorPflicht == true) faktorPflicht.melde()
}

/**
 * Ein gescheiterter QR-Anlauf, während die App schon angemeldet ist, ist kein
 * Fehler: Der Scanner löste doppelt aus, der erste Anlauf hat den einmaligen
 * Token verbraucht und angemeldet. Gibt die Meldung zurück, oder null.
 */
fun qrFehler(bereitsAngemeldet: Boolean, meldung: String): String? =
    if (bereitsAngemeldet) null else meldung
