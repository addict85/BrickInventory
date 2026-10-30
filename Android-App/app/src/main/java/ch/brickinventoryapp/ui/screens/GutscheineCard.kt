package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Redeem
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.Gutschein
import ch.brickinventoryapp.ui.GutscheinUiState
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.util.NumericInput
import ch.brickinventoryapp.util.fmtDatum

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
    /** Nummer oder PIN in die Zwischenablage; `istNummer` steuert die Meldung. */
    onKopieren: (wert: String, istNummer: Boolean) -> Unit,
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
) {
    // Die gewählte Datei lebt nur im Formular — eine Uri ist eine Berechtigung dieses
    // Bildschirms, kein Datum des Kontos. rememberSaveable, weil sie eine Wahl des
    // Menschen ist und eine Drehung überstehen soll; Uri ist Parcelable.
    var pdfUri by rememberSaveable { mutableStateOf<android.net.Uri?>(null) }
    val auswahl = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.OpenDocument()
    ) { uri -> pdfUri = uri }
    SettingsCard(title = stringResource(R.string.vouchers_title), icon = Icons.Default.Redeem) {

        // ── Guthaben aller Karten abfragen ──
        //
        // Der Fortschritt steht daneben im Text: Bei einer Abfrage je 30 Sekunden dauern
        // vier Karten gut anderthalb Minuten, und ein nur ausgegrauter Knopf sagt nicht,
        // ob noch etwas passiert. Deshalb auch der Abbrechen-Knopf.
        val lauf = zustand.guthabenLauf
        Row(verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            modifier = Modifier.padding(bottom = Abstaende.klein)) {
            OutlinedButton(
                onClick = onGuthabenAlle,
                enabled = lauf == null && zustand.gutscheine.any { !it.pin.isNullOrBlank() },
            ) {
                // Kreisel NEBEN der Beschriftung, nicht an ihrer Stelle:
                // KnopfBreiteTest faengt das andere, und es ist auch das
                // bessere Verhalten.
                if (lauf != null) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(Abstaende.winzig))
                }
                Text(stringResource(R.string.vouchers_balance_all))
            }
            if (lauf != null) {
                TextButton(onClick = onGuthabenAbbrechen) {
                    Text(stringResource(R.string.common_cancel))
                }
            }
        }
        if (lauf != null) {
            // Zwei verschiedene Auskuenfte, und sie stehen nacheinander:
            // welche Karte gerade dran ist — und, falls die Schranke bremst,
            // wie lange es noch dauert.
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
                modifier = Modifier.padding(bottom = Abstaende.klein),
            )
        }

        // ── Alle Gutscheine als ein PDF ──
        //
        // Angezeigt im vorhandenen PdfViewerScreen wie die anderen PDFs, mit Drucken und
        // Speichern. Ohne Gutscheine ist der Knopf aus: Der Server antwortete mit 404, und
        // ein Betrachter mit Fehlermeldung wäre der umständlichste Weg zu „du hast noch
        // keine“.
        Row(verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            modifier = Modifier.padding(bottom = Abstaende.klein)) {
            OutlinedButton(onClick = onExportieren,
                           enabled = zustand.gutscheine.isNotEmpty()) {
                Icon(Icons.Default.PictureAsPdf, null, Modifier.size(18.dp))
                Spacer(Modifier.width(Abstaende.klein))
                Text(stringResource(R.string.vouchers_export))
            }
        }

        // Kein eigener Knopf für den Stapel-Import: Die Datei geht über das Feld im
        // Erfassen-Formular, und der Server entscheidet, ob daraus einer oder zwanzig
        // werden — wie in der Webapp. Kein Export-Knopf: Der Export ist eine Datei zum
        // Behalten, und die App kann Dateien nicht speichern oder weitergeben (NUR_WEB in
        // test/webapp-endpunkte.test.js).

        if (zustand.gutscheine.isEmpty() && !zustand.laedt && zustand.fehler != null) {
            ch.brickinventoryapp.ui.components.FehlerHinweis(zustand.fehler, onErneut)
        } else if (zustand.gutscheine.isEmpty() && !zustand.laedt) {
            Text(
                stringResource(R.string.vouchers_empty),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        for (g in zustand.gutscheine) {
            GutscheinZeile(
                g = g,
                pinSichtbar = g.id in zustand.pinSichtbar,
                onPinSchalten = { onPinSchalten(g.id) },
                onBearbeiten = { onBearbeiten(g.id) },
                onLoeschen = { onLoeschen(g.id) },
                onPdfOeffnen = { onPdfOeffnen(g.id) },
                onKopieren = onKopieren,
                onGuthaben = { onGuthaben(g.id) },
                guthabenLaeuft = zustand.guthabenLaeuft == g.id,
            )
        }

        // Dass Antippen kopiert, sieht man einem Text nicht an — anders als
        // der Webapp, wo ein Knopf mit Symbol danebensteht. Deshalb der
        // Hinweis, und nur solange es ueberhaupt etwas zu kopieren gibt.
        if (zustand.gutscheine.isNotEmpty()) {
            Text(
                stringResource(R.string.vouchers_copy_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = Abstaende.winzig),
            )
        }

        // Die Summe — nur bei EINER Waehrung (gutscheinSumme).
        val summe = ch.brickinventoryapp.ui.gutscheinSumme(zustand.gutscheine)
        if (summe != null) {
            HorizontalDivider(Modifier.padding(vertical = Abstaende.klein))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(stringResource(R.string.vouchers_total),
                     style = MaterialTheme.typography.bodySmall,
                     color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("${summe.first.toPlainString()} ${summe.second}",
                     style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
            }
        }

        HorizontalDivider(Modifier.padding(vertical = Abstaende.mittel))

        Text(
            stringResource(if (zustand.bearbeitet != null) R.string.vouchers_edit else R.string.vouchers_add),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = Abstaende.klein),
        )

        // Filter UND Tastatur gehoeren zusammen — die Tastaturwahl ist eine
        // Bitte an die Tastatur-App, keine Zusicherung: Eine angestoepselte
        // Tastatur und die Zwischenablage liefern trotzdem Buchstaben. Die
        // Regel steht in ZahlentastaturTest, der Filter in NumericInput.kt.
        OutlinedTextField(
            value = zustand.nummer,
            onValueChange = { onFeld(NumericInput.quantity(it), null, null, null) },
            label = { Text(stringResource(R.string.vouchers_number)) },
            singleLine = true,
            keyboardOptions = NumericInput.ganzzahlTastatur(),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(Abstaende.klein))

        Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            OutlinedTextField(
                value = zustand.pin,
                onValueChange = { onFeld(null, NumericInput.quantity(it), null, null) },
                label = { Text(stringResource(R.string.vouchers_pin)) },
                singleLine = true,
                keyboardOptions = NumericInput.ganzzahlTastatur(),
                modifier = Modifier.weight(1f),
            )
            OutlinedTextField(
                value = zustand.betrag,
                onValueChange = { onFeld(null, null, NumericInput.price(it), null) },
                label = { Text(stringResource(R.string.vouchers_amount)) },
                singleLine = true,
                // price/preisTastatur und nicht ganzzahl: Ein Gutschein kann
                // auf Rappen lauten. `price` laesst GENAU EIN Trennzeichen zu
                // — „12.3.4" waere sonst tippbar und floege erst beim
                // Umwandeln auf, dann als stiller Nullbetrag.
                keyboardOptions = NumericInput.preisTastatur(),
                modifier = Modifier.weight(1f),
            )
        }
        Spacer(Modifier.height(Abstaende.klein))

        WaehrungsWahl(zustand.waehrung) { onFeld(null, null, null, it) }

        // ── Der PDF-Weg ──
        //
        // Nur beim Anlegen: Ein Gutschein bekommt sein PDF einmal.
        if (zustand.bearbeitet == null) {
            Spacer(Modifier.height(Abstaende.mittel))
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                OutlinedButton(onClick = { auswahl.launch(arrayOf("application/pdf")) }) {
                    Icon(Icons.Default.UploadFile, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(Abstaende.klein))
                    Text(stringResource(R.string.vouchers_pick_pdf))
                }
                if (pdfUri != null) {
                    Text(
                        stringResource(R.string.vouchers_pdf_chosen),
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1, overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            Text(
                stringResource(R.string.vouchers_pdf_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = Abstaende.haar),
            )
        }

        Spacer(Modifier.height(Abstaende.mittel))
        Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            verticalAlignment = Alignment.CenterVertically) {
            Button(
                onClick = { onSpeichern(pdfUri); pdfUri = null },
                enabled = !zustand.speichert,
            ) { Text(stringResource(R.string.settings_save)) }
            if (zustand.bearbeitet != null) {
                TextButton(onClick = onAbbrechen) { Text(stringResource(R.string.common_cancel)) }
            }
            if (zustand.speichert) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            }
        }
    }
}

/**
 * Eine Zeile. Die Nummer in Vierergruppen, weil neunzehn Ziffern an der Kasse
 * nicht abzulesen sind. Nichts hängt an der Farbe: Jeder Knopf trägt Symbol und
 * Beschreibung, der verdeckte PIN steht als Punkte da.
 */
@Composable
private fun GutscheinZeile(
    g: Gutschein,
    pinSichtbar: Boolean,
    onPinSchalten: () -> Unit,
    onBearbeiten: () -> Unit,
    onLoeschen: () -> Unit,
    onPdfOeffnen: () -> Unit,
    onKopieren: (wert: String, istNummer: Boolean) -> Unit,
    onGuthaben: () -> Unit,
    guthabenLaeuft: Boolean,
) {
    var loeschFrage by rememberSaveable { mutableStateOf(false) }

    // Eigener Abstand: Eine Gutscheinzeile ist ein Kind der Karte, und der
    // Abstand, den die Karte zwischen ihre Kinder legt, wirkt darin nicht —
    // Nummer, Betrag und PIN stünden sonst dicht aufeinander.
    Column(Modifier.fillMaxWidth().padding(vertical = Abstaende.klein),
           verticalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
        // Antippen kopiert Nummer oder PIN — die rohe Nummer, weil ein Bezahlfeld die
        // Vierergruppen nicht annimmt. `clickable` auf dem Text statt eines eigenen Knopfs
        // je Zeile; die Fläche geht über die volle Breite.
        Text(
            g.number.chunked(4).joinToString(" "),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            modifier = Modifier
                .fillMaxWidth()
                .clickable(role = Role.Button) { onKopieren(g.number, true) }
                .padding(vertical = Abstaende.winzig),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "%.2f %s".format(g.amount, g.currency),
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.width(Abstaende.klein))
            // Der Stand der Guthaben-Abfrage im Wort, nicht in einer Farbe (FarbeAlleinTest).
            // `if` statt `?.let { stringResource(…) }`: stringResource ist @Composable, und in
            // einer fremden Lambda hinge es am Einbetten durch den Compose-Compiler.
            val stand = fmtDatum(g.guthabenGeprueftAm)
            Text(
                if (stand != null) stringResource(R.string.vouchers_balance_as_of, stand)
                else stringResource(R.string.vouchers_balance_never),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                stringResource(R.string.vouchers_pin) + ": " +
                    (g.pin?.let { if (pinSichtbar) it else "••••" } ?: "–"),
                style = MaterialTheme.typography.bodySmall,
                // Der PIN ist auch VERDECKT antippbar: Kopieren heisst nicht
                // ansehen, und wer ihn einfuegen will, muss ihn dafuer nicht
                // erst aufdecken.
                modifier = if (g.pin != null)
                    Modifier.clickable(role = Role.Button) { onKopieren(g.pin, false) }
                            .padding(vertical = Abstaende.winzig)
                else Modifier,
            )
            // Ohne `Modifier.size(...)`: IconButton bringt von sich aus
            // 48 dp Antippflaeche mit (minimumInteractiveComponentSize). Sie
            // kleiner zu zeichnen waere ein Eintrag in TouchTargetSizeTest —
            // hier gibt es keinen Grund dafuer, die Zeile hat Platz.
            if (g.pin != null) {
                IconButton(onClick = onPinSchalten) {
                    Icon(
                        if (pinSichtbar) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        stringResource(if (pinSichtbar) R.string.vouchers_pin_hide else R.string.vouchers_pin_show),
                        Modifier.size(18.dp),
                    )
                }
            }
            Spacer(Modifier.weight(1f))
            // Guthaben abfragen — NUR mit PIN: LEGO fragt Nummer UND PIN ab,
            // und ein Knopf, der ohne PIN immer dieselbe Absage erzeugt, waere
            // eine Falle. Ohne PIN steht in der Zeile ohnehin schon „–".
            if (g.pin != null) {
                // Kreisel an der Stelle des Symbols: Ein IconButton hat eine feste Grösse, es
                // rutscht nichts. Die Zeilen stehen vor dem Knopf, damit IconButtonLabelTest die
                // Beschriftung innerhalb von zehn Zeilen findet.
                IconButton(onClick = onGuthaben, enabled = !guthabenLaeuft) {
                    if (guthabenLaeuft) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Default.Refresh,
                             stringResource(R.string.vouchers_balance_one),
                             Modifier.size(18.dp))
                    }
                }
            }
            if (g.hatPdf) {
                IconButton(onClick = onPdfOeffnen) {
                    Icon(Icons.Default.PictureAsPdf, stringResource(R.string.vouchers_pdf_open),
                         Modifier.size(18.dp))
                }
            }
            IconButton(onClick = onBearbeiten) {
                Icon(Icons.Default.Edit, stringResource(R.string.common_edit), Modifier.size(18.dp))
            }
            IconButton(onClick = { loeschFrage = true }) {
                Icon(Icons.Default.Delete, stringResource(R.string.common_delete), Modifier.size(18.dp))
            }
        }
    }

    if (loeschFrage) {
        AlertDialog(
            onDismissRequest = { loeschFrage = false },
            title = { Text(stringResource(R.string.common_delete)) },
            // Die Nummer steht in der Frage: Bei mehreren Gutscheinen ist
            // sonst nicht zu sehen, welcher gerade verschwindet.
            text = { Text(stringResource(R.string.vouchers_delete_confirm, g.number)) },
            confirmButton = {
                TextButton(onClick = { loeschFrage = false; onLoeschen() }) {
                    Text(stringResource(R.string.common_delete))
                }
            },
            dismissButton = {
                TextButton(onClick = { loeschFrage = false }) {
                    Text(stringResource(R.string.common_cancel))
                }
            },
        )
    }
}

/** Dieselben Waehrungen wie in der Webapp (public/index.html). */
private val WAEHRUNGEN = listOf("CHF", "EUR", "USD", "GBP", "SEK", "NOK", "AUD", "CAD", "DKK")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WaehrungsWahl(gewaehlt: String, onWahl: (String) -> Unit) {
    var offen by rememberSaveable { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = offen, onExpandedChange = { offen = it }) {
        OutlinedTextField(
            value = gewaehlt,
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.settings_currency)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = offen) },
            modifier = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable, true).fillMaxWidth(),
        )
        ExposedDropdownMenu(expanded = offen, onDismissRequest = { offen = false }) {
            for (w in WAEHRUNGEN) {
                DropdownMenuItem(text = { Text(w) }, onClick = { onWahl(w); offen = false })
            }
        }
    }
}
