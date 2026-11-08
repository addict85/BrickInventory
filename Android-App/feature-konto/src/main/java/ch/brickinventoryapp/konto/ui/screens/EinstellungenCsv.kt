package ch.brickinventoryapp.konto.ui.screens

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
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import ch.brickinventoryapp.ui.components.Abschnitt
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.konto.ui.*
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.zustand.ui.*
import kotlinx.coroutines.launch
import ch.brickinventoryapp.konto.ui.CsvHochladenUiState
import ch.brickinventoryapp.model.ui.model.CsvImportArt
import ch.brickinventoryapp.konto.ui.viewmodel.CSV_MAX_BYTES

/**
 * Eine CSV-Datei hochladen — Sets, Teile, Minifiguren, Merkliste oder Preisalarme,
 * über dieselben Adressen wie die Webapp. Der Fortschritt danach kommt über den
 * bestehenden Kanal: Der Import läuft auf dem Server weiter, auch wenn die App
 * zugeklappt wird.
 * Ausführlich: docs/begruendungen/feature-konto/konto/ui/screens/EinstellungenCsv.kt.md#csvimportcard
 */
@Composable
internal fun CsvImportCard(
    csvZustand: CsvHochladenUiState,
    onDatei: (CsvImportArt, android.net.Uri) -> Unit,
    onSchliessen: () -> Unit,
) {
    // Welche Art beim Antippen gemeint war — der Dateiauswahl-Vertrag liefert nur den
    // Uri, nicht den Knopf. rememberSaveable, nicht remember: Die Dateiauswahl ist
    // eine fremde Anwendung, währenddessen darf das System diesen Vorgang beenden;
    // fiele der Wert auf SETS zurück, landete eine Teile-Datei in der falschen Tabelle.
    var gewaehlteArt by rememberSaveable { mutableStateOf(CsvImportArt.SETS) }
    val auswahl = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.OpenDocument()
    ) { uri -> if (uri != null) onDatei(gewaehlteArt, uri) }

    // `text/*` UND `text/comma-separated-values`: Manche Dateiverwaltungen
    // geben einer .csv den Typ `application/vnd.ms-excel`, andere gar keinen.
    // Zu eng gefiltert waere die Datei in der Auswahl ausgegraut, ohne dass
    // erkennbar ist, warum.
    val typen = arrayOf("text/csv", "text/comma-separated-values", "text/plain",
                        "application/vnd.ms-excel", "application/octet-stream")

    Text(
        stringResource(R.string.csv_upload_hint,
            (CSV_MAX_BYTES / 1024 / 1024).toInt()),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant)

    Abschnitt(titel = null, innenAbstand = false) {
        listOf(
            CsvArt(CsvImportArt.SETS, R.string.csv_upload_sets, R.string.csv_desc_sets, R.string.csv_format_sets),
            CsvArt(CsvImportArt.TEILE, R.string.csv_upload_parts, R.string.csv_desc_parts, R.string.csv_format_parts),
            CsvArt(CsvImportArt.MINIFIGUREN, R.string.csv_upload_figs, R.string.csv_desc_figs, R.string.csv_format_figs),
            CsvArt(CsvImportArt.MERKLISTE, R.string.csv_upload_wanted, R.string.csv_desc_wanted, R.string.csv_format_wanted),
            CsvArt(CsvImportArt.PREISALARME, R.string.csv_upload_alerts, R.string.csv_desc_alerts, R.string.csv_format_alerts),
        ).forEachIndexed { i, (art, titel, inhalt, spalten) ->
            if (i > 0) HorizontalDivider()
            ListItem(
                headlineContent = { Text(stringResource(titel)) },
                // Erst auf Deutsch, was drinsteht; die Spaltennamen der Datei leiser darunter
                // für den, der sie von Hand anlegt. Roh standen sie wie Programmtext da.
                supportingContent = {
                    Column {
                        Text(stringResource(inhalt), style = MaterialTheme.typography.bodySmall)
                        Text(stringResource(spalten), style = MaterialTheme.typography.bodySmall,
                            fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
                leadingContent = { Icon(Icons.Default.UploadFile, null, tint = MaterialTheme.colorScheme.primary) },
                // Der Kreisel steht an der Zeile, deren Import läuft — die anderen bleiben ruhig.
                trailingContent = if (csvZustand.laeuft && csvZustand.art == art) {
                    { CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) }
                } else null,
                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                modifier = Modifier.clickable(enabled = !csvZustand.laeuft, role = Role.Button) {
                    gewaehlteArt = art; auswahl.launch(typen)
                }.alpha(if (csvZustand.laeuft && csvZustand.art != art) 0.6f else 1f),
            )
        }
    }
    CsvRueckmeldung(csvZustand, onSchliessen)
}

/** Was der letzte Import gebracht hat, oder warum er scheiterte; beides lässt sich schliessen. */
@Composable
private fun CsvRueckmeldung(csvZustand: CsvHochladenUiState, onSchliessen: () -> Unit) {
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

/** Eine Importart: was sie ist, was drinsteht (Klartext) und wie die Spalten der Datei heissen. */
private data class CsvArt(
    val art: CsvImportArt,
    val titel: Int,
    val inhalt: Int,
    val spalten: Int,
)
