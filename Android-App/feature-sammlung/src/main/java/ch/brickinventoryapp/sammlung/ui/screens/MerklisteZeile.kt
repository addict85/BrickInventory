package ch.brickinventoryapp.sammlung.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.draw.clip
import ch.brickinventoryapp.model.ui.model.MerkpostenAnsicht
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.*
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import ch.brickinventoryapp.ressourcen.R
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.model.util.resolveThumbUrl
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.Alarm
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.gemeinsam.ui.InfoPlakette

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun MerkpostenZeile(
    w: MerkpostenAnsicht, serverUrl: String, imageLoader: coil3.ImageLoader,
    gewaehlt: Boolean,
    onOeffnen: () -> Unit,
    /** Im Raster mit Nachbarn: gleiche Höhe erzwingen. Auf dem Telefon nicht — dort blieb eine Leerzeile. */
    mehrspaltig: Boolean = false,
) {
    // Die ganze Karte öffnet das Detail — wie die Kachel in der Galerie. Sie
    // trägt keinen Knopf, tut also auf ihrer ganzen Fläche dasselbe;
    // Übernehmen und Löschen stehen im Detail. Steht das Detail daneben, trägt
    // die geöffnete Karte einen Rahmen in der Hauptfarbe.
    Card(
        Modifier.fillMaxWidth()
            .semantics { selected = gewaehlt }
            .clickable(role = Role.Button, onClick = onOeffnen),
        border = if (gewaehlt) BorderStroke(2.dp, MaterialTheme.colorScheme.primary) else null,
        // Dieselbe Karte wie Galerie und Finanzen (AppKarte): Die graue Fläche der
        // Vorgabe-Card war ein dritter Kartenstil für dieselbe Ebene.
        shape = Formen.karte,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebung),
    ) {
        // Ohne Preis im Cache war der Preisjob seit dem Eintragen noch nicht da. „Preis
        // folgt“ steht dann in der Zeile mit Nummer und Jahr: Allein rechts unten liess es
        // eine leere Zeile in der Karte.
        val preis = w.marktpreis
        Column(Modifier.padding(Abstaende.mittel), verticalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                verticalAlignment = Alignment.CenterVertically) {
                ProduktBild(
                    model = resolveThumbUrl(serverUrl, w.imageLocal, w.imageUrl),
                    contentDescription = null,
                    imageLoader = imageLoader,
                    modifier = Modifier.size(Abstaende.riesig + Abstaende.sehrGross).clip(MaterialTheme.shapes.small),
                    ersatzGroesse = 28.dp,
                    bildgrund = true,
                )
                Column(Modifier.weight(1f)) {
                    // Kein Name heisst: Der Katalog kennt das Set nicht. Der
                    // benannte Preis dafuer, dass die Merkliste keine zweite
                    // Kopie der Stammdaten fuehrt (Migration 0021).
                    // Immer zwei Zeilen Platz wie in der Galerie: Im Tablet-Raster stand eine
                    // Karte mit kurzem Namen niedriger als ihre Nachbarn.
                    Text(w.name ?: w.setNumber, fontWeight = FontWeight.SemiBold, minLines = if (mehrspaltig) 2 else 1, maxLines = 2,
                        overflow = TextOverflow.Ellipsis)
                    Text(
                        listOfNotNull(
                            w.setNumber,
                            w.year?.toString(),
                            stringResource(if (w.condition == "U") R.string.condition_used
                                           else R.string.condition_new),
                            if (preis == null) stringResource(R.string.detail_price_none_yet) else null,
                        ).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            // FlowRow: Bei grosser Schrift rückt der Preis unter die Plaketten, statt sie zu quetschen.
            // Mindesthöhe einer Plakette, auch ohne Inhalt: Karten mit und ohne Plakette sind gleich hoch.
            FlowRow(if (mehrspaltig) Modifier.heightIn(min = 32.dp) else Modifier,
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                    verticalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
                w.alarm?.let { a ->
                    InfoPlakette(
                        stringResource(if (a.richtung == "ueber") R.string.wanted_alert_above else R.string.wanted_alert_below,
                                       fmtMoney(a.schwelle, w.waehrung)),
                        icon = if (a.ausgeloest) Icons.Default.NotificationsActive else Icons.Default.Alarm,
                    )
                }
                // „Habe ich das inzwischen?" meint das BLICKFELD: Beim
                // Grossvater heisst „ich habe es" auch „der Enkel hat es".
                if (w.owned) InfoPlakette(stringResource(R.string.wanted_owned), icon = Icons.Default.Check)
                Spacer(Modifier.weight(1f))
                // Marktpreis statt Knopf: In die Sammlung übernommen wird im Merkposten-Detail.
                if (preis != null) {
                    Text(fmtMoney(preis, w.waehrung), fontWeight = FontWeight.Bold,
                         maxLines = 1, softWrap = false, modifier = Modifier.align(Alignment.CenterVertically))
                }
            }
        }
    }
}

/** Mindestbreite einer Spalte der Merkliste. */
internal val MERKLISTE_SPALTE = 340.dp
