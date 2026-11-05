package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
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
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Sync
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import ch.brickinventoryapp.ui.viewmodel.eingabeUeberMaske

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
    val schutz = ch.brickinventoryapp.ui.components.LocalSchrittschutz.current
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
                Icon(Icons.Default.Add, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)))
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
                else Icon(Icons.Default.Sync, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)))
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
                Icon(Icons.Default.PictureAsPdf, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)))
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
            ch.brickinventoryapp.ui.components.FehlerHinweis(zustand.fehler, onErneut)
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
        val summe = ch.brickinventoryapp.ui.gutscheinSumme(zustand.gutscheine)
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
        val loeschen = frage.schritt == ch.brickinventoryapp.ui.GutscheinSchritt.LOESCHEN
        val pdf = frage.schritt == ch.brickinventoryapp.ui.GutscheinSchritt.PDF ||
            frage.schritt == ch.brickinventoryapp.ui.GutscheinSchritt.EXPORT
        ch.brickinventoryapp.ui.components.PasswortRueckfrage(
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

/** Das Formular zum Anlegen und Ändern als Blatt von unten. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun GutscheinFormularBlatt(
    zustand: GutscheinUiState,
    pdfGewaehlt: Boolean,
    onFeld: (nummer: String?, pin: String?, betrag: String?, waehrung: String?) -> Unit,
    onPdfWaehlen: () -> Unit,
    onSpeichern: () -> Unit,
    onSchliessen: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onSchliessen) {
      Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState())
            .padding(horizontal = Abstaende.gross).padding(bottom = Abstaende.sehrGross),
        verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
      ) {
        Text(
            stringResource(if (zustand.bearbeitet != null) R.string.vouchers_edit else R.string.vouchers_add),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )

        // Filter UND Tastatur gehoeren zusammen — die Tastaturwahl ist eine
        // Bitte an die Tastatur-App, keine Zusicherung: Eine angestoepselte
        // Tastatur und die Zwischenablage liefern trotzdem Buchstaben. Die
        // Regel steht in ZahlentastaturTest, der Filter in NumericInput.kt.
        // Ausführlich: docs/begruendungen/feature-finanzen/ui/screens/GutscheineCard.kt.md#nummermaske
        val nummerMaske = ch.brickinventoryapp.ui.model.istMaskierteNummer(zustand.nummer)
        OutlinedTextField(
            shape = ch.brickinventoryapp.ui.theme.Formen.feld,
            value = zustand.nummer,
            onValueChange = {
                onFeld(NumericInput.quantity(eingabeUeberMaske(zustand.nummer, it, nummerMaske)), null, null, null)
            },
            label = { Text(stringResource(R.string.vouchers_number)) },
            supportingText = if (nummerMaske) { { Text(stringResource(R.string.vouchers_mask_hint)) } } else null,
            singleLine = true,
            keyboardOptions = NumericInput.ganzzahlTastatur(),
            modifier = Modifier.fillMaxWidth(),
        )

        Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            val pinMaske = zustand.pin == ch.brickinventoryapp.ui.model.PIN_MASKE_ANZEIGE
            OutlinedTextField(
                shape = ch.brickinventoryapp.ui.theme.Formen.feld,
                value = zustand.pin,
                onValueChange = { onFeld(null, NumericInput.quantity(eingabeUeberMaske(zustand.pin, it, pinMaske)), null, null) },
                label = { Text(stringResource(R.string.vouchers_pin)) },
                singleLine = true,
                keyboardOptions = NumericInput.ganzzahlTastatur(),
                modifier = Modifier.weight(1f),
            )
            OutlinedTextField(
                shape = ch.brickinventoryapp.ui.theme.Formen.feld,
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

        WaehrungsWahl(zustand.waehrung) { onFeld(null, null, null, it) }

        // ── Der PDF-Weg ──
        //
        // Nur beim Anlegen: Ein Gutschein bekommt sein PDF einmal.
        if (zustand.bearbeitet == null) {
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                OutlinedButton(onClick = onPdfWaehlen, colors = nebenKnopfFarben(), border = nebenKnopfRand()) {
                    Icon(Icons.Default.UploadFile, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)))
                    Spacer(Modifier.width(Abstaende.klein))
                    Text(stringResource(R.string.vouchers_pick_pdf))
                }
                if (pdfGewaehlt) {
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
            )
        }

        Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            verticalAlignment = Alignment.CenterVertically) {
            Button(onClick = onSpeichern, enabled = !zustand.speichert) { Text(stringResource(R.string.settings_save)) }
            TextButton(onClick = onSchliessen) { Text(stringResource(R.string.common_cancel)) }
            if (zustand.speichert) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            }
        }
      }
    }
}

/**
 * Ein Gutschein als Karte: links Nummer (in Vierergruppen, weil neunzehn Ziffern an
 * der Kasse nicht abzulesen sind), Betrag und Stand der Abfrage, rechts ein Menü mit
 * Guthaben, PDF, Bearbeiten und Löschen. Nummer und PIN kopiert ein Tipp. Jede
 * Aktion geht über GENAU EINEN Rückruf; die Gerätesperre davor setzt GutscheineCard
 * (geschuetzt).
 */
@Composable
private fun GutscheinKarte(
    g: GutscheinAnsicht,
    pinSichtbar: Boolean,
    onPinSchalten: () -> Unit,
    onBearbeiten: () -> Unit,
    onLoeschen: () -> Unit,
    onPdfOeffnen: () -> Unit,
    onKopieren: (istNummer: Boolean) -> Unit,
    onGuthaben: () -> Unit,
    guthabenLaeuft: Boolean,
    /** Nummer und PIN im Klartext, wenn sie auf dieser Seite schon geholt sind. */
    klartext: ch.brickinventoryapp.ui.model.KlartextAnsicht?,
    modifier: Modifier = Modifier,
) {
    var menue by rememberSaveable { mutableStateOf(false) }
    // Die ganze Nummer nur bei aufgedecktem PIN; sonst die Maske des Servers.
    val nummer = inVierergruppen(if (pinSichtbar && klartext != null) klartext.number else g.number)

    OutlinedCard(modifier) {
      Column(Modifier.padding(start = Abstaende.mittel, top = Abstaende.winzig, bottom = Abstaende.klein),
             verticalArrangement = Arrangement.spacedBy(Abstaende.haar)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // Kopiert wird der Klartext ohne Vierergruppen: Ein Bezahlfeld nimmt sie nicht an.
            KopierZeile(stringResource(R.string.vouchers_cd_copy_number, nummer), { onKopieren(true) },
                Modifier.weight(1f)) {
                Text(nummer, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            }
            Box {
                ch.brickinventoryapp.ui.components.MitTooltip(stringResource(R.string.vouchers_cd_menu, nummer)) {
                    IconButton(onClick = { menue = true }) {
                        if (guthabenLaeuft) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        else Icon(Icons.Default.MoreVert, stringResource(R.string.vouchers_cd_menu, nummer))
                    }
                }
                DropdownMenu(menue, { menue = false }) {
                    // Guthaben NUR mit PIN: LEGO fragt Nummer UND PIN ab; ohne PIN wäre
                    // der Eintrag eine Falle, die immer dieselbe Absage erzeugt.
                    if (g.pin != null) MenueEintrag(stringResource(R.string.vouchers_menu_balance),
                        stringResource(R.string.vouchers_cd_balance, nummer), Icons.Default.Sync,
                        enabled = !guthabenLaeuft) { menue = false; onGuthaben() }
                    if (g.hatPdf) MenueEintrag(stringResource(R.string.vouchers_menu_pdf),
                        stringResource(R.string.vouchers_cd_pdf, nummer), Icons.Default.PictureAsPdf) {
                        menue = false; onPdfOeffnen()
                    }
                    MenueEintrag(stringResource(R.string.common_edit),
                        stringResource(R.string.vouchers_cd_edit, nummer), Icons.Default.Edit) { menue = false; onBearbeiten() }
                    MenueEintrag(stringResource(R.string.common_delete),
                        stringResource(R.string.vouchers_cd_delete, nummer), Icons.Default.Delete) { menue = false; onLoeschen() }
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            modifier = Modifier.padding(end = Abstaende.mittel)) {
            Text(fmtMoney(g.amount, g.currency), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            // Der Stand der Abfrage als Etikett und im Wort, nicht nur als Farbe.
            val stand = fmtTag(g.guthabenGeprueftAm)
            Surface(shape = ch.brickinventoryapp.ui.theme.Formen.etikett, color = MaterialTheme.colorScheme.surfaceContainerHigh) {
                Text(
                    if (stand != null) stringResource(R.string.vouchers_balance_as_of, stand)
                    else stringResource(R.string.vouchers_balance_never),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = Abstaende.klein, vertical = Abstaende.haar),
                )
            }
        }
        val pin = g.pin
        if (pin != null) Row(verticalAlignment = Alignment.CenterVertically) {
            // Der PIN ist auch VERDECKT antippbar: Kopieren heisst nicht ansehen.
            val pinText = stringResource(R.string.vouchers_pin) + ": " + if (pinSichtbar) klartext?.pin ?: pin else "••••"
            KopierZeile(stringResource(R.string.vouchers_cd_copy_pin, nummer), { onKopieren(false) }) {
                Text(pinText, style = MaterialTheme.typography.bodyMedium)
            }
            val pinSchalter = stringResource(if (pinSichtbar) R.string.vouchers_pin_hide else R.string.vouchers_pin_show)
            ch.brickinventoryapp.ui.components.MitTooltip(pinSchalter) {
                IconButton(onClick = onPinSchalten) {
                    // In primary wie das Kopiersymbol daneben: gleichrangige Handlungen, eine Farbe.
                    Icon(
                        if (pinSichtbar) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        contentDescription = pinSchalter,
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
      }
    }
}

/** Ein Eintrag im Gutscheinmenü: sichtbarer Text, vorgelesen mit der Nummer. */
@Composable
private fun MenueEintrag(
    text: String,
    beschreibung: String,
    symbol: androidx.compose.ui.graphics.vector.ImageVector,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    DropdownMenuItem(
        text = { Text(text) },
        onClick = onClick,
        enabled = enabled,
        leadingIcon = { Icon(symbol, null) },
        modifier = Modifier.semantics { contentDescription = beschreibung },
    )
}

/**
 * Eine antippbare Zeile, die etwas kopiert: mindestens 48 dp hoch, mit sichtbarem
 * Kopiersymbol am Ende. Die Beschreibung nennt, WAS kopiert wird.
 */
@Composable
private fun KopierZeile(
    beschreibung: String,
    onKopieren: () -> Unit,
    modifier: Modifier = Modifier,
    inhalt: @Composable RowScope.() -> Unit,
) {
    Row(
        modifier.heightIn(min = 48.dp)
            .clickable(role = Role.Button, onClickLabel = beschreibung, onClick = onKopieren)
            .semantics(mergeDescendants = true) { contentDescription = beschreibung }
            .padding(end = Abstaende.klein),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
    ) {
        inhalt()
        // Dieselbe Grösse an Nummer und PIN (vorher 24 und 18 dp).
        Icon(Icons.Default.ContentCopy, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)), tint = MaterialTheme.colorScheme.primary)
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
            shape = ch.brickinventoryapp.ui.theme.Formen.feld,
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
