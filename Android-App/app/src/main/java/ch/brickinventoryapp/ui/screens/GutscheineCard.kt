package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.PictureAsPdf
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

/**
 * Gutscheine — LEGO-Geschenkkarten im eigenen Profil.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 *   „Im Eigenen Profil sollen Lego-Gutscheine mit Gutscheinnummer und Pins und
 *    Betrag hinterlegt werden können. […] Die Erfassung, Änderung und Anzeige
 *    soll sowohl in der Android-App als auch in der Webapp möglich sein und
 *    möglichst einfach erreichbar sein."
 *
 * Deshalb steht die Karte bei den Einstellungen, direkt neben dem Konto —
 * dieselbe Stelle wie in der Webapp, wo sie unter den Profil-Einstellungen
 * sitzt.
 *
 * ── Warum eine eigene Datei ─────────────────────────────────────────────────
 *
 * SettingsScreen.kt hat 1448 Zeilen. Eine weitere Karte dort hinein waere der
 * naechste Schritt zu einer Datei, die niemand mehr ueberblickt; die anderen
 * grossen Karten (Haushalt, Konto, CSV) stehen aus demselben Grund schon in
 * eigenen Funktionen.
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
) {
    // Die gewaehlte Datei lebt nur, solange das Formular offen ist — sie
    // gehoert nicht in den geteilten Zustand, weil eine Uri eine Berechtigung
    // dieses Bildschirms ist und kein Datum des Kontos.
    // rememberSaveable und nicht remember: Die gewaehlte Datei ist eine WAHL
    // des Menschen (Sorte 1 in BildschirmZustandTest) und soll eine Drehung
    // ueberstehen — sonst ist sie nach dem Kippen des Telefons weg, und zwar
    // ohne Hinweis. Eine Uri ist Parcelable, der Standard-Saver kann sie.
    var pdfUri by rememberSaveable { mutableStateOf<android.net.Uri?>(null) }
    val auswahl = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.OpenDocument()
    ) { uri -> pdfUri = uri }

    SettingsCard(title = stringResource(R.string.vouchers_title), icon = Icons.Default.Redeem) {

        if (zustand.gutscheine.isEmpty() && !zustand.laedt) {
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

        // Die Summe — nur bei EINER Waehrung. Betraege in verschiedenen
        // Waehrungen zusammenzuzaehlen waere schlimmer als gar keine Summe,
        // weil das Ergebnis richtig aussieht und keines ist.
        val waehrungen = zustand.gutscheine.map { it.currency }.toSet()
        if (zustand.gutscheine.isNotEmpty() && waehrungen.size == 1) {
            HorizontalDivider(Modifier.padding(vertical = Abstaende.klein))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(stringResource(R.string.vouchers_total),
                     style = MaterialTheme.typography.bodySmall,
                     color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("%.2f %s".format(zustand.gutscheine.sumOf { it.amount }, waehrungen.first()),
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

        // ── Der PDF-Weg ────────────────────────────────────────────────────
        //
        // Nur beim ANLEGEN. Ein Gutschein bekommt sein PDF einmal; es
        // nachtraeglich auszutauschen waere ein eigener Vorgang und
        // beantwortet keine Frage, die jemand hat.
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
 * Eine Zeile.
 *
 * Die Nummer in Vierergruppen: Neunzehn Ziffern am Stueck sind an der Kasse
 * nicht abzulesen, und genau dafuer ist sie da.
 *
 * Bedeutung haengt nirgends an der FARBE — jeder Knopf traegt ein Symbol und
 * eine Beschreibung fuer den Bildschirmleser, der verdeckte PIN steht als
 * Punkte da und nicht als graues Feld.
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
) {
    var loeschFrage by rememberSaveable { mutableStateOf(false) }

    Column(Modifier.fillMaxWidth().padding(vertical = Abstaende.klein)) {
        // ── Marcos Vorgabe ──────────────────────────────────────────────────
        //
        //   „Wenn ich in der Android-App den Gutscheincode oder den Pin
        //    anklicke, soll dieser kopiert werden."
        //
        // Kopiert wird die ROHE Nummer, nicht die in Vierergruppen gezeigte:
        // Die Gruppierung ist eine Lesehilfe fuers Abtippen an der Kasse — ein
        // Bezahlfeld nimmt sie nicht an.
        //
        // `clickable` auf dem Text und kein eigener Knopf: Marco hat das Feld
        // selbst als Ziel genannt, und ein zusaetzlicher Knopf je Zeile waere
        // in der Webapp richtig (dort gibt es keine Beruehrung) und hier eine
        // Verdoppelung. Die Antippflaeche wird dafuer bis zur vollen Breite
        // aufgezogen, damit sie nicht nur die Ziffern selbst trifft.
        Text(
            g.number.chunked(4).joinToString(" "),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            modifier = Modifier
                .fillMaxWidth()
                .clickable { onKopieren(g.number, true) }
                .padding(vertical = Abstaende.winzig),
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "%.2f %s".format(g.amount, g.currency),
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Bold,
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
                    Modifier.clickable { onKopieren(g.pin, false) }
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
