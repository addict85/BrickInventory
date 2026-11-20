package ch.brickinventoryapp.finances.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.Sichtschutz
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz
import ch.brickinventoryapp.finances.ui.viewmodel.GutscheinViewModel
import ch.brickinventoryapp.ui.util.SecretClipboard
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.ui.components.Subpage
import androidx.compose.runtime.saveable.rememberSaveable
import ch.brickinventoryapp.finances.ui.GutscheinUiState

/**
 * Gutscheine — der erste Eintrag der Liste, weil sie im Laden gebraucht werden:
 * einen Fingertipp entfernt, ohne dass man an ihnen vorbeirollt, wenn man etwas
 * anderes sucht.
 */
@Composable
fun VouchersRoute(
    gvm: GutscheinViewModel,
    snackbarHostState: SnackbarHostState,
    onZurueck: () -> Unit,
) {
    val voucherState by gvm.state.collectAsStateWithLifecycle()
    Sichtschutz()
    // PIN kopieren und Gutscheine löschen: kein Tipp durch eine Überlagerung.
    Ueberdeckungsschutz()
    // Kopiert wird über SecretClipboard (nach einer Minute wieder leer); die
    // Rückmeldung läuft über den Snackbar des ViewModels wie alle anderen Meldungen.
    val context = androidx.compose.ui.platform.LocalContext.current
    val etikett = stringResource(R.string.vouchers_title)
    // Die Liste lädt, sobald diese Seite den Zustand beobachtet (GutscheinViewModel),
    // nicht beim Öffnen der Einstellungen. Der Klartext lebt nur, solange die Seite vorne steht.
    DisposableEffect(Unit) { onDispose { gvm.leaveVouchers() } }
    androidx.lifecycle.compose.LifecycleEventEffect(androidx.lifecycle.Lifecycle.Event.ON_STOP) { gvm.forgetPlaintext() }
    // Nummer und PIN zusammen sind Geld: als Geheimnis markiert, nach einer Minute weg.
    val job = voucherState.copyTo
    LaunchedEffect(job) {
        if (job == null) return@LaunchedEffect
        SecretClipboard.copy(context, etikett, job.wert)
        gvm.reportVoucherCopied(job.isNumber)
        gvm.copyAcknowledge()
    }
    VouchersPage(voucherState, snackbarHostState, onZurueck,
        onBalanceAll = { gvm.questionAllBalanceAb() }, exportOn = { gvm.openVoucherExport() }) { neu, onNew ->
        GutscheineCard(
            zustand = voucherState,
            onFeld = { n, p, b, w -> gvm.setVoucherField(n, p, b, w) },
            switchOnPin = { gvm.switchVoucherPin(it) },
            editOn = { gvm.editVoucher(it) },
            onAbbrechen = { gvm.emptyVoucherForm() },
            onSpeichern = { gvm.saveVoucher(it?.let { u -> FileRef(u.toString()) }) },
            deleteOn = { gvm.deleteVoucher(it) },
            openOnPdf = { gvm.openVoucherPdf(it) },
            onKopieren = { id, isNumber -> gvm.copyVoucher(id, isNumber) },
            onBalance = { gvm.questionBalanceAb(it) },
            cancelOnBalance = { gvm.cancelBalanceRun() },
            onErneut = { gvm.loadVouchers() },
            onBestaetigen = { passwort, code -> gvm.confirm(passwort, code) },
            cancelOnConfirmation = { gvm.cancelConfirmation() },
            neu = neu,
            onNew = onNew,
        )
    }
}

/**
 * Die Seite der Gutscheine: „Hinzufügen“ schwebt als Hauptaktion, Guthaben aller Karten
 * und PDF stehen im Menü der Leiste. Drei breite Knöpfe über der Liste schoben die
 * Karten aus dem Bild. [karte] bekommt, ob das Formular zum Anlegen offen ist.
 */
@Composable
fun VouchersPage(
    zustand: GutscheinUiState,
    snackbarHostState: SnackbarHostState,
    onZurueck: () -> Unit,
    onBalanceAll: () -> Unit,
    exportOn: () -> Unit,
    karte: @Composable (neu: Boolean, onNew: (Boolean) -> Unit) -> Unit,
) {
    var neu by rememberSaveable { mutableStateOf(false) }
    Subpage(
        stringResource(R.string.vouchers_title), snackbarHostState, onZurueck,
        aktionen = { VoucherMenu(zustand, onBalanceAll, exportOn) },
        primaryAction = { VoucherAdd { neu = true } },
    ) { karte(neu) { neu = it } }
}
