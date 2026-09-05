package ch.brickinventoryapp.ui

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.util.UPDATE_VERSION_URL
import ch.brickinventoryapp.util.UpdateBeschreibung
import ch.brickinventoryapp.util.darfInstallieren
import ch.brickinventoryapp.util.installationsAbsicht
import ch.brickinventoryapp.util.istErlaubteApkAdresse
import ch.brickinventoryapp.util.istNeuer
import ch.brickinventoryapp.util.signaturPasst
import ch.brickinventoryapp.util.updateDatei
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.Request

/**
 * Selbstaktualisierung: nachsehen, laden, installieren lassen.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 * Beim Start still PRUEFEN, nie von allein LADEN — und zusaetzlich ein Knopf
 * in den Einstellungen. Beides steht hier: [pruefeAufUpdate] fragt nur nach,
 * [ladeUpdate] laedt erst auf Zuruf.
 *
 * ── Warum der Fehler beim Start NICHT gemeldet wird ─────────────────────────
 * Eine stille Pruefung, die bei jedem Start ohne Netz eine rote Meldung
 * hinterlaesst, waere keine stille Pruefung. Wer den Knopf DRUECKT, hat
 * dagegen eine Frage gestellt und verdient eine Antwort — auch eine
 * schlechte. Darum der Parameter `still`.
 *
 * Feature-Modul des MainViewModel — siehe die uebrigen *Feature.kt.
 */

private val updateJson = Json { ignoreUnknownKeys = true }

/**
 * Gibt es eine neuere Fassung?
 *
 * @param still Beim Start `true`: kein Ladebalken, keine Fehlermeldung. Auf
 *        Knopfdruck `false` — dann sieht der Nutzer beides.
 */
internal fun MainViewModel.pruefeAufUpdate(still: Boolean = false) {
    viewModelScope.launch {
        _updateState.update { it.copy(laedtPruefung = !still, fehler = null) }
        try {
            val roh = withContext(Dispatchers.IO) {
                updateHttpClient.newCall(Request.Builder().url(UPDATE_VERSION_URL).build())
                    .execute().use { antwort ->
                        if (!antwort.isSuccessful) throw java.io.IOException("HTTP ${antwort.code}")
                        antwort.body?.string() ?: throw java.io.IOException("leere Antwort")
                    }
            }
            val beschreibung = updateJson.decodeFromString<UpdateBeschreibung>(roh)
            // Die Adresse aus einer heruntergeladenen Datei wird geprueft, nicht
            // geglaubt — siehe istErlaubteApkAdresse.
            if (!istErlaubteApkAdresse(beschreibung.apkUrl)) {
                _updateState.update {
                    it.copy(laedtPruefung = false, geprueft = true, neuereFassung = null,
                        fehler = if (still) null else text(R.string.update_fremde_adresse))
                }
                return@launch
            }
            val neuer = istNeuer(ch.brickinventoryapp.BuildConfig.VERSION_CODE, beschreibung.versionCode)
            _updateState.update {
                it.copy(laedtPruefung = false, geprueft = true,
                    neuereFassung = if (neuer) beschreibung else null, fehler = null)
            }
        } catch (e: Exception) {
            _updateState.update {
                it.copy(laedtPruefung = false, geprueft = true,
                    fehler = if (still) null else text(R.string.update_pruefung_fehlgeschlagen))
            }
        }
    }
}

/**
 * Laedt das APK und bietet es zur Installation an.
 *
 * ── Drei Bedingungen, bevor irgendetwas installiert wird ────────────────────
 *  1. Die Adresse zeigt in unsere Release-Ablage (schon in der Pruefung, hier
 *     nochmal — zwischen Pruefung und Klick kann ein neuer Zustand stehen).
 *  2. Die Signatur stimmt mit der installierten App ueberein.
 *  3. Der Nutzer hat die Systemerlaubnis erteilt.
 *
 * Erst danach oeffnet sich der System-Installer, und auch der fragt nochmal.
 */
internal fun MainViewModel.ladeUpdate() {
    val fassung = _updateState.value.neuereFassung ?: return
    viewModelScope.launch {
        if (!istErlaubteApkAdresse(fassung.apkUrl)) {
            _updateState.update { it.copy(fehler = text(R.string.update_fremde_adresse)) }
            return@launch
        }
        _updateState.update { it.copy(fortschritt = 0, fehler = null, bereitZurInstallation = false) }
        val ziel = updateDatei(ctx)
        try {
            withContext(Dispatchers.IO) {
                updateHttpClient.newCall(Request.Builder().url(fassung.apkUrl).build())
                    .execute().use { antwort ->
                        if (!antwort.isSuccessful) throw java.io.IOException("HTTP ${antwort.code}")
                        val koerper = antwort.body ?: throw java.io.IOException("leere Antwort")
                        // Die Gesamtgroesse kommt bevorzugt aus version.json:
                        // Ein Release-Anhang wird ueber eine Umleitung
                        // ausgeliefert, und contentLength ist dabei
                        // gelegentlich -1. Ohne Bezugsgroesse gaebe es keinen
                        // Fortschritt, sondern nur einen wachsenden Zaehler.
                        val gesamt = if (fassung.apkSize > 0) fassung.apkSize
                        else koerper.contentLength()
                        koerper.byteStream().use { ein ->
                            ziel.outputStream().use { aus ->
                                val puffer = ByteArray(64 * 1024)
                                var geladen = 0L
                                var zuletzt = -1
                                while (true) {
                                    val n = ein.read(puffer)
                                    if (n < 0) break
                                    aus.write(puffer, 0, n)
                                    geladen += n
                                    if (gesamt > 0) {
                                        val p = ((geladen * 100) / gesamt).toInt().coerceIn(0, 100)
                                        // Nur bei Aenderung melden: sonst
                                        // schriebe jede 64-KB-Portion in den
                                        // Zustand und loeste eine
                                        // Rekomposition aus.
                                        if (p != zuletzt) {
                                            zuletzt = p
                                            _updateState.update { it.copy(fortschritt = p) }
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
                _updateState.update {
                    it.copy(fortschritt = null, fehler = text(R.string.update_signatur_falsch))
                }
                return@launch
            }
            if (!darfInstallieren(ctx)) {
                _updateState.update {
                    it.copy(fortschritt = null, bereitZurInstallation = true, erlaubnisFehlt = true)
                }
                return@launch
            }
            _updateState.update {
                it.copy(fortschritt = null, bereitZurInstallation = true, erlaubnisFehlt = false)
            }
            starteInstallation()
        } catch (e: Exception) {
            ziel.delete()
            _updateState.update {
                it.copy(fortschritt = null, fehler = text(R.string.update_laden_fehlgeschlagen))
            }
        }
    }
}

/**
 * Oeffnet den System-Installer fuer das bereits geladene APK.
 *
 * Eigene Funktion, weil sie ZWEI Aufrufer hat: das Ende von [ladeUpdate] und
 * der Knopf „Installieren", wenn der Nutzer die Erlaubnis nachtraeglich
 * erteilt hat. Die Signatur wird dabei erneut geprueft — zwischen Download
 * und zweitem Anlauf liegt ein Ausflug in die Systemeinstellungen, und die
 * Datei liegt so lange auf der Platte.
 */
internal fun MainViewModel.starteInstallation() {
    val datei = updateDatei(ctx)
    if (!datei.isFile || !signaturPasst(ctx, datei)) {
        datei.delete()
        _updateState.update {
            it.copy(bereitZurInstallation = false, fehler = text(R.string.update_signatur_falsch))
        }
        return
    }
    if (!darfInstallieren(ctx)) {
        _updateState.update { it.copy(erlaubnisFehlt = true) }
        return
    }
    runCatching { ctx.startActivity(installationsAbsicht(ctx, datei)) }
        .onFailure {
            _updateState.update { s -> s.copy(fehler = text(R.string.update_installer_fehlt)) }
        }
}
