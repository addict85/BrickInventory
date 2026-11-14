package ch.brickinventoryapp.finanzen.ui.screens

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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.model.ui.model.GutscheinAnsicht
import ch.brickinventoryapp.finanzen.ui.GutscheinUiState
import ch.brickinventoryapp.finanzen.ui.GuthabenLauf
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.finanzen.ui.GutscheinSchritt
import ch.brickinventoryapp.ui.components.FehlerHinweis
import ch.brickinventoryapp.ui.components.LocalSchrittschutz
import ch.brickinventoryapp.model.schritt.Schrittaktion
import ch.brickinventoryapp.ui.components.PasswortRueckfrage
import ch.brickinventoryapp.finanzen.ui.gutscheinSumme
import ch.brickinventoryapp.ui.components.BezeichnungUndWert
import ch.brickinventoryapp.ui.components.SettingsCard

/**
 * Gutscheine — LEGO-Geschenkkarten im eigenen Profil, möglichst einfach erreichbar
 * und wie in der Webapp beim Profil. Eine eigene Datei, damit SettingsScreen.kt
 * überschaubar bleibt.
 */
@Composable
fun GutscheineCard(
    zustand: GutscheinUiState,
    onFeld: (nummer: String?, pin: String?, betrag: String?, waehrung: String?) -> Unit,
    onPinSchalten: (Int) -> Unit,
    onBearbeiten: (Int) -> Unit,
    onAbbrechen: () -> Unit,
    onSpeichern: (android.net.Uri?) -> Unit,
    onLoeschen: (Int) -> Unit,
    onPdfOeffnen: (id: Int) -> Unit,
    /** Nummer oder PIN dieses Gutscheins in die Zwischenablage; braucht den Klartext. */
    onKopieren: (id: Int, istNummer: Boolean) -> Unit,
    /**
     * Das Guthaben dieser Karte bei LEGO abfragen und speichern. Der Server erlaubt
     * eine Abfrage je 30 Sekunden über alle Benutzer; der Lauf über alle Karten taktet
     * sich deshalb selbst.
     */
    onGuthaben: (Int) -> Unit,
    /** Den laufenden Durchgang anhalten. */
    onGuthabenAbbrechen: () -> Unit,
    /** Die Liste nach einem Ladefehler neu holen. */
    onErneut: () -> Unit,
    /** Passwort und Code der offenen Rückfrage ([GutscheinUiState.bestaetigung]). */
    onBestaetigen: (passwort: String, code: String?) -> Unit,
    onBestaetigungAbbrechen: () -> Unit,
    /** Ob das Formular zum Anlegen offen ist; der Knopf dazu steht auf der Seite (GutscheineSeite). */
    neu: Boolean = false,
    onNeu: (Boolean) -> Unit = {},
) {
    // Die gewählte Datei lebt nur im Formular — eine Uri ist eine Berechtigung dieses
    // Bildschirms, kein Datum des Kontos. rememberSaveable, weil sie eine Wahl des
    // Menschen ist und eine Drehung überstehen soll; Uri ist Parcelable.
    var pdfUri by rememberSaveable { mutableStateOf<android.net.Uri?>(null) }
    val auswahl = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> pdfUri = uri }
    val geschuetzt = geschuetzterSchritt()
    // Das Formular steht in einem Blatt, nicht dauerhaft unter der Liste: Auf dem
    // Telefon lag es sonst bei jedem Besuch im Weg. Offen zum Anlegen ([neu]) oder
    // solange ein Gutschein bearbeitet wird; nach erfolgreichem Speichern (Felder
    // leer) geht es von selbst zu, bei einer Absage bleibt es mit den Eingaben offen.
    var gesendet by rememberSaveable { mutableStateOf(false) }
    // An den Feldern festgemacht, nicht nur an `speichert`: Ein schneller Server
    // wechselt true → false, ohne dass eine Zusammensetzung dazwischen liegt.
    LaunchedEffect(gesendet, zustand.speichert, zustand.nummer, zustand.bearbeitet) {
        if (gesendet && !zustand.speichert) {
            gesendet = false
            if (zustand.nummer.isEmpty() && zustand.bearbeitet == null) onNeu(false)
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
        // der Leiste (GutscheinMenue): Drei breite Knöpfe untereinander schoben die Karten
        // aus dem Bild. Der Fortschritt der Guthaben-Abfrage bleibt hier: Bei einer Abfrage
        // je 30 Sekunden dauern vier Karten gut anderthalb Minuten.
        zustand.guthabenLauf?.let { GuthabenLaufZeile(it, onGuthabenAbbrechen) }
        LeerOderFehler(zustand, onErneut)

        val karte: @Composable (GutscheinAnsicht, Modifier) -> Unit = { g, m ->
            GutscheinKarte(
                g = g,
                pinSichtbar = g.id in zustand.pinSichtbar,
                // Verdecken braucht keine Bestätigung, aufdecken schon.
                onPinSchalten = {
                    if (g.id in zustand.pinSichtbar) onPinSchalten(g.id) else geschuetzt { onPinSchalten(g.id) }
                },
                onBearbeiten = { geschuetzt { onBearbeiten(g.id) } },
                onLoeschen = { geschuetzt { onLoeschen(g.id) } },
                onPdfOeffnen = { geschuetzt { onPdfOeffnen(g.id) } },
                onKopieren = { istNummer -> geschuetzt { onKopieren(g.id, istNummer) } },
                klartext = zustand.klartext[g.id],
                onGuthaben = { onGuthaben(g.id) },
                guthabenLaeuft = zustand.guthabenLaeuft == g.id,
                modifier = m,
            )
        }
        GutscheinRaster(zustand.gutscheine, breit, karte)

        // Die Summe — nur bei EINER Waehrung (gutscheinSumme).
        val summe = gutscheinSumme(zustand.gutscheine)
        if (summe != null) {
            HorizontalDivider(Modifier.padding(vertical = Abstaende.klein))
            BezeichnungUndWert(stringResource(R.string.vouchers_total), fmtMoney(summe.first.toDouble(), summe.second),
                wertGewicht = FontWeight.Bold)
        }
        }
      }
    }

    zustand.bestaetigung?.let { GutscheinRueckfrage(zustand, onBestaetigen, onBestaetigungAbbrechen) }

    if (neu || zustand.bearbeitet != null) {
        GutscheinFormularBlatt(
            zustand = zustand,
            pdfGewaehlt = pdfUri != null,
            onFeld = onFeld,
            onPdfWaehlen = { auswahl.launch(arrayOf("application/pdf")) },
            onSpeichern = { gesendet = true; onSpeichern(pdfUri); pdfUri = null },
            onSchliessen = { onNeu(false); pdfUri = null; if (zustand.bearbeitet != null) onAbbrechen() },
        )
    }
}

/**
 * Nummer und PIN, die PDFs und Löschen: erst nach der Gerätesperre (Schrittschutz),
 * danach fragt das ViewModel nach Passwort und Code.
 */
@Composable
private fun geschuetzterSchritt(): (() -> Unit) -> Unit {
    val schutz = LocalSchrittschutz.current
    val grund = stringResource(R.string.schritt_gutschein)
    return { schritt -> schutz.bestaetige(grund, Schrittaktion.GUTSCHEIN, schritt) }
}

/** Die Karten untereinander, ab Tabletbreite ([breit]) je zwei gleich hoch nebeneinander. */
@Composable
private fun GutscheinRaster(
    gutscheine: List<GutscheinAnsicht>,
    breit: Boolean,
    karte: @Composable (GutscheinAnsicht, Modifier) -> Unit,
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
private fun GuthabenLaufZeile(lauf: GuthabenLauf, onAbbrechen: () -> Unit) {
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
 * Ohne Gutscheine: der Ladefehler mit neuem Versuch, sonst der Satz „noch keine“. Kein
 * eigener Knopf für den Stapel-Import: Die Datei geht über das Feld im Formular.
 */
@Composable
private fun LeerOderFehler(zustand: GutscheinUiState, onErneut: () -> Unit) {
    if (zustand.gutscheine.isNotEmpty() || zustand.laedt) return
    val fehler = zustand.fehler
    if (fehler != null) FehlerHinweis(fehler, onErneut)
    else Text(stringResource(R.string.vouchers_empty), style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** Passwort und Code vor Löschen, PDF oder Klartext ([GutscheinUiState.bestaetigung]). */
@Composable
private fun GutscheinRueckfrage(
    zustand: GutscheinUiState,
    onBestaetigen: (passwort: String, code: String?) -> Unit,
    onAbbrechen: () -> Unit,
) {
    val frage = zustand.bestaetigung ?: return
    val nummer = zustand.gutscheine.find { it.id == frage.id }?.number.orEmpty()
    val loeschen = frage.schritt == GutscheinSchritt.LOESCHEN
    val pdf = frage.schritt == GutscheinSchritt.PDF || frage.schritt == GutscheinSchritt.EXPORT
    PasswortRueckfrage(
        titel = stringResource(if (loeschen) R.string.common_delete else R.string.vouchers_confirm_title),
        text = when {
            loeschen -> stringResource(R.string.vouchers_delete_confirm, nummer)
            pdf -> stringResource(R.string.vouchers_confirm_pdf)
            else -> stringResource(R.string.vouchers_confirm_klartext)
        },
        bestaetigen = stringResource(if (loeschen) R.string.common_delete else R.string.vouchers_confirm_button),
        codeNoetig = frage.codeNoetig,
        fehler = frage.fehler,
        laeuft = frage.laeuft,
        onBestaetigen = onBestaetigen,
        onAbbrechen = onAbbrechen,
    )
}

/** Die Hauptaktion der Seite: einen Gutschein anlegen. */
@Composable
internal fun GutscheinHinzufuegen(onClick: () -> Unit) {
    ExtendedFloatingActionButton(
        onClick = onClick,
        icon = { Icon(Icons.Default.Add, null) },
        text = { Text(stringResource(R.string.vouchers_add)) },
    )
}

/**
 * Was für alle Gutscheine gilt, im Menü der Leiste: das Guthaben aller Karten abfragen
 * (eine nach der anderen) und alle als EIN PDF im Betrachter. Beides selten, darum
 * nicht als Knopf über der Liste.
 */
@Composable
internal fun GutscheinMenue(zustand: GutscheinUiState, onGuthabenAlle: () -> Unit, onExportieren: () -> Unit) {
    var offen by rememberSaveable { mutableStateOf(false) }
    val geschuetzt = geschuetzterSchritt()
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
                enabled = zustand.guthabenLauf == null && zustand.gutscheine.any { !it.pin.isNullOrBlank() },
                onClick = { offen = false; onGuthabenAlle() },
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.vouchers_export)) },
                leadingIcon = { Icon(Icons.Default.PictureAsPdf, null) },
                // Ohne Gutscheine aus: Der Server antwortete mit 404, ein Betrachter mit
                // Fehlermeldung wäre der umständlichste Weg zu „du hast noch keine“.
                enabled = zustand.gutscheine.isNotEmpty(),
                onClick = { offen = false; geschuetzt(onExportieren) },
            )
        }
    }
}
