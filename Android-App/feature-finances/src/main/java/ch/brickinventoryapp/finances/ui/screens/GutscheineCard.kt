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
 * Gutscheine — LEGO-Geschenkkarten im eigenen Profil, möglichst einfach erreichbar
 * und wie in der Webapp beim Profil. Eine eigene Datei, damit SettingsScreen.kt
 * überschaubar bleibt.
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
    /** Nummer oder PIN dieses Gutscheins in die Zwischenablage; braucht den Klartext. */
    onKopieren: (id: Int, isNumber: Boolean) -> Unit,
    /**
     * Das Guthaben dieser Karte bei LEGO abfragen und speichern. Der Server erlaubt
     * eine Abfrage je 30 Sekunden über alle Benutzer; der Lauf über alle Karten taktet
     * sich deshalb selbst.
     */
    onBalance: (Int) -> Unit,
    /** Den laufenden Durchgang anhalten. */
    cancelOnBalance: () -> Unit,
    /** Die Liste nach einem Ladefehler neu holen. */
    onErneut: () -> Unit,
    /** Passwort und Code der offenen Rückfrage ([GutscheinUiState.confirmation]). */
    onBestaetigen: (passwort: String, code: String?) -> Unit,
    cancelOnConfirmation: () -> Unit,
    /** Ob das Formular zum Anlegen offen ist; der Knopf dazu steht auf der Seite (VouchersPage). */
    neu: Boolean = false,
    onNew: (Boolean) -> Unit = {},
) {
    // Die gewählte Datei lebt nur im Formular — eine Uri ist eine Berechtigung dieses
    // Bildschirms, kein Datum des Kontos. rememberSaveable, weil sie eine Wahl des
    // Menschen ist und eine Drehung überstehen soll; Uri ist Parcelable.
    var pdfUri by rememberSaveable { mutableStateOf<android.net.Uri?>(null) }
    val selection = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> pdfUri = uri }
    val geschuetzt = protectedStep()
    // Das Formular steht in einem Blatt, nicht dauerhaft unter der Liste: Auf dem
    // Telefon lag es sonst bei jedem Besuch im Weg. Offen zum Anlegen ([neu]) oder
    // solange ein Gutschein bearbeitet wird; nach erfolgreichem Speichern (Felder
    // leer) geht es von selbst zu, bei einer Absage bleibt es mit den Eingaben offen.
    var gesendet by rememberSaveable { mutableStateOf(false) }
    // An den Feldern festgemacht, nicht nur am Speichern: Ein schneller Server
    // wechselt true → false, ohne dass eine Zusammensetzung dazwischen liegt.
    LaunchedEffect(gesendet, zustand.speichern.laeuft, zustand.nummer, zustand.edited) {
        if (gesendet && !zustand.speichern.laeuft) {
            gesendet = false
            if (zustand.nummer.isEmpty() && zustand.edited == null) onNew(false)
        }
    }
    // Ohne Kopf: Die Karte ist allein auf ihrer Seite, deren Leiste „Gutscheine“ schon nennt.
    SettingsCard(title = null, icon = Icons.Default.Redeem) {
      BoxWithConstraints {
        // Ab Tabletbreite zwei Karten nebeneinander: Eine Gutscheinkarte über 1000 dp
        // zog Nummer und Menü weit auseinander.
        val breit = maxWidth >= 720.dp
        Column(verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        // Hinzufügen schwebt als Hauptaktion über der Seite, Guthaben und PDF stehen im Menü
        // der Leiste (VoucherMenu): Drei breite Knöpfe untereinander schoben die Karten
        // aus dem Bild. Der Fortschritt der Guthaben-Abfrage bleibt hier: Bei einer Abfrage
        // je 30 Sekunden dauern vier Karten gut anderthalb Minuten.
        zustand.balanceRun?.let { BalanceRunRow(it, cancelOnBalance) }
        EmptyOrError(zustand, onErneut)

        val karte: @Composable (VoucherView, Modifier) -> Unit = { g, m ->
            GutscheinKarte(
                g = g,
                pinSichtbar = g.id in zustand.pinSichtbar,
                // Verdecken braucht keine Bestätigung, aufdecken schon.
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

        // Die Summe — nur bei EINER Waehrung (voucherSum).
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
 * Nummer und PIN, die PDFs und Löschen: erst nach der Gerätesperre (Schrittschutz),
 * danach fragt das ViewModel nach Passwort und Code.
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
 * Wie weit die Guthaben-Abfrage aller Karten ist, mit Abbrechen: Bei einer Abfrage je
 * 30 Sekunden dauern vier Karten gut anderthalb Minuten.
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
 * Ohne Gutscheine: der Ladefehler mit Rat seiner Klasse und neuem Versuch, sonst der
 * Leerzustand wie jede Liste (Symbol, Titel, wozu die Seite da ist). Kein eigener Knopf
 * für den Stapel-Import: Die Datei geht über das Feld im Formular.
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

/** Passwort und Code vor Löschen, PDF oder Klartext ([GutscheinUiState.confirmation]). */
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
 * Die Hauptaktion der Seite: einen Gutschein anlegen. Die Fassung mit Inhalt, nicht die mit
 * `text`/`icon`: Jene nimmt den Text aus der Semantik, vorgelesen würde nur „Schaltfläche“.
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
 * Was für alle Gutscheine gilt, im Menü der Leiste: das Guthaben aller Karten abfragen
 * (eine nach der anderen) und alle als EIN PDF im Betrachter. Beides selten, darum
 * nicht als Knopf über der Liste.
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
                // Nur mit PIN lässt sich ein Guthaben abfragen; läuft schon eine Abfrage, wartet sie.
                enabled = zustand.balanceRun == null && zustand.gutscheine.any { !it.pin.isNullOrBlank() },
                onClick = { offen = false; onBalanceAll() },
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.vouchers_export)) },
                leadingIcon = { Icon(Icons.Default.PictureAsPdf, null) },
                // Ohne Gutscheine aus: Der Server antwortete mit 404, ein Betrachter mit
                // Fehlermeldung wäre der umständlichste Weg zu „du hast noch keine“.
                enabled = zustand.gutscheine.isNotEmpty(),
                onClick = { offen = false; geschuetzt(exportOn) },
            )
        }
    }
}
