package ch.brickinventoryapp.ui.viewmodel

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.ui.UpdateUiState
import ch.brickinventoryapp.util.UPDATE_JSON_MAX_BYTES
import ch.brickinventoryapp.util.UPDATE_MAX_BYTES
import ch.brickinventoryapp.util.UPDATE_VERSION_URL
import ch.brickinventoryapp.util.UpdateBeschreibung
import ch.brickinventoryapp.util.darfInstallieren
import ch.brickinventoryapp.util.installationsAbsicht
import ch.brickinventoryapp.util.istErlaubteApkAdresse
import ch.brickinventoryapp.util.istNeuer
import ch.brickinventoryapp.util.signaturPasst
import ch.brickinventoryapp.util.updateDatei
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import javax.inject.Inject
import javax.inject.Named

/**
 * Selbstaktualisierung: nachsehen, laden, installieren lassen. Beim Start still
 * prüfen, nie von allein laden, dazu ein Knopf in den Einstellungen. Die stille
 * Prüfung meldet keinen Fehler: Wer ohne Netz startet, hat nichts gefragt; wer den
 * Knopf drückt, schon.
 *
 * An die Activity gebunden (aktivitaetsViewModel), damit Startprüfung, Dialog,
 * Punkt am Kontosymbol und Einstellungen dieselbe Instanz sehen. Der eigene
 * HTTP-Client kennt weder Server noch Token — nichts davon geht GitHub etwas an.
 */
@HiltViewModel
class UpdateViewModel @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
    @param:Named("update") private val updateHttpClient: OkHttpClient,
    private val texte: Texte,
    prefs: PreferencesManager,
) : ViewModel() {

    private val _state = MutableStateFlow(UpdateUiState())
    val updateState = _state.asStateFlow()

    init {
        // Beim Abmelden zuruecksetzen: Ein Fortschritt oder „bereit zur
        // Installation" erschiene dem naechsten Nutzer sonst als sein Vorgang.
        viewModelScope.launch {
            prefs.authTokenState.map { it.isNullOrBlank() }.distinctUntilChanged().drop(1)
                .filter { abgemeldet -> abgemeldet }
                .collect { _state.value = UpdateUiState() }
        }
    }

    /**
     * Gibt es eine neuere Fassung?
     *
     * @param still Beim Start `true`: kein Ladebalken, keine Fehlermeldung. Auf
     *        Knopfdruck `false` — dann sieht der Nutzer beides.
     */
    fun pruefeAufUpdate(still: Boolean = false) {
        viewModelScope.launch {
            _state.update { it.copy(laedtPruefung = !still, fehler = null) }
            try {
                val roh = withContext(Dispatchers.IO) {
                    updateHttpClient.newCall(Request.Builder().url(UPDATE_VERSION_URL).build())
                        .execute().use { antwort ->
                            if (!antwort.isSuccessful) throw java.io.IOException("HTTP ${antwort.code}")
                            // peekBody statt body.string(): liest HOECHSTENS so viele
                            // Bytes. Ohne die Grenze koennte eine manipulierte
                            // Antwort die App umbringen, ohne je ein APK anfassen zu
                            // muessen — version.json traegt fuenf Felder.
                            antwort.peekBody(UPDATE_JSON_MAX_BYTES).string()
                        }
                }
                val beschreibung = updateJson.decodeFromString<UpdateBeschreibung>(roh)
                // Die Adresse aus einer heruntergeladenen Datei wird geprueft, nicht
                // geglaubt — siehe istErlaubteApkAdresse.
                if (!istErlaubteApkAdresse(beschreibung.apkUrl)) {
                    _state.update {
                        it.copy(laedtPruefung = false, geprueft = true, neuereFassung = null,
                            fehler = if (still) null else texte.text(R.string.update_fremde_adresse))
                    }
                    return@launch
                }
                val neuer = istNeuer(ch.brickinventoryapp.BuildConfig.VERSION_CODE, beschreibung.versionCode)
                _state.update {
                    it.copy(laedtPruefung = false, geprueft = true,
                        neuereFassung = if (neuer) beschreibung else null, fehler = null)
                }
            } catch (e: Exception) {
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
    fun updateHinweisSchliessen() {
        _state.update { it.copy(dialogAbgelehnt = true) }
    }

    /**
     * Lädt das APK und bietet es zur Installation an. Drei Bedingungen, bevor etwas
     * installiert wird: 1. Die Adresse zeigt in unsere Release-Ablage (schon in der
     * Prüfung, hier nochmal — zwischen Prüfung und Klick kann ein neuer Zustand
     * stehen). 2. Die Signatur stimmt mit der installierten App überein. 3. Der Nutzer
     * hat die Systemerlaubnis erteilt.
     *
     * Erst danach öffnet sich der System-Installer, und auch der fragt nochmal.
     */
    fun ladeUpdate() {
        val fassung = _state.value.neuereFassung ?: return
        viewModelScope.launch {
            if (!istErlaubteApkAdresse(fassung.apkUrl)) {
                _state.update { it.copy(fehler = texte.text(R.string.update_fremde_adresse)) }
                return@launch
            }
            _state.update { it.copy(fortschritt = 0, fehler = null, bereitZurInstallation = false) }
            val ziel = updateDatei(ctx)
            try {
                withContext(Dispatchers.IO) {
                    updateHttpClient.newCall(Request.Builder().url(fassung.apkUrl).build())
                        .execute().use { antwort ->
                            if (!antwort.isSuccessful) throw java.io.IOException("HTTP ${antwort.code}")
                            // Kein `?:` mehr: `antwort.body` ist seit OkHttp 5
                            // nicht nullbar, der Elvis-Operator gab darum immer
                            // den linken Teil zurueck und die Ausnahme rechts war
                            // unerreichbar.
                            val koerper = antwort.body
                            // Die Gesamtgrösse kommt bevorzugt aus version.json: Ein Release-Anhang
                            // kommt über eine Umleitung, und contentLength ist dabei gelegentlich
                            // -1 — ohne Bezugsgrösse gäbe es keinen Fortschritt, nur einen
                            // wachsenden Zähler.
                            val gesamt = if (fassung.apkSize > 0) fassung.apkSize
                            else koerper.contentLength()
                            // ── Wieviel darf höchstens kommen? ──
                            //
                            // Die angekündigte Grösse (plus ein Megabyte Luft) oder die feste
                            // Obergrenze — was kleiner ist. Die Ankündigung stammt aus
                            // version.json, der hier nicht blind vertraut wird; die feste Grenze
                            // allein liesse eine Antwort durch, die 46 MB verspricht und 300
                            // liefert.
                            val obergrenze =
                                if (gesamt in 1..UPDATE_MAX_BYTES) minOf(gesamt + 1024 * 1024, UPDATE_MAX_BYTES)
                                else UPDATE_MAX_BYTES
                            koerper.byteStream().use { ein ->
                                ziel.outputStream().use { aus ->
                                    val puffer = ByteArray(64 * 1024)
                                    var geladen = 0L
                                    var zuletzt = -1
                                    while (true) {
                                        val n = ein.read(puffer)
                                        if (n < 0) break
                                        geladen += n
                                        // Abbrechen, BEVOR geschrieben wird: Sonst
                                        // liegt das Zuviel schon auf der Platte.
                                        if (geladen > obergrenze)
                                            throw java.io.IOException(
                                                "Update groesser als erlaubt ($geladen > $obergrenze)")
                                        aus.write(puffer, 0, n)
                                        if (gesamt > 0) {
                                            val p = ((geladen * 100) / gesamt).toInt().coerceIn(0, 100)
                                            // Nur bei Aenderung melden: sonst
                                            // schriebe jede 64-KB-Portion in den
                                            // Zustand und loeste eine
                                            // Rekomposition aus.
                                            if (p != zuletzt) {
                                                zuletzt = p
                                                _state.update { it.copy(fortschritt = p) }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                }
                // Die Signatur wird geprueft, BEVOR der Nutzer gefragt wird —
                // siehe util/AppUpdate.kt. Passt sie nicht, wird die Datei
                // geloescht: Ein APK unbekannter Herkunft soll nicht liegenbleiben.
                if (!withContext(Dispatchers.IO) { signaturPasst(ctx, ziel) }) {
                    ziel.delete()
                    _state.update {
                        it.copy(fortschritt = null, fehler = texte.text(R.string.update_signatur_falsch))
                    }
                    return@launch
                }
                if (!darfInstallieren(ctx)) {
                    _state.update {
                        it.copy(fortschritt = null, bereitZurInstallation = true, erlaubnisFehlt = true)
                    }
                    return@launch
                }
                _state.update {
                    it.copy(fortschritt = null, bereitZurInstallation = true, erlaubnisFehlt = false)
                }
                starteInstallation()
            } catch (e: Exception) {
                ziel.delete()
                _state.update {
                    it.copy(fortschritt = null, fehler = texte.text(R.string.update_laden_fehlgeschlagen))
                }
            }
        }
    }

    /**
     * Öffnet den System-Installer für das geladene APK. Zwei Aufrufer: das Ende von
     * [ladeUpdate] und der Knopf „Installieren“ nach nachträglich erteilter Erlaubnis.
     * Die Signatur wird erneut geprüft, weil die Datei während des Ausflugs in die
     * Systemeinstellungen auf der Platte liegt.
     */
    fun starteInstallation() {
        val datei = updateDatei(ctx)
        if (!datei.isFile || !signaturPasst(ctx, datei)) {
            datei.delete()
            _state.update {
                it.copy(bereitZurInstallation = false, fehler = texte.text(R.string.update_signatur_falsch))
            }
            return
        }
        if (!darfInstallieren(ctx)) {
            _state.update { it.copy(erlaubnisFehlt = true) }
            return
        }
        runCatching { ctx.startActivity(installationsAbsicht(ctx, datei)) }
            .onFailure {
                _state.update { s -> s.copy(fehler = texte.text(R.string.update_installer_fehlt)) }
            }
    }
}

private val updateJson = Json { ignoreUnknownKeys = true }
