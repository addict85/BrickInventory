package ch.brickinventoryapp.finances.ui.screens

import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.ui.Laden
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.Redeem
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.ui.Alignment
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import ch.brickinventoryapp.ui.components.MitTooltip
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.model.domain.VoucherView
import ch.brickinventoryapp.finances.ui.GutscheinUiState
import ch.brickinventoryapp.finances.ui.BalanceRun
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.finances.ui.VoucherStep
import ch.brickinventoryapp.ui.components.ErrorHint
import ch.brickinventoryapp.ui.components.HintText
import ch.brickinventoryapp.ui.components.LocalSchrittschutz
import ch.brickinventoryapp.model.step.Schrittaktion
import ch.brickinventoryapp.ui.components.PasswordPrompt
import ch.brickinventoryapp.finances.ui.voucherSum
import ch.brickinventoryapp.ui.components.LabelAndValue
import ch.brickinventoryapp.ui.components.SettingsCard
import ch.brickinventoryapp.ui.components.SecretKopierWarning

/**
 * Vouchers — LEGO gift cards in one's own profile, reachable as simply as possible
 * and as in the web app's profile. A file of its own, so that SettingsScreen.kt
 * stays manageable.
 */
@Composable
fun GutscheineCard(
    zustand: GutscheinUiState,
    onFeld: (nummer: String?, pin: String?, betrag: String?, waehrung: String?) -> Unit,
    switchOnPin: (Int) -> Unit,
    editOn: (Int) -> Unit,
    onAbbrechen: () -> Unit,
    onSpeichern: (android.net.Uri?) -> Unit,
    deleteOn: (Int) -> Unit,
    openOnPdf: (id: Int) -> Unit,
    /** Puts this voucher's number or PIN on the clipboard; needs the plain text. */
    onKopieren: (id: Int, isNumber: Boolean) -> Unit,
    /**
     * Query this card's balance at LEGO and save it. The server allows
     * one query every 30 seconds across all users; the run across all cards therefore
     * paces itself.
     */
    onBalance: (Int) -> Unit,
    /** Den laufenden Durchgang anhalten. */
    cancelOnBalance: () -> Unit,
    /** Fetch the list anew after a load error. */
    onErneut: () -> Unit,
    /** Password and code of the open prompt ([GutscheinUiState.confirmation]). */
    onBestaetigen: (passwort: String, code: String?) -> Unit,
    cancelOnConfirmation: () -> Unit,
    /** Whether the create form is open; its button sits on the page (VouchersPage). */
    neu: Boolean = false,
    onNew: (Boolean) -> Unit = {},
) {
    // The chosen file lives only in the form — a Uri is a permission of this
    // screen, not a datum of the account. rememberSaveable, because it is a choice made by
    // the person and should survive a rotation; Uri is Parcelable.
    var pdfUri by rememberSaveable { mutableStateOf<android.net.Uri?>(null) }
    val selection = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> pdfUri = uri }
    val geschuetzt = protectedStep()
    // The form sits in a sheet, not permanently under the list: on the
    // phone it otherwise got in the way on every visit. Open for creating ([neu]) or
    // for as long as a voucher is being edited; after a successful save (fields
    // empty) it closes on its own, on a rejection it stays open with the input.
    var gesendet by rememberSaveable { mutableStateOf(false) }
    // Tied to the fields, not only to saving: a fast server
    // flips true → false without a composition in between.
    LaunchedEffect(gesendet, zustand.speichern.laeuft, zustand.nummer, zustand.edited) {
        if (gesendet && !zustand.speichern.laeuft) {
            gesendet = false
            if (zustand.nummer.isEmpty() && zustand.edited == null) onNew(false)
        }
    }
    // Without a header: the card stands alone on its page, whose bar already names „Gutscheine“.
    SettingsCard(title = null, icon = Icons.Default.Redeem) {
      BoxWithConstraints {
        // From tablet width on, two cards side by side: a voucher card over 1000 dp
        // pulled number and menu far apart.
        val breit = maxWidth >= 720.dp
        Column(verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        // Adding floats as the main action above the page, balance and PDF sit in the bar's
        // menu (VoucherMenu): three wide buttons stacked pushed the cards
        // out of view. The balance query's progress stays here: with a query
        // every 30 seconds, four cards take a good minute and a half.
        zustand.balanceRun?.let { BalanceRunRow(it, cancelOnBalance) }
        EmptyOrError(zustand, onErneut)

        val karte: @Composable (VoucherView, Modifier) -> Unit = { g, m ->
            GutscheinKarte(
                g = g,
                pinSichtbar = g.id in zustand.pinSichtbar,
                // Hiding needs no confirmation, revealing does.
                switchOnPin = {
                    if (g.id in zustand.pinSichtbar) switchOnPin(g.id) else geschuetzt { switchOnPin(g.id) }
                },
                editOn = { geschuetzt { editOn(g.id) } },
                deleteOn = { geschuetzt { deleteOn(g.id) } },
                openOnPdf = { geschuetzt { openOnPdf(g.id) } },
                onKopieren = { isNumber -> geschuetzt { onKopieren(g.id, isNumber) } },
                klartext = zustand.klartext[g.id],
                onBalance = { onBalance(g.id) },
                balanceRunning = zustand.balanceRunning == g.id,
                modifier = m,
            )
        }
        VoucherRaster(zustand.gutscheine, breit, karte)
        if (zustand.gutscheine.isNotEmpty()) SecretKopierWarning()

        // The sum — only for a SINGLE currency (voucherSum).
        val sum = voucherSum(zustand.gutscheine)
        if (sum != null) {
            HorizontalDivider(Modifier.padding(vertical = Abstaende.klein))
            LabelAndValue(stringResource(R.string.vouchers_total), fmtMoney(sum.first.toDouble(), sum.second),
                valueWeight = FontWeight.Bold)
        }
        }
      }
    }

    zustand.confirmation?.let { VoucherPrompt(zustand, onBestaetigen, cancelOnConfirmation) }

    if (neu || zustand.edited != null) {
        GutscheinFormularBlatt(
            zustand = zustand,
            pdfGewaehlt = pdfUri != null,
            onFeld = onFeld,
            onPdfWaehlen = { selection.launch(arrayOf("application/pdf")) },
            onSpeichern = { gesendet = true; onSpeichern(pdfUri); pdfUri = null },
            onSchliessen = { onNew(false); pdfUri = null; if (zustand.edited != null) onAbbrechen() },
        )
    }
}

/**
 * Number and PIN, the PDFs and delete: only after the device lock (step guard),
 * after that the ViewModel asks for password and code.
 */
@Composable
private fun protectedStep(): (() -> Unit) -> Unit {
    val protection = LocalSchrittschutz.current
    val grund = stringResource(R.string.schritt_gutschein)
    return { schritt -> protection.confirm(grund, Schrittaktion.GUTSCHEIN, schritt) }
}

/** Die Karten untereinander, ab Tabletbreite ([breit]) je zwei gleich hoch nebeneinander. */
@Composable
private fun VoucherRaster(
    gutscheine: List<VoucherView>,
    breit: Boolean,
    karte: @Composable (VoucherView, Modifier) -> Unit,
) {
    if (!breit) {
        gutscheine.forEach { karte(it, Modifier.fillMaxWidth()) }
        return
    }
    gutscheine.chunked(2).forEach { paar ->
        Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            paar.forEach { karte(it, Modifier.weight(1f).fillMaxHeight()) }
            if (paar.size == 1) Spacer(Modifier.weight(1f))
        }
    }
}

/**
 * How far the balance query for all cards has got, with cancel: with one query every
 * 30 seconds, four cards take a good minute and a half.
 */
@Composable
private fun BalanceRunRow(lauf: BalanceRun, onAbbrechen: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
        Text(
            if (lauf.wartenSek > 0) {
                stringResource(R.string.vouchers_balance_wait, lauf.wartenSek.toString(), lauf.nummer)
            } else {
                stringResource(R.string.vouchers_balance_progress,
                    (lauf.erledigt + 1).toString(), lauf.gesamt.toString(), lauf.nummer)
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        TextButton(onClick = onAbbrechen) { Text(stringResource(R.string.common_cancel)) }
    }
}

/**
 * Without vouchers: the load error with its class's advice and a retry, otherwise the
 * empty state like every list (icon, title, what the page is for). No button of its own
 * for a bulk import: the file goes through the field in the form.
 */
@Composable
private fun EmptyOrError(zustand: GutscheinUiState, onErneut: () -> Unit) {
    if (zustand.gutscheine.isNotEmpty() || zustand.abruf.laedt) return
    val fehler = zustand.abruf as? Laden.Fehler
    if (fehler != null) ErrorHint(fehler.meldung.satz(), onErneut, fehler.art)
    else Column(Modifier.fillMaxWidth().padding(vertical = Abstaende.mittel),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        HintText(Icons.Default.Redeem, stringResource(R.string.vouchers_empty),
            stringResource(R.string.vouchers_empty_hint))
    }
}

/** Password and code before deleting, a PDF or plain text ([GutscheinUiState.confirmation]). */
@Composable
private fun VoucherPrompt(
    zustand: GutscheinUiState,
    onBestaetigen: (passwort: String, code: String?) -> Unit,
    onAbbrechen: () -> Unit,
) {
    val frage = zustand.confirmation ?: return
    val nummer = zustand.gutscheine.find { it.id == frage.id }?.number.orEmpty()
    val loeschen = frage.schritt == VoucherStep.DELETE
    val pdf = frage.schritt == VoucherStep.PDF || frage.schritt == VoucherStep.EXPORT
    PasswordPrompt(
        titel = stringResource(if (loeschen) R.string.common_delete else R.string.vouchers_confirm_title),
        text = when {
            loeschen -> stringResource(R.string.vouchers_delete_confirm, nummer)
            pdf -> stringResource(R.string.vouchers_confirm_pdf)
            else -> stringResource(R.string.vouchers_confirm_klartext)
        },
        bestaetigen = stringResource(if (loeschen) R.string.common_delete else R.string.vouchers_confirm_button),
        codeNoetig = frage.codeNoetig,
        fehler = frage.operation.errorMessage?.satz(),
        laeuft = frage.operation.laeuft,
        onBestaetigen = onBestaetigen,
        onAbbrechen = onAbbrechen,
    )
}

/**
 * The page's main action: add a voucher. The version with content, not the one with
 * `text`/`icon`: that one takes the text from the semantics, which would read out only „Schaltfläche“.
 */
@Composable
internal fun VoucherAdd(onClick: () -> Unit) {
    ExtendedFloatingActionButton(onClick = onClick) {
        Icon(Icons.Default.Add, null)
        Spacer(Modifier.width(Abstaende.mittel))
        Text(stringResource(R.string.vouchers_add))
    }
}

/**
 * What applies to all vouchers, in the bar's menu: query the balance of all cards
 * (one after another) and all of them as ONE PDF in the viewer. Both rare, so
 * not as a button above the list.
 */
@Composable
internal fun VoucherMenu(zustand: GutscheinUiState, onBalanceAll: () -> Unit, exportOn: () -> Unit) {
    var offen by rememberSaveable { mutableStateOf(false) }
    val geschuetzt = protectedStep()
    val beschreibung = stringResource(R.string.vouchers_menu_cd)
    Box {
        MitTooltip(beschreibung) {
            IconButton(onClick = { offen = true }) { Icon(Icons.Default.MoreVert, beschreibung) }
        }
        DropdownMenu(offen, { offen = false }) {
            DropdownMenuItem(
                text = { Text(stringResource(R.string.vouchers_balance_all)) },
                leadingIcon = { Icon(Icons.Default.Sync, null) },
                // A balance can only be queried with a PIN; if a query is already running, it waits.
                enabled = zustand.balanceRun == null && zustand.gutscheine.any { !it.pin.isNullOrBlank() },
                onClick = { offen = false; onBalanceAll() },
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.vouchers_export)) },
                leadingIcon = { Icon(Icons.Default.PictureAsPdf, null) },
                // Without vouchers out: the server answered with 404, a viewer with
                // an error message would be the most roundabout way to say „du hast noch keine“.
                enabled = zustand.gutscheine.isNotEmpty(),
                onClick = { offen = false; geschuetzt(exportOn) },
            )
        }
    }
}
