package ch.brickinventoryapp.finances.ui.viewmodel

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.state.ui.errorMessage
import ch.brickinventoryapp.state.ui.loadError
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.domain.Fehlercode
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.model.domain.Gutscheinspeicherung
import ch.brickinventoryapp.model.domain.PlaintextView
import ch.brickinventoryapp.model.domain.VoucherView
import ch.brickinventoryapp.model.domain.Confirmation
import ch.brickinventoryapp.model.domain.Gutscheinangabe
import ch.brickinventoryapp.data.repository.VouchersRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.finances.ui.BalanceRun
import ch.brickinventoryapp.finances.ui.VoucherConfirmation
import ch.brickinventoryapp.finances.ui.VoucherPdfTarget
import ch.brickinventoryapp.finances.ui.VoucherStep
import ch.brickinventoryapp.finances.ui.CopyJob
import ch.brickinventoryapp.finances.ui.GutscheinUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.Gelesen
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.state.ui.viewmodel.Texte
import ch.brickinventoryapp.state.ui.viewmodel.observeLoadOn

/**
 * Gutscheine im eigenen Profil. Das PDF liest und die Werte prüft der Server, einmal
 * für beide Apps; hier wird nur angezeigt. Ans Ziel gebunden: Eine Guthabenabfrage
 * über alle Karten endet mit der Seite, jede fertige Karte hat der Server gespeichert.
 */
@HiltViewModel
class GutscheinViewModel @Inject constructor(
    private val repo: VouchersRepository,
    private val texts: Texte,
    private val reader: FileReader,
    private val meldungen: MeldungsKanal,
) : ViewModel() {

    private val _state = MutableStateFlow(GutscheinUiState())
    val state = _state.asStateFlow()

    private var balanceJob: Job? = null

    init {
        observeLoadOn(_state) { loadVouchers() }
    }

    fun loadVouchers() {
        viewModelScope.launch { lade() }
    }

    private suspend fun lade() {
        _state.update { it.copy(abruf = Laden.Loads) }
        when (val r = repo.liste()) {
            is Ergebnis.Erfolg -> _state.update { it.copy(gutscheine = r.data, abruf = Laden.Daten(Unit)) }
            is Ergebnis.Fehler -> {
                _state.update { it.copy(abruf = loadError(r)) }
                meldungen.zeige(texts.meldungFuerSnackbar(r))
            }
        }
    }

    fun setVoucherField(
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
    fun switchVoucherPin(id: Int) {
        if (id in _state.value.pinSichtbar) _state.update { it.copy(pinSichtbar = it.pinSichtbar - id) }
        else require(VoucherStep.PIN_ZEIGEN, id)
    }

    /** Nummer oder PIN in die Zwischenablage; die Oberfläche kopiert und quittiert. */
    fun copyVoucher(id: Int, isNumber: Boolean) =
        require(if (isNumber) VoucherStep.NUMBER_COPY else VoucherStep.PIN_COPY, id)

    fun copyAcknowledge() = _state.update { it.copy(copyTo = null) }

    /**
     * Ein Schritt, der Geld zeigt oder vernichtet. Ist der Klartext dieser Karte
     * schon da, läuft er sofort (die Gerätesperre hat die Oberfläche geprüft); sonst
     * erst nach Passwort und Code über [confirm].
     */
    private fun require(schritt: VoucherStep, id: Int?) {
        val klar = id?.let { _state.value.klartext[it] }
        if (klar != null && schritt in PLAINTEXT_STEPS) return runFrom(schritt, klar)
        _state.update { it.copy(confirmation = VoucherConfirmation(schritt, id)) }
    }

    fun cancelConfirmation() = _state.update { it.copy(confirmation = null) }

    /**
     * Passwort und, wenn der Server ihn verlangt hat, Code an die Route des Schritts.
     * Eine Absage lässt die Rückfrage offen, mit dem Satz des Servers; verlangt er den
     * Code, erscheint das Feld dafür.
     */
    fun confirm(passwort: String, code: String?) {
        val b = _state.value.confirmation ?: return
        if (b.operation.laeuft) return
        _state.update { it.copy(confirmation = b.copy(operation = Vorgang.Laeuft)) }
        val anfrage = Confirmation(passwort = passwort, code = code?.trim()?.ifEmpty { null })
        viewModelScope.launch {
            val fehler = runStepFrom(b, anfrage)
            if (fehler != null) _state.update {
                it.copy(confirmation = it.confirmation?.copy(
                    codeNoetig = it.confirmation.codeNoetig || fehler.code in FACTOR_CODES,
                    // Offline gibt es kein Löschen auf Vorrat: Das Passwort bliebe sonst liegen.
                    operation = Vorgang.Fehlgeschlagen(if (fehler.transient && b.schritt == VoucherStep.DELETE)
                        Meldung.Resource(R.string.vouchers_delete_offline) else errorMessage(fehler))))
            }
        }
    }

    /** Der Schritt der Rückfrage an seiner Route; null heisst erledigt (oder ohne Karte nichts zu tun). */
    private suspend fun runStepFrom(b: VoucherConfirmation, anfrage: Confirmation): Ergebnis.Fehler? =
        when (b.schritt) {
            VoucherStep.PDF, VoucherStep.EXPORT -> when (val r = repo.pdfRelease(b.id, anfrage)) {
                is Ergebnis.Erfolg -> {
                    if (openStill(b)) _state.update { it.copy(confirmation = null, pdfTarget = VoucherPdfTarget(b.id, r.data)) }
                    null
                }
                is Ergebnis.Fehler -> r
            }
            VoucherStep.DELETE -> when (val r = repo.loeschen(b.id ?: return null, anfrage)) {
                is Ergebnis.Erfolg -> {
                    _state.update { it.copy(confirmation = null, klartext = it.klartext - b.id,
                        pinSichtbar = it.pinSichtbar - b.id) }
                    melde(R.string.vouchers_deleted)
                    lade()
                    null
                }
                is Ergebnis.Fehler -> r
            }
            VoucherStep.PIN_ZEIGEN, VoucherStep.NUMBER_COPY, VoucherStep.PIN_COPY ->
                when (val r = repo.klartext(b.id ?: return null, anfrage)) {
                    is Ergebnis.Erfolg -> {
                        // Inzwischen verlassen oder abgebrochen: Der Klartext bleibt nicht liegen.
                        if (openStill(b)) {
                            _state.update { it.copy(confirmation = null, klartext = it.klartext + (b.id to r.data)) }
                            runFrom(b.schritt, r.data)
                        }
                        null
                    }
                    is Ergebnis.Fehler -> r
                }
        }

    private fun openStill(b: VoucherConfirmation) =
        _state.value.confirmation.let { it != null && it.schritt == b.schritt && it.id == b.id }

    private fun runFrom(schritt: VoucherStep, klar: PlaintextView) {
        when (schritt) {
            VoucherStep.PIN_ZEIGEN -> _state.update { it.copy(pinSichtbar = it.pinSichtbar + klar.id) }
            VoucherStep.NUMBER_COPY -> _state.update { it.copy(copyTo = CopyJob(klar.number, true)) }
            VoucherStep.PIN_COPY -> klar.pin?.let { pin -> _state.update { it.copy(copyTo = CopyJob(pin, false)) } }
            VoucherStep.PDF, VoucherStep.EXPORT, VoucherStep.DELETE -> Unit
        }
    }

    /**
     * Klartext weg, PINs wieder verdeckt — wenn die App in den Hintergrund geht. Eine
     * offene Rückfrage bleibt: Den Code holt man aus der Authenticator-App.
     */
    fun forgetPlaintext() = _state.update {
        it.copy(klartext = emptyMap(), pinSichtbar = emptySet(), copyTo = null)
    }

    /** Beim Verlassen der Seite: dazu die offene Rückfrage. */
    fun leaveVouchers() {
        forgetPlaintext()
        cancelConfirmation()
    }

    /**
     * Einen bestehenden Gutschein ins Formular holen; das PDF bleibt, wie es ist.
     * Nummer und PIN kommen als Klartext, wenn er schon geholt ist, sonst als Maske:
     * Der Server nimmt die Maske als „unverändert“.
     */
    fun editVoucher(id: Int) {
        val g = _state.value.gutscheine.find { it.id == id } ?: return
        val klar = _state.value.klartext[id]
        _state.update {
            it.copy(
                edited = g.id,
                nummer = klar?.number ?: g.number,
                pin = klar?.pin ?: g.pin.orEmpty(),
                betrag = amountAsText(g.amount),
                waehrung = g.currency.code,
                pdfName = null,
            )
        }
    }

    fun emptyVoucherForm() {
        _state.update {
            it.copy(edited = null, nummer = "", pin = "", betrag = "",
                    waehrung = "CHF", pdfName = null)
        }
    }

    /**
     * Speichern — ein Weg für Ändern, PDF und manuelle Erfassung.
     *
     * Mit Datei liest der Server daraus, was die Felder nicht hergeben; man
     * kann also ein PDF schicken UND den Betrag selbst eintragen.
     */
    fun saveVoucher(datei: FileRef?) = speichere(datei?.let { d ->
        suspend { (reader.readAtMost(d, VOUCHER_MAX_BYTES) as? Gelesen.Inhalt)?.let { it.typ to it.bytes } }
    })

    /** Die Datei als Lesefunktion — so prüft der Test den PDF-Weg ohne Leser. */
    internal fun speichere(datei: (suspend () -> Pair<String?, ByteArray>?)?) {
        viewModelScope.launch {
            val s = _state.value
            _state.update { it.copy(speichern = Vorgang.Laeuft) }
            try {
                val edited = s.edited
                if (edited != null) {
                    val betrag = Geld.fromText(s.betrag.replace(',', '.'))
                        ?: return@launch melde(R.string.vouchers_amount_invalid)
                    handleResponse(repo.aendern(edited, Gutscheinangabe(
                        nummer = s.nummer.trim(), pin = s.pin.trim().ifEmpty { null },
                        betrag = betrag, waehrung = Waehrung(s.waehrung.trim()))))
                    return@launch
                }

                if (datei != null) {
                    val (readType, bytes) = datei()
                        ?: return@launch melde(R.string.csv_upload_unreadable)
                    val typ = readType ?: "application/pdf"
                    // Der Server nimmt nur PDF; hier abzuweisen spart den Upload.
                    if (typ != "application/pdf") return@launch melde(R.string.vouchers_only_pdf)

                    val r = repo.fromPdf(
                        fileName = s.pdfName ?: "gutschein.pdf", typ = typ, inhalt = bytes,
                        nummer = s.nummer, pin = s.pin, betrag = s.betrag.replace(',', '.'),
                        waehrung = s.waehrung,
                    )
                    val g = (r as? Ergebnis.Erfolg)?.data as? Gutscheinspeicherung.Incomplete
                    if (g != null) {
                        // 422: Was der Server lesen konnte, kommt ins Formular —
                        // der Nutzer ergänzt den Rest und schickt dieselbe Datei.
                        _state.update {
                            it.copy(
                                nummer = it.nummer.ifEmpty { g.nummer.orEmpty() },
                                pin = it.pin.ifEmpty { g.pin.orEmpty() },
                                betrag = it.betrag.ifEmpty { g.betrag?.let(::amountAsText).orEmpty() },
                                waehrung = g.waehrung?.code ?: it.waehrung,
                            )
                        }
                        return@launch melde(R.string.vouchers_pdf_incomplete)
                    }
                    handleResponse(r)
                    return@launch
                }

                val betrag = Geld.fromText(s.betrag.replace(',', '.'))
                    ?: return@launch melde(R.string.vouchers_amount_invalid)
                handleResponse(repo.anlegen(Gutscheinangabe(
                    nummer = s.nummer.trim(), pin = s.pin.trim().ifEmpty { null },
                    betrag = betrag, waehrung = Waehrung(s.waehrung.trim()))))
            } finally {
                _state.update { it.copy(speichern = Vorgang.Fertig) }
            }
        }
    }

    private suspend fun handleResponse(r: Ergebnis<Gutscheinspeicherung>) {
        when (r) {
            is Ergebnis.Erfolg -> {
                val stack = (r.data as? Gutscheinspeicherung.Gespeichert)?.takeIf { it.neu != null }
                // Zwei Mengenformen statt „%1$d angelegt": Lint meldet sonst
                // PluralsCandidate, und der Baum zählt die Lint-Befunde.
                meldungen.zeige(if (stack == null) texts.text(R.string.vouchers_saved)
                else texts.text(R.string.vouchers_import_done,
                    texts.menge(R.plurals.csv_upload_new, stack.neu ?: 0, stack.neu ?: 0),
                    texts.menge(R.plurals.csv_upload_updated, stack.geaendert ?: 0, stack.geaendert ?: 0)))
                emptyVoucherForm()
                lade()
            }
            is Ergebnis.Fehler -> meldungen.zeige(texts.meldungFuerSnackbar(r))
        }
    }

    /**
     * Das Guthaben einer Karte bei LEGO abfragen; der Server speichert es.
     *
     * Keine Wiederholung bei einer Absage: Die Grenze von einer Abfrage je 30
     * Sekunden gilt für alle Benutzer, und der Mensch hat gerade gedrückt.
     */
    fun questionBalanceAb(id: Int) {
        viewModelScope.launch {
            _state.update { it.copy(balanceRunning = id) }
            try {
                when (val r = repo.guthaben(id)) {
                    is Ergebnis.Erfolg -> {
                        val d = r.data
                        val v = d.gutschein
                        if (!d.erfolg || v == null) {
                            meldungen.zeige(d.fehler ?: texts.text(R.string.err_generic))
                            return@launch
                        }
                        val betrag = d.angezeigt ?: fmtMoney(v.amount, v.currency)
                        var satz = texts.text(R.string.vouchers_balance_done, v.number, betrag)
                        // Angehängt statt als zweite Meldung, die die erste überschriebe.
                        if (d.waehrungGeaendert) satz += " " + texts.text(R.string.vouchers_balance_currency, v.currency)
                        meldungen.zeige(satz)
                        lade()
                    }
                    is Ergebnis.Fehler -> meldungen.zeige(texts.meldungFuerSnackbar(r))
                }
            } finally {
                _state.update { it.copy(balanceRunning = null) }
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
    fun questionAllBalanceAb() {
        if (_state.value.balanceRun != null) return
        balanceJob = viewModelScope.launch {
            val onIt = _state.value.gutscheine.filter { !it.pin.isNullOrBlank() }
            if (onIt.isEmpty()) return@launch melde(R.string.vouchers_balance_keine)
            var fertig = 0
            var fehler = 0
            try {
                for (g in onIt) {
                    when (questionBalance(g, fertig + fehler, onIt.size)) {
                        Guthabenabfrage.FERTIG -> fertig++
                        Guthabenabfrage.FEHLER -> fehler++
                        Guthabenabfrage.ABORT -> { fehler++; return@launch }
                    }
                }
            } finally {
                // Läuft auch beim Abbrechen — sonst bliebe der Kreisel stehen.
                // Neu laden in einer eigenen Coroutine: In einer abgebrochenen
                // würde jeder suspendierende Aufruf sofort scheitern.
                _state.update { it.copy(balanceRunning = null, balanceRun = null) }
                loadVouchers()
                meldungen.zeige(texts.text(R.string.vouchers_balance_alle_fertig,
                    fertig.toString(), fehler.toString()))
            }
        }
    }

    /** Eine Karte; meldet der Server „abstand", wird gewartet und neu gefragt. */
    private suspend fun questionBalance(g: VoucherView, bisher: Int, gesamt: Int): Guthabenabfrage {
        repeat(GAP_ATTEMPTS) {
            _state.update {
                it.copy(balanceRunning = g.id, balanceRun = BalanceRun(
                    erledigt = bisher, gesamt = gesamt,
                    nummer = g.number, wartenSek = 0))
            }
            when (val r = repo.guthaben(g.id)) {
                is Ergebnis.Erfolg -> {
                    val d = r.data
                    if (d.erfolg) return Guthabenabfrage.FERTIG
                    if (d.grund == "abstand" && (d.wartenSek ?: 0) > 0) {
                        waitVisible(d.wartenSek ?: 0, g.number)
                    } else {
                        meldungen.zeige(d.fehler ?: texts.text(R.string.err_generic))
                        // Bot-Schutz gilt für alle, die Kontogrenze für dieses Konto:
                        // Weitere Karten liefen in dieselbe Absage.
                        val alle = d.grund == "botschutz" || d.grund == "konto"
                        return if (alle) Guthabenabfrage.ABORT else Guthabenabfrage.FEHLER
                    }
                }
                is Ergebnis.Fehler -> {
                    meldungen.zeige(texts.meldungFuerSnackbar(r))
                    return Guthabenabfrage.FEHLER
                }
            }
        }
        melde(R.string.vouchers_balance_belegt)
        return Guthabenabfrage.FEHLER
    }

    fun cancelBalanceRun() {
        balanceJob?.cancel()
        balanceJob = null
    }

    private suspend fun waitVisible(seconds: Int, nummer: String) {
        for (rest in seconds downTo 1) {
            _state.update { it.copy(balanceRun = it.balanceRun?.copy(wartenSek = rest, nummer = nummer)) }
            delay(1000)
        }
    }

    /**
     * Ohne „Rückgängig“, anders als Sets oder Lagerorte: Der Server verlangt dafür Passwort
     * oder Code und kennt für Gutscheine keinen Papierkorb. Ein vorgemerktes Löschen hielte
     * das Passwort bis zum Ende der Snackbar im Speicher; die Rückfrage ist hier der Schutz.
     */
    fun deleteVoucher(id: Int) = require(VoucherStep.DELETE, id)

    /** Kopiert hat die Oberfläche (die Zwischenablage hängt an der Komposition). */
    fun reportVoucherCopied(isNumber: Boolean) =
        melde(if (isNumber) R.string.vouchers_copied_number else R.string.vouchers_copied_pin)

    /** PDF-Betrachter: erst ein Ticket nach Passwort und Code; der Graph navigiert und quittiert. */
    fun openVoucherPdf(id: Int) = require(VoucherStep.PDF, id)
    fun openVoucherExport() = require(VoucherStep.EXPORT, null)
    fun voucherPdfAcknowledge() = _state.update { it.copy(pdfTarget = null) }

    private fun melde(id: Int) { meldungen.zeige(Meldung.Resource(id)) }

    private enum class Guthabenabfrage { FERTIG, FEHLER, ABORT }
}

/** Schritte, die der Klartext erledigt; PDF und Löschen fragen jedes Mal. */
private val PLAINTEXT_STEPS = setOf(VoucherStep.PIN_ZEIGEN, VoucherStep.NUMBER_COPY, VoucherStep.PIN_COPY)

/** Mit diesen Codes verlangt der Server den zweiten Faktor oder weist ihn ab. */
private val FACTOR_CODES = setOf(Fehlercode.ZWEITER_FAKTOR_NOETIG, Fehlercode.ZWEITER_FAKTOR_FALSCH)

/** Höchstens so oft dieselbe Karte erneut versuchen, wenn die Schranke bremst. */
private const val GAP_ATTEMPTS = 4

/** Ganze Beträge ohne „.0": Der Gutschein lautet auf 400, nicht auf 400.0. */
internal fun amountAsText(betrag: Geld): String = betrag.asBigDecimal().stripTrailingZeros().toPlainString()

/**
 * Eine Eingabe in ein Feld, das die Maske des Servers trägt: Die Maske ist ein
 * Ganzes. Getipptes ersetzt sie, Löschen leert das Feld — „…123“ oder die Ziffern
 * „1234“ aus „…1234“ wären eine neue, falsche Nummer.
 */
internal fun inputViaMask(alt: String, neu: String, isMask: Boolean): String = when {
    !isMask -> neu
    alt in neu -> neu.replace(alt, "")
    // Nur Zeichen weggenommen: gelöscht. Sonst ersetzt (markiert und neu getippt, eingefügt).
    isSubsequence(neu, alt) -> ""
    else -> neu
}

private fun isSubsequence(teil: String, ganz: String): Boolean {
    var i = 0
    for (c in ganz) if (i < teil.length && teil[i] == c) i++
    return i == teil.length
}

/** Ein Gutschein-PDF hat ein, zwei Seiten; grösser liest die App es nicht erst ein. */
internal const val VOUCHER_MAX_BYTES = 20L * 1024 * 1024
