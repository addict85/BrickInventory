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
 * Eine CSV-Datei hochladen — Sets, Teile, Minifiguren oder die Merkliste, über
 * dieselben Adressen wie die Webapp. Der Fortschritt danach kommt über den
 * bestehenden Kanal: Der Import läuft auf dem Server weiter, auch wenn die App
 * zugeklappt wird.
 *
 * FlowRow statt Row: Vier Knöpfe mit weight(1f) teilten sich die Breite, und
 * „Minifiguren“ würde auf einem Telefon abgeschnitten. FlowRow bricht um wie bei
 * den Netzschaltern in MonitoringSections.kt. Ohne weight(1f), weil es in einer
 * FlowRow jeden Knopf auf eine eigene Zeile streckte; die Knöpfe nehmen die Breite
 * ihres Textes.
 */
// Kurzname, nicht vollqualifiziert: `import androidx.compose.foundation.layout.*`
// macht FlowRow und diese Annotation verfügbar, und SplitFileImportsTest liest aus
// @OptIn(...) den kurzen Namen („ExperimentalLayoutApi“). Mit dem vollen Pfad sähe
// die Regel ihren Marker nicht.
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun CsvImportCard(
    csvZustand: ch.brickinventoryapp.ui.CsvHochladenUiState,
    onDatei: (ch.brickinventoryapp.ui.model.CsvImportArt, android.net.Uri) -> Unit,
    onSchliessen: () -> Unit,
) {
    // Welche Art beim Antippen gemeint war — der Dateiauswahl-Vertrag liefert nur den
    // Uri, nicht den Knopf. rememberSaveable, nicht remember: Die Dateiauswahl ist
    // eine fremde Anwendung, währenddessen darf das System diesen Vorgang beenden;
    // fiele der Wert auf SETS zurück, landete eine Teile-Datei in der falschen Tabelle
    // (BildschirmZustandTest).
    var gewaehlteArt by rememberSaveable { mutableStateOf(ch.brickinventoryapp.ui.model.CsvImportArt.SETS) }
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
                ch.brickinventoryapp.ui.model.CsvImportArt.SETS to R.string.csv_upload_sets,
                ch.brickinventoryapp.ui.model.CsvImportArt.TEILE to R.string.csv_upload_parts,
                ch.brickinventoryapp.ui.model.CsvImportArt.MINIFIGUREN to R.string.csv_upload_figs,
                ch.brickinventoryapp.ui.model.CsvImportArt.MERKLISTE to R.string.csv_upload_wanted,
                ch.brickinventoryapp.ui.model.CsvImportArt.PREISALARME to R.string.csv_upload_alerts,
            ).forEach { (art, textId) ->
                OutlinedButton(
                    onClick = { gewaehlteArt = art; auswahl.launch(typen) },
                    enabled = !csvZustand.laeuft,
                    shape = Formen.knopf,
                    contentPadding = PaddingValues(horizontal = Abstaende.klein)
                ) {
                    // Der Kreisel steht neben der Beschriftung, nicht an ihrer Stelle: Ohne weight
                    // (in der FlowRow) schrumpfte der Knopf sonst während des Imports auf
                    // Kreiselgrösse und schöbe die anderen beiseite (KnopfBreiteTest). Dasselbe
                    // Muster wie beim Knopf „Nach Aktualisierung suchen“.
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
                // Vier Zahlen, im Englischen stimmen zwei davon überein („row/rows“,
                // „error/errors“). Ein <plurals> stimmt nur mit einer überein, darum vier
                // Bruchstücke in einem Rahmen — auch „neu“ und „aktualisiert“, damit der Rahmen
                // kein %d trägt, das Lint beanstandet.
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
