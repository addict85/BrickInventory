package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.model.GutscheinAnsicht
import ch.brickinventoryapp.ui.GutscheinUiState
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.util.NumericInput
import ch.brickinventoryapp.util.fmtTag
import ch.brickinventoryapp.util.fmtMoney
import ch.brickinventoryapp.util.inVierergruppen

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
      BoxWithConstraints {
        // Ab Tabletbreite Liste links, Formular rechts wie die Set-Detailseite: untereinander
        // stand das Formular auf voller Breite unter einer langen Liste.
        val breit = maxWidth >= 720.dp
        val spalte = Arrangement.spacedBy(Abstaende.klein)
        val liste: @Composable ColumnScope.() -> Unit = {

        // ── Guthaben aller Karten abfragen ──
        //
        // Der Fortschritt steht daneben im Text: Bei einer Abfrage je 30 Sekunden dauern
        // vier Karten gut anderthalb Minuten, und ein nur ausgegrauter Knopf sagt nicht,
        // ob noch etwas passiert. Deshalb auch der Abbrechen-Knopf.
        val lauf = zustand.guthabenLauf
        // Beide Sammelaktionen in einer umbrechenden Reihe: untereinander sahen sie aus
        // wie zwei Abschnitte.
        FlowRow(verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
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
            OutlinedButton(onClick = onExportieren,
                           enabled = zustand.gutscheine.isNotEmpty()) {
                Icon(Icons.Default.PictureAsPdf, null, Modifier.size(18.dp))
                Spacer(Modifier.width(Abstaende.klein))
                Text(stringResource(R.string.vouchers_export))
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

        // Das PDF aller Gutscheine (oben neben „Guthaben abfragen“) öffnet im
        // PdfViewerScreen. Ohne Gutscheine ist der Knopf aus: Der Server antwortete mit
        // 404, und ein Betrachter mit Fehlermeldung wäre der umständlichste Weg zu „du
        // hast noch keine“.

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

        // Dass Antippen kopiert, sieht man einem Text nicht an — anders als in der
        // Webapp, wo ein Knopf mit Symbol danebensteht. Deshalb der Hinweis, ÜBER der
        // Liste, wo man ihn vor dem ersten Antippen liest.
        if (zustand.gutscheine.isNotEmpty()) {
            Text(
                stringResource(R.string.vouchers_copy_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        zustand.gutscheine.forEachIndexed { i, g ->
            if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
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


        // Die Summe — nur bei EINER Waehrung (gutscheinSumme).
        val summe = ch.brickinventoryapp.ui.gutscheinSumme(zustand.gutscheine)
        if (summe != null) {
            HorizontalDivider(Modifier.padding(vertical = Abstaende.klein))
            BezeichnungUndWert(stringResource(R.string.vouchers_total), fmtMoney(summe.first.toDouble(), summe.second),
                wertGewicht = FontWeight.Bold)
        }

        }
        val formular: @Composable ColumnScope.() -> Unit = {
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
        if (breit) Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.sehrGross)) {
            Column(Modifier.weight(1f), verticalArrangement = spalte, content = liste)
            Column(Modifier.weight(1f), verticalArrangement = spalte, content = formular)
        } else Column(verticalArrangement = spalte) {
            liste()
            HorizontalDivider(Modifier.padding(vertical = Abstaende.mittel))
            formular()
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
    g: GutscheinAnsicht,
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
        // Vierergruppen nicht annimmt. Die ganze Zeile ist die Fläche (mindestens 48 dp
        // hoch), das Kopiersymbol sagt, was ein Tipp tut.
        val nummer = inVierergruppen(g.number)
        KopierZeile(stringResource(R.string.vouchers_cd_copy_number, nummer), { onKopieren(g.number, true) }) {
            Text(nummer, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium,
                modifier = Modifier.weight(1f))
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                fmtMoney(g.amount, g.currency),
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.width(Abstaende.klein))
            // Der Stand der Guthaben-Abfrage im Wort, nicht in einer Farbe (FarbeAlleinTest).
            // `if` statt `?.let { stringResource(…) }`: stringResource ist @Composable, und in
            // einer fremden Lambda hinge es am Einbetten durch den Compose-Compiler.
            val stand = fmtTag(g.guthabenGeprueftAm)
            Text(
                if (stand != null) stringResource(R.string.vouchers_balance_as_of, stand)
                else stringResource(R.string.vouchers_balance_never),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            val pinText = stringResource(R.string.vouchers_pin) + ": " +
                (g.pin?.let { if (pinSichtbar) it else "••••" } ?: "–")
            // Der PIN ist auch VERDECKT antippbar: Kopieren heisst nicht ansehen, und wer
            // ihn einfügen will, muss ihn dafür nicht erst aufdecken.
            val pin = g.pin
            if (pin != null) {
                KopierZeile(stringResource(R.string.vouchers_cd_copy_pin, nummer), { onKopieren(pin, false) }) {
                    Text(pinText, style = MaterialTheme.typography.bodySmall)
                }
            } else Text(pinText, style = MaterialTheme.typography.bodySmall)
            // Ohne `Modifier.size(...)`: IconButton bringt von sich aus
            // 48 dp Antippflaeche mit (minimumInteractiveComponentSize). Sie
            // kleiner zu zeichnen waere ein Eintrag in TouchTargetSizeTest —
            // hier gibt es keinen Grund dafuer, die Zeile hat Platz.
            if (g.pin != null) {
                IconButton(onClick = onPinSchalten) {
                    Icon(
                        if (pinSichtbar) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        stringResource(if (pinSichtbar) R.string.vouchers_pin_hide else R.string.vouchers_pin_show),
                    )
                }
            } else Spacer(Modifier.size(LEERE_STELLE))
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
                        CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Default.Refresh, stringResource(R.string.vouchers_cd_balance, nummer))
                    }
                }
            } else Spacer(Modifier.size(LEERE_STELLE))
            // Fehlende Knöpfe lassen ihren Platz frei: So stehen Bearbeiten und Löschen in
            // jeder Zeile an derselben Stelle.
            if (g.hatPdf) {
                IconButton(onClick = onPdfOeffnen) {
                    Icon(Icons.Default.PictureAsPdf, stringResource(R.string.vouchers_cd_pdf, nummer))
                }
            } else Spacer(Modifier.size(LEERE_STELLE))
            IconButton(onClick = onBearbeiten) {
                Icon(Icons.Default.Edit, stringResource(R.string.vouchers_cd_edit, nummer))
            }
            IconButton(onClick = { loeschFrage = true }) {
                Icon(Icons.Default.Delete, stringResource(R.string.vouchers_cd_delete, nummer))
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

/**
 * Eine antippbare Zeile, die etwas kopiert: mindestens 48 dp hoch, mit sichtbarem
 * Kopiersymbol am Ende. Die Beschreibung nennt, WAS kopiert wird.
 */
@Composable
private fun KopierZeile(beschreibung: String, onKopieren: () -> Unit, inhalt: @Composable RowScope.() -> Unit) {
    Row(
        Modifier.heightIn(min = 48.dp)
            .clickable(role = Role.Button, onClickLabel = beschreibung, onClick = onKopieren)
            .semantics(mergeDescendants = true) { contentDescription = beschreibung }
            .padding(end = Abstaende.klein),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
    ) {
        inhalt()
        Icon(Icons.Default.ContentCopy, null, tint = MaterialTheme.colorScheme.primary)
    }
}

/** Die Breite eines IconButton (48 dp), für Zeilen ohne diesen Knopf. */
private val LEERE_STELLE = 48.dp

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
