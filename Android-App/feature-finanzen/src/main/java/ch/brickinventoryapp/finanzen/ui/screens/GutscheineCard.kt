package ch.brickinventoryapp.finanzen.ui.screens

import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.Redeem
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
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.finanzen.ui.GutscheinSchritt
import ch.brickinventoryapp.ui.components.FehlerHinweis
import ch.brickinventoryapp.ui.components.LocalSchrittschutz
import ch.brickinventoryapp.ui.components.PasswortRueckfrage
import ch.brickinventoryapp.ui.components.mitSchrift
import ch.brickinventoryapp.finanzen.ui.gutscheinSumme
import ch.brickinventoryapp.ui.screens.BezeichnungUndWert
import ch.brickinventoryapp.ui.screens.SettingsCard

/**
 * Gutscheine — LEGO-Geschenkkarten im eigenen Profil, möglichst einfach erreichbar
 * und wie in der Webapp beim Profil. Eine eigene Datei, damit SettingsScreen.kt
 * überschaubar bleibt.
 */
@OptIn(ExperimentalLayoutApi::class)
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
    /** Alle Gutscheine als EIN PDF — im Betrachter, nicht als Download. */
    onExportieren: () -> Unit,
    /** Das Guthaben ALLER Karten abfragen, eine nach der anderen. */
    onGuthabenAlle: () -> Unit,
    /** Den laufenden Durchgang anhalten. */
    onGuthabenAbbrechen: () -> Unit,
    /** Die Liste nach einem Ladefehler neu holen. */
    onErneut: () -> Unit,
    /** Passwort und Code der offenen Rückfrage ([GutscheinUiState.bestaetigung]). */
    onBestaetigen: (passwort: String, code: String?) -> Unit,
    onBestaetigungAbbrechen: () -> Unit,
) {
    // Die gewählte Datei lebt nur im Formular — eine Uri ist eine Berechtigung dieses
    // Bildschirms, kein Datum des Kontos. rememberSaveable, weil sie eine Wahl des
    // Menschen ist und eine Drehung überstehen soll; Uri ist Parcelable.
    var pdfUri by rememberSaveable { mutableStateOf<android.net.Uri?>(null) }
    val auswahl = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.OpenDocument()
    ) { uri -> pdfUri = uri }
    // Nummer und PIN, die PDFs und Löschen: erst nach der Gerätesperre (Schrittschutz),
    // danach fragt das ViewModel nach Passwort und Code.
    val schutz = LocalSchrittschutz.current
    val grund = stringResource(R.string.schritt_gutschein)
    val geschuetzt: (() -> Unit) -> Unit = { schritt -> schutz.bestaetige(grund, schritt) }
    // Das Formular steht in einem Blatt, nicht dauerhaft unter der Liste: Auf dem
    // Telefon lag es sonst bei jedem Besuch im Weg. Offen zum Anlegen ([neu]) oder
    // solange ein Gutschein bearbeitet wird; nach erfolgreichem Speichern (Felder
    // leer) geht es von selbst zu, bei einer Absage bleibt es mit den Eingaben offen.
    var neu by rememberSaveable { mutableStateOf(false) }
    var gesendet by rememberSaveable { mutableStateOf(false) }
    // An den Feldern festgemacht, nicht nur an `speichert`: Ein schneller Server
    // wechselt true → false, ohne dass eine Zusammensetzung dazwischen liegt.
    LaunchedEffect(gesendet, zustand.speichert, zustand.nummer, zustand.bearbeitet) {
        if (gesendet && !zustand.speichert) {
            gesendet = false
            if (zustand.nummer.isEmpty() && zustand.bearbeitet == null) neu = false
        }
    }
    // Ohne Kopf: Die Karte ist allein auf ihrer Seite, deren Leiste „Gutscheine“ schon nennt.
    SettingsCard(title = null, icon = Icons.Default.Redeem) {
      BoxWithConstraints {
        // Ab Tabletbreite zwei Karten nebeneinander: Eine Gutscheinkarte über 1000 dp
        // zog Nummer und Menü weit auseinander.
        val breit = maxWidth >= 720.dp
        Column(verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        // ── Kopf: hinzufügen, Guthaben aller Karten, alle als PDF ──
        //
        // Drei Knöpfe derselben Bauform mit Symbol; hinzufügen ist die Hauptaktion. Der
        // Fortschritt der Guthaben-Abfrage steht darunter im Text: Bei einer Abfrage je
        // 30 Sekunden dauern vier Karten gut anderthalb Minuten.
        val lauf = zustand.guthabenLauf
        // Auf dem Telefon stehen die drei untereinander und gleich breit: Mit ihrer eigenen
        // Breite ergaben sie eine Treppe aus drei Längen.
        val knopfBreite = if (breit) Modifier else Modifier.fillMaxWidth()
        FlowRow(verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            Button(onClick = { neu = true }, modifier = knopfBreite) {
                Icon(Icons.Default.Add, null, Modifier.size(mitSchrift(18.dp)))
                Spacer(Modifier.width(Abstaende.klein))
                Text(stringResource(R.string.vouchers_add))
            }
            OutlinedButton(
                onClick = onGuthabenAlle,
                modifier = knopfBreite,
                enabled = lauf == null && zustand.gutscheine.any { !it.pin.isNullOrBlank() },
                colors = nebenKnopfFarben(),
                border = nebenKnopfRand(lauf == null && zustand.gutscheine.any { !it.pin.isNullOrBlank() }),
            ) {
                // Kreisel an der Stelle des Symbols, nicht der Beschriftung.
                if (lauf != null) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                else Icon(Icons.Default.Sync, null, Modifier.size(mitSchrift(18.dp)))
                Spacer(Modifier.width(Abstaende.klein))
                Text(stringResource(R.string.vouchers_balance_all))
            }
            if (lauf != null) {
                TextButton(onClick = onGuthabenAbbrechen) {
                    Text(stringResource(R.string.common_cancel))
                }
            }
            // Ohne Gutscheine aus: Der Server antwortete mit 404, ein Betrachter mit
            // Fehlermeldung wäre der umständlichste Weg zu „du hast noch keine“.
            OutlinedButton(onClick = { geschuetzt(onExportieren) }, modifier = knopfBreite, enabled = zustand.gutscheine.isNotEmpty(), colors = nebenKnopfFarben(), border = nebenKnopfRand(zustand.gutscheine.isNotEmpty())) {
                Icon(Icons.Default.PictureAsPdf, null, Modifier.size(mitSchrift(18.dp)))
                Spacer(Modifier.width(Abstaende.klein))
                Text(stringResource(R.string.vouchers_export))
            }
        }
        if (lauf != null) {
            Text(
                if (lauf.wartenSek > 0) {
                    stringResource(R.string.vouchers_balance_wait,
                        lauf.wartenSek.toString(), lauf.nummer)
                } else {
                    stringResource(R.string.vouchers_balance_progress,
                        (lauf.erledigt + 1).toString(), lauf.gesamt.toString(), lauf.nummer)
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        // Kein eigener Knopf für den Stapel-Import: Die Datei geht über das Feld im
        // Formular, und der Server entscheidet, ob daraus einer oder zwanzig werden.
        if (zustand.gutscheine.isEmpty() && !zustand.laedt && zustand.fehler != null) {
            FehlerHinweis(zustand.fehler, onErneut)
        } else if (zustand.gutscheine.isEmpty() && !zustand.laedt) {
            Text(
                stringResource(R.string.vouchers_empty),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        // Dass Antippen kopiert, sieht man einem Text nicht an; deshalb der Hinweis über
        // der Liste, wo man ihn vor dem ersten Antippen liest.
        if (zustand.gutscheine.isNotEmpty()) {
            Text(
                stringResource(R.string.vouchers_copy_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

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
        if (breit) {
            zustand.gutscheine.chunked(2).forEach { paar ->
                Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    paar.forEach { karte(it, Modifier.weight(1f).fillMaxHeight()) }
                    if (paar.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        } else zustand.gutscheine.forEach { karte(it, Modifier.fillMaxWidth()) }

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

    val frage = zustand.bestaetigung
    if (frage != null) {
        val nummer = zustand.gutscheine.find { it.id == frage.id }?.number.orEmpty()
        val loeschen = frage.schritt == GutscheinSchritt.LOESCHEN
        val pdf = frage.schritt == GutscheinSchritt.PDF ||
            frage.schritt == GutscheinSchritt.EXPORT
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
            onAbbrechen = onBestaetigungAbbrechen,
        )
    }

    if (neu || zustand.bearbeitet != null) {
        GutscheinFormularBlatt(
            zustand = zustand,
            pdfGewaehlt = pdfUri != null,
            onFeld = onFeld,
            onPdfWaehlen = { auswahl.launch(arrayOf("application/pdf")) },
            onSpeichern = { gesendet = true; onSpeichern(pdfUri); pdfUri = null },
            onSchliessen = { neu = false; pdfUri = null; if (zustand.bearbeitet != null) onAbbrechen() },
        )
    }
}
