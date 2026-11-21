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
 * Vouchers in one's own profile. The server reads the PDF and checks the values, once
 * for both apps; here it is only displayed. Bound to the destination: a balance query
 * across all cards ends with the page, the server has saved every card that finished.
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

    /** Hiding happens right away; revealing needs the plain text and thus password and code. */
    fun switchVoucherPin(id: Int) {
        if (id in _state.value.pinSichtbar) _state.update { it.copy(pinSichtbar = it.pinSichtbar - id) }
        else require(VoucherStep.PIN_ZEIGEN, id)
    }

    /** Number or PIN onto the clipboard; the UI copies and acknowledges. */
    fun copyVoucher(id: Int, isNumber: Boolean) =
        require(if (isNumber) VoucherStep.NUMBER_COPY else VoucherStep.PIN_COPY, id)

    fun copyAcknowledge() = _state.update { it.copy(copyTo = null) }

    /**
     * A step that shows or destroys money. If this card's plain text is
     * already there, it runs right away (the UI has checked the device lock); otherwise
     * only after a password and code via [confirm].
     */
    private fun require(schritt: VoucherStep, id: Int?) {
        val klar = id?.let { _state.value.klartext[it] }
        if (klar != null && schritt in PLAINTEXT_STEPS) return runFrom(schritt, klar)
        _state.update { it.copy(confirmation = VoucherConfirmation(schritt, id)) }
    }

    fun cancelConfirmation() = _state.update { it.copy(confirmation = null) }

    /**
     * Password and, if the server asked for it, code, to the step's route.
     * A rejection leaves the prompt open, with the server's sentence; if it asks for the
     * code, the field for it appears.
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
                    // Offline there is no deleting on spec: the password would otherwise be left lying around.
                    operation = Vorgang.Fehlgeschlagen(if (fehler.transient && b.schritt == VoucherStep.DELETE)
                        Meldung.Resource(R.string.vouchers_delete_offline) else errorMessage(fehler))))
            }
        }
    }

    /** The prompt's step at its route; null means done (or nothing to do without a card). */
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
                        // Left or cancelled in the meantime: the plain text is not left lying around.
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
     * Plain text gone, PINs hidden again — when the app goes into the background. An
     * open prompt remains: the code is fetched from the authenticator app.
     */
    fun forgetPlaintext() = _state.update {
        it.copy(klartext = emptyMap(), pinSichtbar = emptySet(), copyTo = null)
    }

    /** On leaving the page: the open prompt along with it. */
    fun leaveVouchers() {
        forgetPlaintext()
        cancelConfirmation()
    }

    /**
     * Fetch an existing voucher into the form; the PDF stays as it is.
     * Number and PIN come as plain text if it has already been fetched, otherwise as a mask:
     * the server takes the mask as "unchanged".
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
     * Save — one path for editing, PDF and manual entry.
     *
     * With a file the server reads from it what the fields do not provide; one
     * can therefore send a PDF AND enter the amount by hand.
     */
    fun saveVoucher(datei: FileRef?) = speichere(datei?.let { d ->
        suspend { (reader.readAtMost(d, VOUCHER_MAX_BYTES) as? Gelesen.Inhalt)?.let { it.typ to it.bytes } }
    })

    /** The file as a read function — this way the test checks the PDF path without a reader. */
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
                    // The server only accepts PDF; rejecting it here saves the upload.
                    if (typ != "application/pdf") return@launch melde(R.string.vouchers_only_pdf)

                    val r = repo.fromPdf(
                        fileName = s.pdfName ?: "gutschein.pdf", typ = typ, inhalt = bytes,
                        nummer = s.nummer, pin = s.pin, betrag = s.betrag.replace(',', '.'),
                        waehrung = s.waehrung,
                    )
                    val g = (r as? Ergebnis.Erfolg)?.data as? Gutscheinspeicherung.Incomplete
                    if (g != null) {
                        // 422: what the server could read goes into the form —
                        // the user fills in the rest and sends the same file.
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
                // Two quantity forms instead of "%1$d angelegt": Lint otherwise reports
                // PluralsCandidate, and the tree counts the Lint findings.
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
     * Query a card's balance at LEGO; the server stores it.
     *
     * No retry on a rejection: the limit of one query every 30
     * seconds applies to all users, and the person just pressed the button.
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
                        // Appended instead of as a second message, which would overwrite the first.
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
     * Query the balance of ALL cards, one after another.
     *
     * This waits when the server reports „abstand" — for exactly as long
     * as it says. On bot protection the whole run aborts: the remaining cards
     * would run into the same wall.
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
                // Also runs on cancellation — otherwise the spinner would stay stuck.
                // Reload in its own coroutine: in a cancelled one
                // every suspending call would fail right away.
                _state.update { it.copy(balanceRunning = null, balanceRun = null) }
                loadVouchers()
                meldungen.zeige(texts.text(R.string.vouchers_balance_alle_fertig,
                    fertig.toString(), fehler.toString()))
            }
        }
    }

    /** One card; if the server reports „abstand", it waits and asks again. */
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
                        // Bot protection applies to everyone, the account limit to this account:
                        // further cards would run into the same rejection.
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
     * Without „Rückgängig“, unlike sets or storage locations: the server demands a password
     * or code for it and knows no trash can for vouchers. A pending deletion would hold
     * the password in memory until the snackbar ends; the confirmation prompt is the protection here.
     */
    fun deleteVoucher(id: Int) = require(VoucherStep.DELETE, id)

    /** The UI does the copying (the clipboard is tied to the composition). */
    fun reportVoucherCopied(isNumber: Boolean) =
        melde(if (isNumber) R.string.vouchers_copied_number else R.string.vouchers_copied_pin)

    /** PDF viewer: a ticket only after password and code; the graph navigates and acknowledges. */
    fun openVoucherPdf(id: Int) = require(VoucherStep.PDF, id)
    fun openVoucherExport() = require(VoucherStep.EXPORT, null)
    fun voucherPdfAcknowledge() = _state.update { it.copy(pdfTarget = null) }

    private fun melde(id: Int) { meldungen.zeige(Meldung.Resource(id)) }

    private enum class Guthabenabfrage { FERTIG, FEHLER, ABORT }
}

/** Steps the plain text handles; PDF and delete ask every time. */
private val PLAINTEXT_STEPS = setOf(VoucherStep.PIN_ZEIGEN, VoucherStep.NUMBER_COPY, VoucherStep.PIN_COPY)

/** With these codes the server either demands the second factor or rejects it. */
private val FACTOR_CODES = setOf(Fehlercode.ZWEITER_FAKTOR_NOETIG, Fehlercode.ZWEITER_FAKTOR_FALSCH)

/** Retry the same card at most this many times when the throttle slows things down. */
private const val GAP_ATTEMPTS = 4

/** Whole amounts without ".0": a voucher reads 400, not 400.0. */
internal fun amountAsText(betrag: Geld): String = betrag.asBigDecimal().stripTrailingZeros().toPlainString()

/**
 * An input into a field that carries the server's mask: the mask is a
 * whole. Typing replaces it, deleting empties the field — „…123“ or the digits
 * „1234“ out of „…1234“ would be a new, wrong number.
 */
internal fun inputViaMask(alt: String, neu: String, isMask: Boolean): String = when {
    !isMask -> neu
    alt in neu -> neu.replace(alt, "")
    // Only characters removed: deleted. Otherwise replaced (selected and retyped, pasted).
    isSubsequence(neu, alt) -> ""
    else -> neu
}

private fun isSubsequence(teil: String, ganz: String): Boolean {
    var i = 0
    for (c in ganz) if (i < teil.length && teil[i] == c) i++
    return i == teil.length
}

/** A voucher PDF has one or two pages; above that the app does not even read it in. */
internal const val VOUCHER_MAX_BYTES = 20L * 1024 * 1024
