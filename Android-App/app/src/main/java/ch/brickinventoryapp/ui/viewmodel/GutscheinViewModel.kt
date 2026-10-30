package ch.brickinventoryapp.ui.viewmodel

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.model.GutscheinAntwort
import ch.brickinventoryapp.data.model.GutscheinRequest
import ch.brickinventoryapp.data.repository.GutscheineRepository
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.GuthabenLauf
import ch.brickinventoryapp.ui.GutscheinUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Gutscheine im eigenen Profil. Das PDF liest und die Werte prüft der Server, einmal
 * für beide Apps; hier wird nur angezeigt. An die Activity gebunden, weil die
 * Guthabenabfrage über alle Karten Minuten dauert.
 */
@HiltViewModel
class GutscheinViewModel @Inject constructor(
    private val repo: GutscheineRepository,
    private val texte: Texte,
    private val leser: DateiLeser,
    meldungen: MeldungsKanal,
) : ViewModel() {

    private val _state = MutableStateFlow(GutscheinUiState())
    val state = _state.asStateFlow()

    private val _snackbar = meldungen.fluss
    private var guthabenJob: Job? = null

    fun ladeGutscheine() {
        viewModelScope.launch { lade() }
    }

    private suspend fun lade() {
        _state.update { it.copy(laedt = true, fehler = null) }
        when (val r = repo.liste()) {
            is Result.Success -> _state.update { it.copy(gutscheine = r.data.vouchers, laedt = false) }
            is Result.Error -> {
                _state.update { it.copy(laedt = false, fehler = texte.meldung(r)) }
                _snackbar.value = texte.meldungFuerSnackbar(r)
            }
        }
    }

    fun setzeGutscheinFeld(
        nummer: String? = null, pin: String? = null, betrag: String? = null,
        waehrung: String? = null,
    ) {
        _state.update {
            it.copy(
                nummer = nummer ?: it.nummer,
                pin = pin ?: it.pin,
                betrag = betrag ?: it.betrag,
                waehrung = waehrung ?: it.waehrung,
            )
        }
    }

    fun schalteGutscheinPin(id: Int) {
        _state.update {
            it.copy(pinSichtbar = if (id in it.pinSichtbar) it.pinSichtbar - id else it.pinSichtbar + id)
        }
    }

    /** Einen bestehenden Gutschein ins Formular holen; das PDF bleibt, wie es ist. */
    fun bearbeiteGutschein(id: Int) {
        val g = _state.value.gutscheine.find { it.id == id } ?: return
        _state.update {
            it.copy(
                bearbeitet = g.id,
                nummer = g.number,
                pin = g.pin.orEmpty(),
                betrag = betragAlsText(g.amount),
                waehrung = g.currency,
                pdfName = null,
            )
        }
    }

    fun leereGutscheinFormular() {
        _state.update {
            it.copy(bearbeitet = null, nummer = "", pin = "", betrag = "",
                    waehrung = "CHF", pdfName = null)
        }
    }

    /**
     * Speichern — ein Weg für Ändern, PDF und manuelle Erfassung.
     *
     * Mit Datei liest der Server daraus, was die Felder nicht hergeben; man
     * kann also ein PDF schicken UND den Betrag selbst eintragen.
     */
    fun speichereGutschein(uri: Uri?) = speichere(uri?.let { u -> suspend { leser.lies(u) } })

    /** Die Datei als Lesefunktion — so prüft der Test den PDF-Weg ohne Uri. */
    internal fun speichere(datei: (suspend () -> Pair<String?, ByteArray>?)?) {
        viewModelScope.launch {
            val s = _state.value
            _state.update { it.copy(speichert = true) }
            try {
                val bearbeitet = s.bearbeitet
                if (bearbeitet != null) {
                    val betrag = s.betrag.replace(',', '.').toDoubleOrNull()
                        ?: return@launch melde(R.string.vouchers_amount_invalid)
                    behandleAntwort(repo.aendern(bearbeitet, GutscheinRequest(
                        number = s.nummer.trim(), pin = s.pin.trim().ifEmpty { null },
                        amount = betrag, currency = s.waehrung)))
                    return@launch
                }

                if (datei != null) {
                    val (gelesenerTyp, bytes) = datei()
                        ?: return@launch melde(R.string.csv_upload_unreadable)
                    val typ = gelesenerTyp ?: "application/pdf"
                    // Der Server nimmt nur PDF; hier abzuweisen spart den Upload.
                    if (typ != "application/pdf") return@launch melde(R.string.vouchers_only_pdf)

                    val r = repo.ausPdf(
                        dateiname = s.pdfName ?: "gutschein.pdf", typ = typ, inhalt = bytes,
                        nummer = s.nummer, pin = s.pin, betrag = s.betrag.replace(',', '.'),
                        waehrung = s.waehrung,
                    )
                    if (r is Result.Success && !r.data.success) {
                        // 422: Was der Server lesen konnte, kommt ins Formular —
                        // der Nutzer ergänzt den Rest und schickt dieselbe Datei.
                        val g = r.data.gelesen
                        _state.update {
                            it.copy(
                                nummer = it.nummer.ifEmpty { g?.number.orEmpty() },
                                pin = it.pin.ifEmpty { g?.pin.orEmpty() },
                                betrag = it.betrag.ifEmpty { g?.amount?.let(::betragAlsText).orEmpty() },
                                waehrung = g?.currency ?: it.waehrung,
                            )
                        }
                        return@launch melde(R.string.vouchers_pdf_incomplete)
                    }
                    behandleAntwort(r)
                    return@launch
                }

                val betrag = s.betrag.replace(',', '.').toDoubleOrNull()
                    ?: return@launch melde(R.string.vouchers_amount_invalid)
                behandleAntwort(repo.anlegen(GutscheinRequest(
                    number = s.nummer.trim(), pin = s.pin.trim().ifEmpty { null },
                    amount = betrag, currency = s.waehrung)))
            } finally {
                _state.update { it.copy(speichert = false) }
            }
        }
    }

    private suspend fun behandleAntwort(r: Result<GutscheinAntwort>) {
        when (r) {
            is Result.Success -> {
                if (!r.data.success) {
                    _snackbar.value = r.data.error ?: texte.text(R.string.vouchers_save_error)
                    return
                }
                val stapel = r.data.mehrere
                // Zwei Mengenformen statt „%1$d angelegt": Lint meldet sonst
                // PluralsCandidate, und der Baum zählt die Lint-Befunde.
                _snackbar.value = if (stapel == null) texte.text(R.string.vouchers_saved)
                else texte.text(R.string.vouchers_import_done,
                    texte.menge(R.plurals.csv_upload_new, stapel.added, stapel.added),
                    texte.menge(R.plurals.csv_upload_updated, stapel.updated, stapel.updated))
                leereGutscheinFormular()
                lade()
            }
            is Result.Error -> _snackbar.value = texte.meldungFuerSnackbar(r)
        }
    }

    /**
     * Das Guthaben einer Karte bei LEGO abfragen; der Server speichert es.
     *
     * Keine Wiederholung bei einer Absage: Die Grenze von einer Abfrage je 30
     * Sekunden gilt für alle Benutzer, und der Mensch hat gerade gedrückt.
     */
    fun frageGuthabenAb(id: Int) {
        viewModelScope.launch {
            _state.update { it.copy(guthabenLaeuft = id) }
            try {
                when (val r = repo.guthaben(id)) {
                    is Result.Success -> {
                        val d = r.data
                        val v = d.voucher
                        if (!d.success || v == null) {
                            _snackbar.value = d.error ?: texte.text(R.string.err_generic)
                            return@launch
                        }
                        val betrag = d.angezeigt ?: "%.2f %s".format(v.amount, v.currency)
                        var satz = texte.text(R.string.vouchers_balance_done, v.number, betrag)
                        // Angehängt statt als zweite Meldung, die die erste überschriebe.
                        if (d.waehrungGeaendert) satz += " " + texte.text(R.string.vouchers_balance_currency, v.currency)
                        _snackbar.value = satz
                        lade()
                    }
                    is Result.Error -> _snackbar.value = texte.meldungFuerSnackbar(r)
                }
            } finally {
                _state.update { it.copy(guthabenLaeuft = null) }
            }
        }
    }

    /**
     * Das Guthaben ALLER Karten abfragen, eine nach der anderen.
     *
     * Hier wird gewartet, wenn der Server „abstand" meldet — genau so lange,
     * wie er sagt. Bei Bot-Schutz bricht der ganze Lauf ab: Die übrigen Karten
     * liefen in dieselbe Wand.
     */
    fun frageAlleGuthabenAb() {
        if (_state.value.guthabenLauf != null) return
        guthabenJob = viewModelScope.launch {
            val dran = _state.value.gutscheine.filter { !it.pin.isNullOrBlank() }
            if (dran.isEmpty()) return@launch melde(R.string.vouchers_balance_keine)
            var fertig = 0
            var fehler = 0
            try {
                for (g in dran) {
                    var erledigt = false
                    var versuch = 1
                    while (!erledigt && versuch <= ABSTAND_VERSUCHE) {
                        _state.update {
                            it.copy(guthabenLaeuft = g.id, guthabenLauf = GuthabenLauf(
                                erledigt = fertig + fehler, gesamt = dran.size,
                                nummer = g.number, wartenSek = 0))
                        }
                        when (val r = repo.guthaben(g.id)) {
                            is Result.Success -> {
                                val d = r.data
                                if (d.success) { fertig++; erledigt = true }
                                else if (d.grund == "abstand" && (d.wartenSek ?: 0) > 0) {
                                    warteSichtbar(d.wartenSek ?: 0, g.number)
                                    versuch++
                                } else {
                                    fehler++
                                    erledigt = true
                                    _snackbar.value = d.error ?: texte.text(R.string.err_generic)
                                    if (d.grund == "botschutz") return@launch
                                }
                            }
                            is Result.Error -> {
                                fehler++
                                erledigt = true
                                _snackbar.value = texte.meldungFuerSnackbar(r)
                            }
                        }
                    }
                    if (!erledigt) {
                        fehler++
                        melde(R.string.vouchers_balance_belegt)
                    }
                }
            } finally {
                // Läuft auch beim Abbrechen — sonst bliebe der Kreisel stehen.
                // Neu laden in einer eigenen Coroutine: In einer abgebrochenen
                // würde jeder suspendierende Aufruf sofort scheitern.
                _state.update { it.copy(guthabenLaeuft = null, guthabenLauf = null) }
                ladeGutscheine()
                _snackbar.value = texte.text(R.string.vouchers_balance_alle_fertig,
                    fertig.toString(), fehler.toString())
            }
        }
    }

    fun guthabenLaufAbbrechen() {
        guthabenJob?.cancel()
        guthabenJob = null
    }

    private suspend fun warteSichtbar(sekunden: Int, nummer: String) {
        for (rest in sekunden downTo 1) {
            _state.update { it.copy(guthabenLauf = it.guthabenLauf?.copy(wartenSek = rest, nummer = nummer)) }
            delay(1000)
        }
    }

    fun loescheGutschein(id: Int) {
        viewModelScope.launch {
            when (val r = repo.loeschen(id)) {
                is Result.Success -> { melde(R.string.vouchers_deleted); lade() }
                is Result.Error -> _snackbar.value = texte.meldungFuerSnackbar(r)
            }
        }
    }

    /** Kopiert hat die Oberfläche (die Zwischenablage hängt an der Komposition). */
    fun meldeGutscheinKopiert(istNummer: Boolean) =
        melde(if (istNummer) R.string.vouchers_copied_number else R.string.vouchers_copied_pin)

    /** Ziele für den PDF-Betrachter; der Graph navigiert und quittiert. */
    fun oeffneGutscheinPdf(id: Int) = _state.update { it.copy(pdfZiel = id) }
    fun gutscheinPdfQuittieren() = _state.update { it.copy(pdfZiel = null) }
    fun oeffneGutscheinExport() = _state.update { it.copy(exportZeigen = true) }
    fun gutscheinExportQuittieren() = _state.update { it.copy(exportZeigen = false) }

    private fun melde(id: Int) { _snackbar.value = texte.text(id) }
}

/** Höchstens so oft dieselbe Karte erneut versuchen, wenn die Schranke bremst. */
private const val ABSTAND_VERSUCHE = 4

/** Ganze Beträge ohne „.0": Der Gutschein lautet auf 400, nicht auf 400.0. */
internal fun betragAlsText(betrag: Double): String =
    if (betrag % 1.0 == 0.0) betrag.toLong().toString() else betrag.toString()
