package ch.brickinventoryapp.finanzen.ui.viewmodel

import ch.brickinventoryapp.model.data.model.Fehlercode
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.model.data.model.GutscheinAntwort
import ch.brickinventoryapp.model.ui.model.KlartextAnsicht
import ch.brickinventoryapp.model.ui.model.GutscheinAnsicht
import ch.brickinventoryapp.model.data.model.ZweiterFaktorAnfrage
import ch.brickinventoryapp.model.ui.model.alsAnsicht
import ch.brickinventoryapp.model.data.model.GutscheinRequest
import ch.brickinventoryapp.data.repository.GutscheineRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.finanzen.ui.GuthabenLauf
import ch.brickinventoryapp.finanzen.ui.GutscheinBestaetigung
import ch.brickinventoryapp.finanzen.ui.GutscheinPdfZiel
import ch.brickinventoryapp.finanzen.ui.GutscheinSchritt
import ch.brickinventoryapp.finanzen.ui.Kopierauftrag
import ch.brickinventoryapp.finanzen.ui.GutscheinUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiLeser
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiRef
import ch.brickinventoryapp.zustand.ui.viewmodel.Texte

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
    private val meldungen: MeldungsKanal,
) : ViewModel() {

    private val _state = MutableStateFlow(GutscheinUiState())
    val state = _state.asStateFlow()

    private var guthabenJob: Job? = null

    fun ladeGutscheine() {
        viewModelScope.launch { lade() }
    }

    private suspend fun lade() {
        _state.update { it.copy(laedt = true, fehler = null) }
        when (val r = repo.liste()) {
            is Ergebnis.Success -> _state.update { it.copy(gutscheine = r.data.vouchers.map { v -> v.alsAnsicht() }, laedt = false) }
            is Ergebnis.Error -> {
                _state.update { it.copy(laedt = false, fehler = texte.meldung(r)) }
                meldungen.zeige(texte.meldungFuerSnackbar(r))
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

    /** Verdecken sofort; aufdecken braucht den Klartext und damit Passwort und Code. */
    fun schalteGutscheinPin(id: Int) {
        if (id in _state.value.pinSichtbar) _state.update { it.copy(pinSichtbar = it.pinSichtbar - id) }
        else verlange(GutscheinSchritt.PIN_ZEIGEN, id)
    }

    /** Nummer oder PIN in die Zwischenablage; die Oberfläche kopiert und quittiert. */
    fun kopiereGutschein(id: Int, istNummer: Boolean) =
        verlange(if (istNummer) GutscheinSchritt.NUMMER_KOPIEREN else GutscheinSchritt.PIN_KOPIEREN, id)

    fun kopierenQuittieren() = _state.update { it.copy(zuKopieren = null) }

    /**
     * Ein Schritt, der Geld zeigt oder vernichtet. Ist der Klartext dieser Karte
     * schon da, läuft er sofort (die Gerätesperre hat die Oberfläche geprüft); sonst
     * erst nach Passwort und Code über [bestaetige].
     */
    private fun verlange(schritt: GutscheinSchritt, id: Int?) {
        val klar = id?.let { _state.value.klartext[it] }
        if (klar != null && schritt in KLARTEXT_SCHRITTE) return fuehreAus(schritt, klar)
        _state.update { it.copy(bestaetigung = GutscheinBestaetigung(schritt, id)) }
    }

    fun bestaetigungAbbrechen() = _state.update { it.copy(bestaetigung = null) }

    /**
     * Passwort und, wenn der Server ihn verlangt hat, Code an die Route des Schritts.
     * Eine Absage lässt die Rückfrage offen, mit dem Satz des Servers; verlangt er den
     * Code, erscheint das Feld dafür.
     */
    fun bestaetige(passwort: String, code: String?) {
        val b = _state.value.bestaetigung ?: return
        if (b.laeuft) return
        _state.update { it.copy(bestaetigung = b.copy(laeuft = true, fehler = null)) }
        val anfrage = ZweiterFaktorAnfrage(password = passwort, code = code?.trim()?.ifEmpty { null })
        viewModelScope.launch {
            val fehler = fuehreSchrittAus(b, anfrage)
            if (fehler != null) _state.update {
                it.copy(bestaetigung = it.bestaetigung?.copy(
                    laeuft = false,
                    codeNoetig = it.bestaetigung.codeNoetig || fehler.code in FAKTOR_CODES,
                    // Offline gibt es kein Löschen auf Vorrat: Das Passwort bliebe sonst liegen.
                    fehler = if (fehler.transient && b.schritt == GutscheinSchritt.LOESCHEN)
                        texte.text(R.string.vouchers_delete_offline) else texte.meldung(fehler)))
            }
        }
    }

    /** Der Schritt der Rückfrage an seiner Route; null heisst erledigt (oder ohne Karte nichts zu tun). */
    private suspend fun fuehreSchrittAus(b: GutscheinBestaetigung, anfrage: ZweiterFaktorAnfrage): Ergebnis.Error? =
        when (b.schritt) {
            GutscheinSchritt.PDF, GutscheinSchritt.EXPORT -> when (val r = repo.pdfFreigabe(b.id, anfrage)) {
                is Ergebnis.Success -> {
                    if (nochOffen(b)) _state.update { it.copy(bestaetigung = null, pdfZiel = GutscheinPdfZiel(b.id, r.data.ticket)) }
                    null
                }
                is Ergebnis.Error -> r
            }
            GutscheinSchritt.LOESCHEN -> when (val r = repo.loeschen(b.id ?: return null, anfrage)) {
                is Ergebnis.Success -> {
                    _state.update { it.copy(bestaetigung = null, klartext = it.klartext - b.id,
                        pinSichtbar = it.pinSichtbar - b.id) }
                    melde(R.string.vouchers_deleted)
                    lade()
                    null
                }
                is Ergebnis.Error -> r
            }
            GutscheinSchritt.PIN_ZEIGEN, GutscheinSchritt.NUMMER_KOPIEREN, GutscheinSchritt.PIN_KOPIEREN ->
                when (val r = repo.klartext(b.id ?: return null, anfrage)) {
                    is Ergebnis.Success -> {
                        // Inzwischen verlassen oder abgebrochen: Der Klartext bleibt nicht liegen.
                        if (nochOffen(b)) {
                            _state.update { it.copy(bestaetigung = null, klartext = it.klartext + (b.id to r.data.alsAnsicht())) }
                            fuehreAus(b.schritt, r.data.alsAnsicht())
                        }
                        null
                    }
                    is Ergebnis.Error -> r
                }
        }

    private fun nochOffen(b: GutscheinBestaetigung) =
        _state.value.bestaetigung.let { it != null && it.schritt == b.schritt && it.id == b.id }

    private fun fuehreAus(schritt: GutscheinSchritt, klar: KlartextAnsicht) {
        when (schritt) {
            GutscheinSchritt.PIN_ZEIGEN -> _state.update { it.copy(pinSichtbar = it.pinSichtbar + klar.id) }
            GutscheinSchritt.NUMMER_KOPIEREN -> _state.update { it.copy(zuKopieren = Kopierauftrag(klar.number, true)) }
            GutscheinSchritt.PIN_KOPIEREN -> klar.pin?.let { pin -> _state.update { it.copy(zuKopieren = Kopierauftrag(pin, false)) } }
            GutscheinSchritt.PDF, GutscheinSchritt.EXPORT, GutscheinSchritt.LOESCHEN -> Unit
        }
    }

    /**
     * Klartext weg, PINs wieder verdeckt — wenn die App in den Hintergrund geht. Eine
     * offene Rückfrage bleibt: Den Code holt man aus der Authenticator-App.
     */
    fun vergissKlartext() = _state.update {
        it.copy(klartext = emptyMap(), pinSichtbar = emptySet(), zuKopieren = null)
    }

    /** Beim Verlassen der Seite: dazu die offene Rückfrage. */
    fun verlasseGutscheine() {
        vergissKlartext()
        bestaetigungAbbrechen()
    }

    /**
     * Einen bestehenden Gutschein ins Formular holen; das PDF bleibt, wie es ist.
     * Nummer und PIN kommen als Klartext, wenn er schon geholt ist, sonst als Maske:
     * Der Server nimmt die Maske als „unverändert“.
     */
    fun bearbeiteGutschein(id: Int) {
        val g = _state.value.gutscheine.find { it.id == id } ?: return
        val klar = _state.value.klartext[id]
        _state.update {
            it.copy(
                bearbeitet = g.id,
                nummer = klar?.number ?: g.number,
                pin = klar?.pin ?: g.pin.orEmpty(),
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
    fun speichereGutschein(datei: DateiRef?) = speichere(datei?.let { d -> suspend { leser.lies(d) } })

    /** Die Datei als Lesefunktion — so prüft der Test den PDF-Weg ohne Leser. */
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
                    if (r is Ergebnis.Success && !r.data.success) {
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

    private suspend fun behandleAntwort(r: Ergebnis<GutscheinAntwort>) {
        when (r) {
            is Ergebnis.Success -> {
                if (!r.data.success) {
                    meldungen.zeige(r.data.error ?: texte.text(R.string.vouchers_save_error))
                    return
                }
                val stapel = r.data.mehrere
                // Zwei Mengenformen statt „%1$d angelegt": Lint meldet sonst
                // PluralsCandidate, und der Baum zählt die Lint-Befunde.
                meldungen.zeige(if (stapel == null) texte.text(R.string.vouchers_saved)
                else texte.text(R.string.vouchers_import_done,
                    texte.menge(R.plurals.csv_upload_new, stapel.added, stapel.added),
                    texte.menge(R.plurals.csv_upload_updated, stapel.updated, stapel.updated)))
                leereGutscheinFormular()
                lade()
            }
            is Ergebnis.Error -> meldungen.zeige(texte.meldungFuerSnackbar(r))
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
                    is Ergebnis.Success -> {
                        val d = r.data
                        val v = d.voucher
                        if (!d.success || v == null) {
                            meldungen.zeige(d.error ?: texte.text(R.string.err_generic))
                            return@launch
                        }
                        val betrag = d.angezeigt ?: fmtMoney(v.amount, v.currency)
                        var satz = texte.text(R.string.vouchers_balance_done, v.number, betrag)
                        // Angehängt statt als zweite Meldung, die die erste überschriebe.
                        if (d.waehrungGeaendert) satz += " " + texte.text(R.string.vouchers_balance_currency, v.currency)
                        meldungen.zeige(satz)
                        lade()
                    }
                    is Ergebnis.Error -> meldungen.zeige(texte.meldungFuerSnackbar(r))
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
                    when (frageGuthaben(g, fertig + fehler, dran.size)) {
                        Guthabenabfrage.FERTIG -> fertig++
                        Guthabenabfrage.FEHLER -> fehler++
                        Guthabenabfrage.ABBRUCH -> { fehler++; return@launch }
                    }
                }
            } finally {
                // Läuft auch beim Abbrechen — sonst bliebe der Kreisel stehen.
                // Neu laden in einer eigenen Coroutine: In einer abgebrochenen
                // würde jeder suspendierende Aufruf sofort scheitern.
                _state.update { it.copy(guthabenLaeuft = null, guthabenLauf = null) }
                ladeGutscheine()
                meldungen.zeige(texte.text(R.string.vouchers_balance_alle_fertig,
                    fertig.toString(), fehler.toString()))
            }
        }
    }

    /** Eine Karte; meldet der Server „abstand", wird gewartet und neu gefragt. */
    private suspend fun frageGuthaben(g: GutscheinAnsicht, bisher: Int, gesamt: Int): Guthabenabfrage {
        repeat(ABSTAND_VERSUCHE) {
            _state.update {
                it.copy(guthabenLaeuft = g.id, guthabenLauf = GuthabenLauf(
                    erledigt = bisher, gesamt = gesamt,
                    nummer = g.number, wartenSek = 0))
            }
            when (val r = repo.guthaben(g.id)) {
                is Ergebnis.Success -> {
                    val d = r.data
                    if (d.success) return Guthabenabfrage.FERTIG
                    if (d.grund == "abstand" && (d.wartenSek ?: 0) > 0) {
                        warteSichtbar(d.wartenSek ?: 0, g.number)
                    } else {
                        meldungen.zeige(d.error ?: texte.text(R.string.err_generic))
                        // Bot-Schutz gilt für alle, die Kontogrenze für dieses Konto:
                        // Weitere Karten liefen in dieselbe Absage.
                        val alle = d.grund == "botschutz" || d.grund == "konto"
                        return if (alle) Guthabenabfrage.ABBRUCH else Guthabenabfrage.FEHLER
                    }
                }
                is Ergebnis.Error -> {
                    meldungen.zeige(texte.meldungFuerSnackbar(r))
                    return Guthabenabfrage.FEHLER
                }
            }
        }
        melde(R.string.vouchers_balance_belegt)
        return Guthabenabfrage.FEHLER
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

    fun loescheGutschein(id: Int) = verlange(GutscheinSchritt.LOESCHEN, id)

    /** Kopiert hat die Oberfläche (die Zwischenablage hängt an der Komposition). */
    fun meldeGutscheinKopiert(istNummer: Boolean) =
        melde(if (istNummer) R.string.vouchers_copied_number else R.string.vouchers_copied_pin)

    /** PDF-Betrachter: erst ein Ticket nach Passwort und Code; der Graph navigiert und quittiert. */
    fun oeffneGutscheinPdf(id: Int) = verlange(GutscheinSchritt.PDF, id)
    fun oeffneGutscheinExport() = verlange(GutscheinSchritt.EXPORT, null)
    fun gutscheinPdfQuittieren() = _state.update { it.copy(pdfZiel = null) }

    private fun melde(id: Int) { meldungen.zeige(texte.text(id)) }

    private enum class Guthabenabfrage { FERTIG, FEHLER, ABBRUCH }
}

/** Schritte, die der Klartext erledigt; PDF und Löschen fragen jedes Mal. */
private val KLARTEXT_SCHRITTE = setOf(GutscheinSchritt.PIN_ZEIGEN, GutscheinSchritt.NUMMER_KOPIEREN, GutscheinSchritt.PIN_KOPIEREN)

/** Mit diesen Codes verlangt der Server den zweiten Faktor oder weist ihn ab. */
private val FAKTOR_CODES = setOf(Fehlercode.ZWEITER_FAKTOR_NOETIG, Fehlercode.ZWEITER_FAKTOR_FALSCH)

/** Höchstens so oft dieselbe Karte erneut versuchen, wenn die Schranke bremst. */
private const val ABSTAND_VERSUCHE = 4

/** Ganze Beträge ohne „.0": Der Gutschein lautet auf 400, nicht auf 400.0. */
internal fun betragAlsText(betrag: Double): String =
    if (betrag % 1.0 == 0.0) betrag.toLong().toString() else betrag.toString()

/**
 * Eine Eingabe in ein Feld, das die Maske des Servers trägt: Die Maske ist ein
 * Ganzes. Getipptes ersetzt sie, Löschen leert das Feld — „…123“ oder die Ziffern
 * „1234“ aus „…1234“ wären eine neue, falsche Nummer.
 */
internal fun eingabeUeberMaske(alt: String, neu: String, istMaske: Boolean): String = when {
    !istMaske -> neu
    alt in neu -> neu.replace(alt, "")
    // Nur Zeichen weggenommen: gelöscht. Sonst ersetzt (markiert und neu getippt, eingefügt).
    istTeilfolge(neu, alt) -> ""
    else -> neu
}

private fun istTeilfolge(teil: String, ganz: String): Boolean {
    var i = 0
    for (c in ganz) if (i < teil.length && teil[i] == c) i++
    return i == teil.length
}
