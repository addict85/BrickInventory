package ch.brickinventoryapp.ui.viewmodel

import ch.brickinventoryapp.util.fangeAusserAbbruch
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.UpdateUiState
import ch.brickinventoryapp.util.UPDATE_JSON_MAX_BYTES
import ch.brickinventoryapp.util.UPDATE_MAX_BYTES
import ch.brickinventoryapp.util.UPDATE_VERSION_URL
import ch.brickinventoryapp.util.gepruefteBeschreibung
import ch.brickinventoryapp.util.pruefsummePasst
import ch.brickinventoryapp.util.fassungPasst
import ch.brickinventoryapp.util.Installationsmeldung
import ch.brickinventoryapp.util.istErlaubteApkAdresse
import ch.brickinventoryapp.util.anzubietendeFassung
import ch.brickinventoryapp.util.pruefeFrische
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import javax.inject.Inject
import javax.inject.Named
import ch.brickinventoryapp.di.BrickDispatchers
import ch.brickinventoryapp.di.Dispatcher
import ch.brickinventoryapp.util.AppFassung
import ch.brickinventoryapp.data.Anmeldestand
import ch.brickinventoryapp.util.UpdateGeraet
import ch.brickinventoryapp.util.UpdateStandAblage
import ch.brickinventoryapp.util.UpdateBeschreibung
import java.io.File
import java.io.IOException

/**
 * Selbstaktualisierung: nachsehen, laden, installieren lassen. Beim Start still
 * prüfen, nie von allein laden, dazu ein Knopf in den Einstellungen. Die stille
 * Prüfung meldet keinen Fehler: Wer ohne Netz startet, hat nichts gefragt; wer den
 * Knopf drückt, schon.
 * Ausführlich: docs/begruendungen/feature-konto/ui/viewmodel/UpdateViewModel.kt.md#constructor
 */
@HiltViewModel
class UpdateViewModel @Inject constructor(
    @param:Named("update") private val updateHttpClient: OkHttpClient,
    private val texte: Texte,
    private val anmeldestand: Anmeldestand,
    private val updateStand: UpdateStandAblage,
    private val geraet: UpdateGeraet,
    private val fassung: AppFassung,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : ViewModel(), UpdateAktionen {

    private val _state = MutableStateFlow(UpdateUiState())
    val updateState = _state.asStateFlow()

    init {
        // Beim Abmelden zuruecksetzen: Ein Fortschritt oder „bereit zur
        // Installation" erschiene dem naechsten Nutzer sonst als sein Vorgang.
        viewModelScope.launch {
            anmeldestand.authTokenState.map { it.isNullOrBlank() }.distinctUntilChanged().drop(1)
                .filter { abgemeldet -> abgemeldet }
                .collect { _state.value = UpdateUiState() }
        }
        // Die Installer-Sitzung antwortet an einen Empfänger, nicht hierher (util/AppUpdate.kt).
        viewModelScope.launch {
            Installationsmeldung.fehler.filter { it != null }.collect { grund ->
                Installationsmeldung.fehler.value = null
                _state.update { it.copy(fehler = texte.text(R.string.update_installation_fehlgeschlagen, grund)) }
            }
        }
    }

    /**
     * Gibt es eine neuere Fassung?
     *
     * @param still Beim Start `true`: kein Ladebalken, keine Fehlermeldung. Auf
     *        Knopfdruck `false` — dann sieht der Nutzer beides.
     */
    override fun pruefeAufUpdate(still: Boolean) {
        viewModelScope.launch {
            _state.update { it.copy(laedtPruefung = !still, fehler = null) }
            fangeAusserAbbruch {
                val roh = withContext(io) {
                    updateHttpClient.newCall(Request.Builder().url(UPDATE_VERSION_URL).build())
                        .execute().use { antwort ->
                            if (!antwort.isSuccessful) throw IOException("HTTP ${antwort.code}")
                            // peekBody statt body.string(): liest HOECHSTENS so viele
                            // Bytes. Ohne die Grenze koennte eine manipulierte
                            // Antwort die App umbringen, ohne je ein APK anfassen zu
                            // muessen — die Beschreibung traegt sechs Felder.
                            antwort.peekBody(UPDATE_JSON_MAX_BYTES).string()
                        }
                }
                // Nur eine signierte Beschreibung zählt: Schreibrecht am Repository allein
                // reicht dann nicht, um ein Update zu unterdrücken oder umzuleiten. Danach
                // wird die Adresse trotzdem geprüft, nicht geglaubt.
                val beschreibung = withContext(io) {
                    gepruefteBeschreibung(roh, geraet.eigeneZertifikate(), geraet.beschreibungsSchluessel())
                }
                if (beschreibung == null || !istErlaubteApkAdresse(beschreibung.apkUrl)) {
                    _state.update {
                        it.copy(laedtPruefung = false, geprueft = true, neuereFassung = null,
                            fehler = if (still) null else texte.text(
                                if (beschreibung == null) R.string.update_beschreibung_unsigniert else R.string.update_fremde_adresse))
                    }
                    return@launch
                }
                // Aus einer zurückgesetzten oder abgelaufenen Beschreibung kein Angebot;
                // die Einstellungen sagen dann, warum (anzubietendeFassung).
                val frische = pruefeFrische(updateStand, beschreibung, fassung.code, System.currentTimeMillis() / 1000)
                _state.update {
                    it.copy(laedtPruefung = false, geprueft = true,
                        neuereFassung = anzubietendeFassung(beschreibung, frische, fassung.code), fehler = null, frische = frische)
                }
            }.onFailure { _ ->
                _state.update {
                    it.copy(laedtPruefung = false, geprueft = true,
                        fehler = if (still) null else texte.text(R.string.update_pruefung_fehlgeschlagen))
                }
            }
        }
    }

    /**
     * „Später“ im Start-Hinweis: für diesen App-Lauf nicht mehr fragen. Der Zustand
     * bleibt — es gibt weiterhin eine neuere Fassung, und der Punkt am Konto-Symbol
     * sagt das weiter. Weggeklickt ist nur die Frage, nicht der Befund.
     */
    override fun updateHinweisSchliessen() {
        _state.update { it.copy(dialogAbgelehnt = true) }
    }

    /**
     * Lädt das APK und bietet es zur Installation an. Drei Bedingungen, bevor etwas
     * installiert wird: 1. Die Adresse zeigt in unsere Release-Ablage (schon in der Prüfung,
     * hier nochmal — zwischen Prüfung und Klick kann ein neuer Zustand stehen). 2. Die
     * Signatur stimmt mit der installierten App überein.
     * Ausführlich: docs/begruendungen/feature-konto/ui/viewmodel/UpdateViewModel.kt.md#ladeupdate
     */
    override fun ladeUpdate() {
        val fassung = _state.value.neuereFassung ?: return
        viewModelScope.launch {
            if (!istErlaubteApkAdresse(fassung.apkUrl)) {
                _state.update { it.copy(fehler = texte.text(R.string.update_fremde_adresse)) }
                return@launch
            }
            _state.update { it.copy(fortschritt = 0, fehler = null, bereitZurInstallation = false) }
            val ziel = geraet.updateDatei()
            fangeAusserAbbruch {
                withContext(io) { ladeApk(fassung, ziel) }
                val falsch = withContext(io) { ungueltigesApk(fassung, ziel) }
                if (falsch != null) {
                    ziel.delete()
                    _state.update { it.copy(fortschritt = null, fehler = texte.text(falsch)) }
                    return@launch
                }
                val erlaubt = geraet.darfInstallieren()
                _state.update { it.copy(fortschritt = null, bereitZurInstallation = true, erlaubnisFehlt = !erlaubt) }
                if (erlaubt) starteInstallation()
            }.onFailure { _ ->
                ziel.delete()
                _state.update {
                    it.copy(fortschritt = null, fehler = texte.text(R.string.update_laden_fehlgeschlagen))
                }
            }
        }
    }

    /**
     * Lädt das APK nach [ziel], höchstens die angekündigte Grösse plus ein Megabyte
     * (oder die feste Obergrenze), und meldet den Fortschritt nur bei Änderung.
     * Ausführlich: docs/begruendungen/feature-konto/ui/viewmodel/UpdateViewModel.kt.md#obergrenze
     */
    private fun ladeApk(beschreibung: UpdateBeschreibung, ziel: File) {
        updateHttpClient.newCall(Request.Builder().url(beschreibung.apkUrl).build()).execute().use { antwort ->
            if (!antwort.isSuccessful) throw IOException("HTTP ${antwort.code}")
            // Bevorzugt aus der Beschreibung: Hinter der Umleitung ist contentLength oft -1.
            val gesamt = if (beschreibung.apkSize > 0) beschreibung.apkSize else antwort.body.contentLength()
            val obergrenze =
                if (gesamt in 1..UPDATE_MAX_BYTES) minOf(gesamt + 1024 * 1024, UPDATE_MAX_BYTES)
                else UPDATE_MAX_BYTES
            antwort.body.byteStream().use { ein ->
                ziel.outputStream().use { aus ->
                    val puffer = ByteArray(64 * 1024)
                    var geladen = 0L
                    var zuletzt = -1
                    while (true) {
                        val n = ein.read(puffer)
                        if (n < 0) break
                        geladen += n
                        // Abbrechen, BEVOR geschrieben wird: Sonst liegt das Zuviel schon auf der Platte.
                        if (geladen > obergrenze) throw IOException("Update groesser als erlaubt ($geladen > $obergrenze)")
                        aus.write(puffer, 0, n)
                        val p = if (gesamt > 0) ((geladen * 100) / gesamt).toInt().coerceIn(0, 100) else zuletzt
                        if (p != zuletzt) {
                            zuletzt = p
                            _state.update { it.copy(fortschritt = p) }
                        }
                    }
                }
            }
        }
    }

    /**
     * Der Text zur ersten Prüfung, die das geladene APK nicht besteht, sonst null. Erst
     * die signierte Prüfsumme (genau dieses APK), dann die Signatur, dann die Fassung —
     * alles, bevor der Nutzer gefragt wird (util/AppUpdate.kt).
     */
    private fun ungueltigesApk(beschreibung: UpdateBeschreibung, ziel: File): Int? = when {
        !pruefsummePasst(ziel, beschreibung.apkSha256) -> R.string.update_pruefsumme_falsch
        !geraet.signaturPasst(ziel) -> R.string.update_signatur_falsch
        !fassungPasst(geraet.apkFassung(ziel), beschreibung.versionCode, fassung.code) -> R.string.update_fassung_falsch
        else -> null
    }

    /**
     * Öffnet den System-Installer für das geladene APK. Zwei Aufrufer: das Ende von
     * [ladeUpdate] und der Knopf „Installieren“ nach nachträglich erteilter Erlaubnis.
     * Die Signatur wird erneut geprüft, weil die Datei während des Ausflugs in die
     * Systemeinstellungen auf der Platte liegt.
     */
    override fun starteInstallation() {
        val gemeldet = _state.value.neuereFassung?.versionCode ?: 0
        val pruefsumme = _state.value.neuereFassung?.apkSha256.orEmpty()
        viewModelScope.launch {
            // Rund 46 MB hashen und zwei APK-Analysen: auf dem Hauptfaden droht ein ANR.
            // Die Reihenfolge bleibt; `&&` bricht beim ersten Fehlschlag ab.
            val geprueft = withContext(io) {
                val datei = geraet.updateDatei()
                val echt = datei.isFile && pruefsummePasst(datei, pruefsumme) && geraet.signaturPasst(datei) &&
                    fassungPasst(geraet.apkFassung(datei), gemeldet, fassung.code)
                if (!echt) datei.delete()
                datei.takeIf { echt }
            }
            if (geprueft == null) {
                _state.update {
                    it.copy(bereitZurInstallation = false, fehler = texte.text(R.string.update_signatur_falsch))
                }
                return@launch
            }
            if (!geraet.darfInstallieren()) {
                _state.update { it.copy(erlaubnisFehlt = true) }
                return@launch
            }
            withContext(io) { runCatching { geraet.installiere(geprueft) } }
                .onFailure {
                    _state.update { s -> s.copy(fehler = texte.text(R.string.update_installer_fehlt)) }
                }
        }
    }
}
