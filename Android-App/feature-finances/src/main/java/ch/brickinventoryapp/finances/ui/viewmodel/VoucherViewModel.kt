package ch.brickinventoryapp.finances.ui.viewmodel

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.MessageChannel
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.repository.VouchersRepository
import ch.brickinventoryapp.finances.ui.BalanceRun
import ch.brickinventoryapp.finances.ui.CopyJob
import ch.brickinventoryapp.finances.ui.VoucherConfirmation
import ch.brickinventoryapp.finances.ui.VoucherPdfTarget
import ch.brickinventoryapp.finances.ui.VoucherStep
import ch.brickinventoryapp.finances.ui.VoucherUiState
import ch.brickinventoryapp.model.domain.Confirmation
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.ErrorCode
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.PlaintextView
import ch.brickinventoryapp.model.domain.VoucherInfo
import ch.brickinventoryapp.model.domain.VoucherStorage
import ch.brickinventoryapp.model.domain.VoucherView
import ch.brickinventoryapp.model.file.FileReader
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.model.file.Read
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.model.ui.Operation
import ch.brickinventoryapp.model.ui.running
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.ui.errorMessage
import ch.brickinventoryapp.state.ui.loadError
import ch.brickinventoryapp.state.ui.viewmodel.Texts
import ch.brickinventoryapp.state.ui.viewmodel.observeLoadOn
import ch.brickinventoryapp.ui.util.fmtMoney
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Vouchers in one's own profile. The server reads the PDF and checks the values, once
 * for both apps; here it is only displayed. Bound to the destination: a balance query
 * across all cards ends with the page, the server has saved every card that finished.
 */
@HiltViewModel
class VoucherViewModel @Inject constructor(
    private val repo: VouchersRepository,
    private val texts: Texts,
    private val reader: FileReader,
    private val messages: MessageChannel,
) : ViewModel() {

    private val _state = MutableStateFlow(VoucherUiState())
    val state = _state.asStateFlow()

    private var balanceJob: Job? = null

    init {
        observeLoadOn(_state) { loadVouchers() }
    }

    fun loadVouchers() {
        viewModelScope.launch { load() }
    }

    private suspend fun load() {
        _state.update { it.copy(fetch = Load.Loads) }
        when (val r = repo.list()) {
            is Outcome.Success -> _state.update { it.copy(vouchers = r.data, fetch = Load.Data(Unit)) }
            is Outcome.Failure -> {
                _state.update { it.copy(fetch = loadError(r)) }
                messages.show(texts.messageForSnackbar(r))
            }
        }
    }

    fun setVoucherField(
        number: String? = null, pin: String? = null, amount: String? = null,
        currency: String? = null,
    ) {
        _state.update {
            it.copy(
                number = number ?: it.number,
                pin = pin ?: it.pin,
                amount = amount ?: it.amount,
                currency = currency ?: it.currency,
            )
        }
    }

    /** Hiding happens right away; revealing needs the plain text and thus password and code. */
    fun switchVoucherPin(id: Int) {
        if (id in _state.value.pinVisible) _state.update { it.copy(pinVisible = it.pinVisible - id) }
        else require(VoucherStep.PIN_SHOW, id)
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
    private fun require(step: VoucherStep, id: Int?) {
        val clear = id?.let { _state.value.plaintext[it] }
        if (clear != null && step in PLAINTEXT_STEPS) return runFrom(step, clear)
        _state.update { it.copy(confirmation = VoucherConfirmation(step, id)) }
    }

    fun cancelConfirmation() = _state.update { it.copy(confirmation = null) }

    /**
     * Password and, if the server asked for it, code, to the step's route.
     * A rejection leaves the prompt open, with the server's sentence; if it asks for the
     * code, the field for it appears.
     */
    fun confirm(password: String, code: String?) {
        val b = _state.value.confirmation ?: return
        if (b.operation.running) return
        _state.update { it.copy(confirmation = b.copy(operation = Operation.Running)) }
        val request = Confirmation(password = password, code = code?.trim()?.ifEmpty { null })
        viewModelScope.launch {
            val error = runStepFrom(b, request)
            if (error != null) _state.update {
                it.copy(confirmation = it.confirmation?.copy(
                    codeNeeded = it.confirmation.codeNeeded || error.code in FACTOR_CODES,
                    // Offline there is no deleting on spec: the password would otherwise be left lying around.
                    operation = Operation.Failed(if (error.transient && b.step == VoucherStep.DELETE)
                        Message.Resource(R.string.vouchers_delete_offline) else errorMessage(error))))
            }
        }
    }

    /** The prompt's step at its route; null means done (or nothing to do without a card). */
    private suspend fun runStepFrom(b: VoucherConfirmation, request: Confirmation): Outcome.Failure? =
        when (b.step) {
            VoucherStep.PDF, VoucherStep.EXPORT -> when (val r = repo.pdfRelease(b.id, request)) {
                is Outcome.Success -> {
                    if (stillOpen(b)) _state.update { it.copy(confirmation = null, pdfTarget = VoucherPdfTarget(b.id, r.data)) }
                    null
                }
                is Outcome.Failure -> r
            }
            VoucherStep.DELETE -> when (val r = repo.deleteVoucher(b.id ?: return null, request)) {
                is Outcome.Success -> {
                    _state.update { it.copy(confirmation = null, plaintext = it.plaintext - b.id,
                        pinVisible = it.pinVisible - b.id) }
                    report(R.string.vouchers_deleted)
                    load()
                    null
                }
                is Outcome.Failure -> r
            }
            VoucherStep.PIN_SHOW, VoucherStep.NUMBER_COPY, VoucherStep.PIN_COPY ->
                when (val r = repo.plaintext(b.id ?: return null, request)) {
                    is Outcome.Success -> {
                        // Left or cancelled in the meantime: the plain text is not left lying around.
                        if (stillOpen(b)) {
                            _state.update { it.copy(confirmation = null, plaintext = it.plaintext + (b.id to r.data)) }
                            runFrom(b.step, r.data)
                        }
                        null
                    }
                    is Outcome.Failure -> r
                }
        }

    private fun stillOpen(b: VoucherConfirmation) =
        _state.value.confirmation.let { it != null && it.step == b.step && it.id == b.id }

    private fun runFrom(step: VoucherStep, clear: PlaintextView) {
        when (step) {
            VoucherStep.PIN_SHOW -> _state.update { it.copy(pinVisible = it.pinVisible + clear.id) }
            VoucherStep.NUMBER_COPY -> _state.update { it.copy(copyTo = CopyJob(clear.number, true)) }
            VoucherStep.PIN_COPY -> clear.pin?.let { pin -> _state.update { it.copy(copyTo = CopyJob(pin, false)) } }
            VoucherStep.PDF, VoucherStep.EXPORT, VoucherStep.DELETE -> Unit
        }
    }

    /**
     * Plain text gone, PINs hidden again — when the app goes into the background. An
     * open prompt remains: the code is fetched from the authenticator app.
     */
    fun forgetPlaintext() = _state.update {
        it.copy(plaintext = emptyMap(), pinVisible = emptySet(), copyTo = null)
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
        val g = _state.value.vouchers.find { it.id == id } ?: return
        val clear = _state.value.plaintext[id]
        _state.update {
            it.copy(
                edited = g.id,
                number = clear?.number ?: g.number,
                pin = clear?.pin ?: g.pin.orEmpty(),
                amount = amountAsText(g.amount),
                currency = g.currency.code,
                pdfName = null,
            )
        }
    }

    fun emptyVoucherForm() {
        _state.update {
            it.copy(edited = null, number = "", pin = "", amount = "",
                    currency = "CHF", pdfName = null)
        }
    }

    /**
     * Save — one path for editing, PDF and manual entry.
     *
     * With a file the server reads from it what the fields do not provide; one
     * can therefore send a PDF AND enter the amount by hand.
     */
    fun saveVoucher(file: FileRef?) = persist(file?.let { d ->
        suspend { (reader.readAtMost(d, VOUCHER_MAX_BYTES) as? Read.Content)?.let { it.type to it.bytes } }
    })

    /** The file as a read function — this way the test checks the PDF path without a reader. */
    internal fun persist(file: (suspend () -> Pair<String?, ByteArray>?)?) {
        viewModelScope.launch {
            val s = _state.value
            _state.update { it.copy(save = Operation.Running) }
            try {
                val edited = s.edited
                if (edited != null) {
                    val amount = Money.fromText(s.amount.replace(',', '.'))
                        ?: return@launch report(R.string.vouchers_amount_invalid)
                    handleResponse(repo.edit(edited, VoucherInfo(
                        number = s.number.trim(), pin = s.pin.trim().ifEmpty { null },
                        amount = amount, currency = CurrencyCode(s.currency.trim()))))
                    return@launch
                }

                if (file != null) {
                    val (readType, bytes) = file()
                        ?: return@launch report(R.string.csv_upload_unreadable)
                    val type = readType ?: "application/pdf"
                    // The server only accepts PDF; rejecting it here saves the upload.
                    if (type != "application/pdf") return@launch report(R.string.vouchers_only_pdf)

                    val r = repo.fromPdf(
                        fileName = s.pdfName ?: "gutschein.pdf", type = type, content = bytes,
                        number = s.number, pin = s.pin, amount = s.amount.replace(',', '.'),
                        currency = s.currency,
                    )
                    val g = (r as? Outcome.Success)?.data as? VoucherStorage.Incomplete
                    if (g != null) {
                        // 422: what the server could read goes into the form —
                        // the user fills in the rest and sends the same file.
                        _state.update {
                            it.copy(
                                number = it.number.ifEmpty { g.number.orEmpty() },
                                pin = it.pin.ifEmpty { g.pin.orEmpty() },
                                amount = it.amount.ifEmpty { g.amount?.let(::amountAsText).orEmpty() },
                                currency = g.currency?.code ?: it.currency,
                            )
                        }
                        return@launch report(R.string.vouchers_pdf_incomplete)
                    }
                    handleResponse(r)
                    return@launch
                }

                val amount = Money.fromText(s.amount.replace(',', '.'))
                    ?: return@launch report(R.string.vouchers_amount_invalid)
                handleResponse(repo.create(VoucherInfo(
                    number = s.number.trim(), pin = s.pin.trim().ifEmpty { null },
                    amount = amount, currency = CurrencyCode(s.currency.trim()))))
            } finally {
                _state.update { it.copy(save = Operation.Done) }
            }
        }
    }

    private suspend fun handleResponse(r: Outcome<VoucherStorage>) {
        when (r) {
            is Outcome.Success -> {
                val stack = (r.data as? VoucherStorage.Saved)?.takeIf { it.newValue != null }
                // Two quantity forms instead of "%1$d angelegt": Lint otherwise reports
                // PluralsCandidate, and the tree counts the Lint findings.
                messages.show(if (stack == null) texts.text(R.string.vouchers_saved)
                else texts.text(R.string.vouchers_import_done,
                    texts.quantity(R.plurals.csv_upload_new, stack.newValue ?: 0, stack.newValue ?: 0),
                    texts.quantity(R.plurals.csv_upload_updated, stack.changed ?: 0, stack.changed ?: 0)))
                emptyVoucherForm()
                load()
            }
            is Outcome.Failure -> messages.show(texts.messageForSnackbar(r))
        }
    }

    /**
     * Query a card's balance at LEGO; the server stores it.
     *
     * No retry on a rejection: the limit of one query every 30
     * seconds applies to all users, and the person just pressed the button.
     */
    fun queryBalance(id: Int) {
        viewModelScope.launch {
            _state.update { it.copy(balanceRunning = id) }
            try {
                when (val r = repo.balance(id)) {
                    is Outcome.Success -> {
                        val d = r.data
                        val v = d.voucher
                        if (!d.success || v == null) {
                            messages.show(d.error ?: texts.text(R.string.err_generic))
                            return@launch
                        }
                        val amount = d.displayed ?: fmtMoney(v.amount, v.currency)
                        var sentence = texts.text(R.string.vouchers_balance_done, v.number, amount)
                        // Appended instead of as a second message, which would overwrite the first.
                        if (d.currencyChanged) sentence += " " + texts.text(R.string.vouchers_balance_currency, v.currency)
                        messages.show(sentence)
                        load()
                    }
                    is Outcome.Failure -> messages.show(texts.messageForSnackbar(r))
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
    fun queryAllBalances() {
        if (_state.value.balanceRun != null) return
        balanceJob = viewModelScope.launch {
            val onIt = _state.value.vouchers.filter { !it.pin.isNullOrBlank() }
            if (onIt.isEmpty()) return@launch report(R.string.vouchers_balance_none)
            var done = 0
            var error = 0
            try {
                for (g in onIt) {
                    when (questionBalance(g, done + error, onIt.size)) {
                        BalanceQuery.DONE -> done++
                        BalanceQuery.ERROR -> error++
                        BalanceQuery.ABORT -> { error++; return@launch }
                    }
                }
            } finally {
                // Also runs on cancellation — otherwise the spinner would stay stuck.
                // Reload in its own coroutine: in a cancelled one
                // every suspending call would fail right away.
                _state.update { it.copy(balanceRunning = null, balanceRun = null) }
                loadVouchers()
                messages.show(texts.text(R.string.vouchers_balance_all_done,
                    done.toString(), error.toString()))
            }
        }
    }

    /** One card; if the server reports „abstand", it waits and asks again. */
    private suspend fun questionBalance(g: VoucherView, previous: Int, total: Int): BalanceQuery {
        repeat(GAP_ATTEMPTS) {
            _state.update {
                it.copy(balanceRunning = g.id, balanceRun = BalanceRun(
                    done = previous, total = total,
                    number = g.number, waitSec = 0))
            }
            when (val r = repo.balance(g.id)) {
                is Outcome.Success -> {
                    val d = r.data
                    if (d.success) return BalanceQuery.DONE
                    if (d.reason == "abstand" && (d.waitSec ?: 0) > 0) {
                        waitVisible(d.waitSec ?: 0, g.number)
                    } else {
                        messages.show(d.error ?: texts.text(R.string.err_generic))
                        // Bot protection applies to everyone, the account limit to this account:
                        // further cards would run into the same rejection.
                        val all = d.reason == "botschutz" || d.reason == "konto"
                        return if (all) BalanceQuery.ABORT else BalanceQuery.ERROR
                    }
                }
                is Outcome.Failure -> {
                    messages.show(texts.messageForSnackbar(r))
                    return BalanceQuery.ERROR
                }
            }
        }
        report(R.string.vouchers_balance_occupied)
        return BalanceQuery.ERROR
    }

    fun cancelBalanceRun() {
        balanceJob?.cancel()
        balanceJob = null
    }

    private suspend fun waitVisible(seconds: Int, number: String) {
        for (rest in seconds downTo 1) {
            _state.update { it.copy(balanceRun = it.balanceRun?.copy(waitSec = rest, number = number)) }
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
        report(if (isNumber) R.string.vouchers_copied_number else R.string.vouchers_copied_pin)

    /** PDF viewer: a ticket only after password and code; the graph navigates and acknowledges. */
    fun openVoucherPdf(id: Int) = require(VoucherStep.PDF, id)
    fun openVoucherExport() = require(VoucherStep.EXPORT, null)
    fun voucherPdfAcknowledge() = _state.update { it.copy(pdfTarget = null) }

    private fun report(id: Int) { messages.show(Message.Resource(id)) }

    private enum class BalanceQuery { DONE, ERROR, ABORT }
}

/** Steps the plain text handles; PDF and delete ask every time. */
private val PLAINTEXT_STEPS = setOf(VoucherStep.PIN_SHOW, VoucherStep.NUMBER_COPY, VoucherStep.PIN_COPY)

/** With these codes the server either demands the second factor or rejects it. */
private val FACTOR_CODES = setOf(ErrorCode.SECOND_FACTOR_NEEDED, ErrorCode.SECOND_FACTOR_WRONG)

/** Retry the same card at most this many times when the throttle slows things down. */
private const val GAP_ATTEMPTS = 4

/** Whole amounts without ".0": a voucher reads 400, not 400.0. */
internal fun amountAsText(amount: Money): String = amount.asBigDecimal().stripTrailingZeros().toPlainString()

/**
 * An input into a field that carries the server's mask: the mask is a
 * whole. Typing replaces it, deleting empties the field — „…123“ or the digits
 * „1234“ out of „…1234“ would be a new, wrong number.
 */
internal fun inputViaMask(old: String, newValue: String, isMask: Boolean): String = when {
    !isMask -> newValue
    old in newValue -> newValue.replace(old, "")
    // Only characters removed: deleted. Otherwise replaced (selected and retyped, pasted).
    isSubsequence(newValue, old) -> ""
    else -> newValue
}

private fun isSubsequence(part: String, whole: String): Boolean {
    var i = 0
    for (c in whole) if (i < part.length && part[i] == c) i++
    return i == part.length
}

/** A voucher PDF has one or two pages; above that the app does not even read it in. */
internal const val VOUCHER_MAX_BYTES = 20L * 1024 * 1024
