package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.theme.Abstaende
import kotlinx.coroutines.launch

/**
 * Eine CSV-Datei hochladen — Sets, Teile, Minifiguren oder die Merkliste.
 *
 * Dieselben Adressen, die die Webapp anbietet. Die App konnte Importe
 * bisher nur beobachten (der Fortschrittsbalken oben in der Galerie); starten
 * konnte sie keinen, weil die Dateiauswahl fehlte und die Routen an einem
 * sitzungsgebundenen Waechter hingen (Nachtrag 127/128).
 *
 * Der Fortschritt DANACH kommt weiterhin ueber den bestehenden Kanal: Der
 * Import laeuft auf dem Server weiter, auch wenn die App zugeklappt wird.
 *
 * ── Warum FlowRow und nicht mehr Row ───────────────────────────────────────
 *
 * Mit der Merkliste sind es VIER Knoepfe. In einer Row mit weight(1f) teilen
 * sie sich die Breite zu gleichen Teilen, und „Minifiguren" passt dann auf
 * einem Telefon nicht mehr hinein — maxLines = 1 schneidet es ab, und was
 * abgeschnitten dasteht, liest niemand richtig. FlowRow bricht stattdessen
 * um; dieselbe Loesung wie bei den Netzschaltern in MonitoringSections.kt.
 *
 * Kein weight(1f) mehr: In einer FlowRow fuehrte es dazu, dass jeder Knopf
 * die ganze Zeile fuellt und damit jeder in seiner eigenen steht. Die Knoepfe
 * nehmen jetzt die Breite ihres Textes.
 */
// Kurzname, nicht vollqualifiziert: Die Datei hat oben
// `import androidx.compose.foundation.layout.*`, also sind sowohl FlowRow als
// auch diese Annotation bereits im Zugriff — und SplitFileImportsTest liest
// aus @OptIn(...) genau den KURZEN Namen („ExperimentalLayoutApi"). Mit dem
// vollen Paketpfad uebersetzt es zwar, aber die Regel sieht ihren Marker nicht
// und meldet die Datei als „nutzt FlowRow ohne @OptIn". GEMESSEN: Genau daran
// war die Android-CI im zweiten Lauf noch rot.
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun CsvImportCard(
    csvZustand: ch.brickinventoryapp.ui.CsvHochladenUiState,
    onDatei: (ch.brickinventoryapp.data.model.CsvArt, android.net.Uri) -> Unit,
    onSchliessen: () -> Unit,
) {
    // Welche Art beim Antippen gemeint war. Der Dateiauswahl-Vertrag liefert
    // nur den Uri zurueck, nicht den Knopf — also muss die App es sich merken.
    //
    // rememberSaveable und NICHT remember: Die Dateiauswahl ist eine fremde
    // Anwendung. Waehrend sie oben liegt, darf das System diesen Vorgang
    // beenden; kommt der Nutzer mit einer Teile-Datei zurueck und der Wert ist
    // auf SETS zurueckgefallen, landet sie in der falschen Tabelle. Genau
    // dieser Unterschied ist die Regel von BildschirmZustandTest, und der
    // oertliche Spiegel hat die Stelle prompt gemeldet.
    var gewaehlteArt by rememberSaveable { mutableStateOf(ch.brickinventoryapp.data.model.CsvArt.SETS) }
    val auswahl = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.OpenDocument()
    ) { uri -> if (uri != null) onDatei(gewaehlteArt, uri) }

    // `text/*` UND `text/comma-separated-values`: Manche Dateiverwaltungen
    // geben einer .csv den Typ `application/vnd.ms-excel`, andere gar keinen.
    // Zu eng gefiltert waere die Datei in der Auswahl ausgegraut, ohne dass
    // erkennbar ist, warum.
    val typen = arrayOf("text/csv", "text/comma-separated-values", "text/plain",
                        "application/vnd.ms-excel", "application/octet-stream")

    SettingsCard(title = stringResource(R.string.csv_upload_title), icon = Icons.Default.UploadFile) {
        Text(
            stringResource(R.string.csv_upload_hint,
                (ch.brickinventoryapp.ui.viewmodel.CSV_MAX_BYTES / 1024 / 1024).toInt()),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)

        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
            modifier = Modifier.fillMaxWidth()
        ) {
            listOf(
                ch.brickinventoryapp.data.model.CsvArt.SETS to R.string.csv_upload_sets,
                ch.brickinventoryapp.data.model.CsvArt.TEILE to R.string.csv_upload_parts,
                ch.brickinventoryapp.data.model.CsvArt.MINIFIGUREN to R.string.csv_upload_figs,
                ch.brickinventoryapp.data.model.CsvArt.MERKLISTE to R.string.csv_upload_wanted,
                ch.brickinventoryapp.data.model.CsvArt.PREISALARME to R.string.csv_upload_alerts,
            ).forEach { (art, textId) ->
                OutlinedButton(
                    onClick = { gewaehlteArt = art; auswahl.launch(typen) },
                    enabled = !csvZustand.laeuft,
                    shape = Formen.knopf,
                    contentPadding = PaddingValues(horizontal = Abstaende.klein)
                ) {
                    // Der Kreisel steht NEBEN der Beschriftung, nicht an ihrer
                    // Stelle. Vorher tauschte ein if/else das eine gegen das
                    // andere; das ging nur gut, solange weight(1f) die Breite
                    // festhielt. Ohne weight (seit der FlowRow) schrumpfte der
                    // Knopf waehrend des Imports auf Kreiselgroesse und schob
                    // die drei anderen beiseite.
                    //
                    // Genau das faengt KnopfBreiteTest, und es hat es gefangen:
                    // Die Android-CI war rot, und der Befund war richtig. Das
                    // Muster hier steht dreissig Zeilen weiter unten in dieser
                    // Datei schon einmal (Knopf „Nach Aktualisierung suchen").
                    if (csvZustand.laeuft && csvZustand.art == art) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(Abstaende.winzig))
                    }
                    Text(stringResource(textId), maxLines = 1,
                        style = MaterialTheme.typography.labelLarge)
                }
            }
        }

        val ergebnis = csvZustand.ergebnis
        if (ergebnis != null) {
            Text(
                // Vier Zahlen, und im Englischen stimmen zwei davon ueberein
                // („row/rows", „error/errors"). Ein <plurals> stimmt nur mit
                // EINER ueberein, darum vier Bruchstuecke in einem Rahmen —
                // auch „neu" und „aktualisiert", damit der Rahmen KEIN %d mehr
                // traegt und Lint ihn nicht gleich wieder beanstandet.
                stringResource(R.string.csv_upload_result,
                    pluralStringResource(R.plurals.csv_upload_rows, ergebnis.total, ergebnis.total),
                    pluralStringResource(R.plurals.csv_upload_new, ergebnis.neuAngelegt, ergebnis.neuAngelegt),
                    pluralStringResource(R.plurals.csv_upload_updated, ergebnis.updated, ergebnis.updated),
                    pluralStringResource(R.plurals.csv_upload_errors, ergebnis.errors, ergebnis.errors)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.primary)
            TextButton(onClick = onSchliessen) { Text(stringResource(R.string.csv_upload_close)) }
        }
        if (csvZustand.fehler != null) {
            Text(csvZustand.fehler, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
            TextButton(onClick = onSchliessen) { Text(stringResource(R.string.csv_upload_close)) }
        }
    }
}
