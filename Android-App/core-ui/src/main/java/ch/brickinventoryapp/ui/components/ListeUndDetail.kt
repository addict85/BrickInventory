package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarColors
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ressourcen.R

/**
 * Der Schlüssel des Eintrags, dessen Detail gerade daneben steht — die Liste markiert
 * seine Kachel. Als Local statt Parameter, weil die Liste ihn nur im Zweierbild braucht.
 */
val LocalOffenesDetail = staticCompositionLocalOf<String?> { null }

/**
 * Liste links, Detail rechts — auf breiten Fenstern ([ch.brickinventoryapp.ui.listeUndDetail]).
 * Die Liste behält gut zwei Fünftel, damit ihr Raster zwei Spalten hat; das Detail
 * bekommt den Rest und bleibt damit einspaltig lesbar. Ob nebeneinander, entscheidet
 * der Aufrufer am Fenster, weil auch das Gerüst (Seitenleiste) davon abhängt.
 */
@Composable
fun ListeUndDetail(
    modifier: Modifier = Modifier,
    liste: @Composable () -> Unit,
    detail: @Composable () -> Unit,
) {
    Row(modifier.fillMaxSize()) {
        Box(Modifier.weight(0.42f).fillMaxHeight()) { liste() }
        VerticalDivider()
        Box(Modifier.weight(0.58f).fillMaxHeight()) {
            CompositionLocalProvider(LocalImDetailBereich provides true) { detail() }
        }
    }
}

/**
 * Steht der Bildschirm als rechte Hälfte neben seiner Liste? Dann schliesst sein
 * Knopf oben nur das Detail, und ein Zurück-Pfeil versprach eine Seite, die es nicht
 * gibt — Material zeigt ihn in Liste und Detail nur einspaltig.
 */
val LocalImDetailBereich = staticCompositionLocalOf { false }

/**
 * Der Schlüssel, unter dem eine Liste ihr offenes Detail erkennt ([LocalOffenesDetail]).
 * Teile tragen die Farbe mit, weil dieselbe Nummer in mehreren Farben eine eigene Kachel hat.
 */
fun detailSchluessel(art: String, nummer: String, farbe: Int? = null) = "$art|$nummer|${farbe ?: ""}"

/**
 * Der Knopf oben links einer Detailseite: Zurück auf eigener Seite, Schliessen neben der
 * Liste oder im Blatt ([schliessen]). Immer links, damit man ihn in keinem Bereich sucht.
 */
@Composable
fun ZurueckKnopf(onClick: () -> Unit, schliessen: Boolean = LocalImDetailBereich.current) {
    val text = stringResource(if (schliessen) R.string.detail_close else R.string.common_back)
    MitTooltip(text) {
        IconButton(onClick = onClick) {
            Icon(if (schliessen) Icons.Default.Close else Icons.AutoMirrored.Filled.ArrowBack, contentDescription = text)
        }
    }
}

/**
 * Der Kopf jeder Detailansicht: Zurück bzw. Schliessen links, der Name als Überschrift,
 * Aktionen rechts. Ein langer Name bricht in eine zweite Zeile, und die Leiste wächst mit —
 * mit einer Zeile stand bei 200 % nur der Anfang da.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DetailTopAppBar(
    titel: String,
    onZurueck: () -> Unit,
    untertitel: String? = null,
    schliessen: Boolean = LocalImDetailBereich.current,
    farben: TopAppBarColors = TopAppBarDefaults.topAppBarColors(),
    actions: @Composable RowScope.() -> Unit = {},
) {
    var zeilen by remember { mutableIntStateOf(1) }
    val dichte = LocalDensity.current
    val typo = MaterialTheme.typography
    val hoehe = with(dichte) {
        typo.titleLarge.lineHeight.toDp() * zeilen + (if (untertitel != null) typo.bodySmall.lineHeight.toDp() else 0.dp)
    } + Abstaende.gross * 2
    TopAppBar(
        title = {
            Column {
                // Bei grosser Schrift drei Zeilen: Ein Teilename mit 30 Zeichen brauchte sie bei 200 %.
                Text(titel, fontWeight = FontWeight.SemiBold, maxLines = if (grosseSchrift()) 3 else 2, overflow = TextOverflow.Ellipsis,
                    onTextLayout = { zeilen = it.lineCount }, modifier = Modifier.semantics { heading() })
                if (untertitel != null) Text(untertitel, style = typo.bodySmall, maxLines = 1,
                    overflow = TextOverflow.Ellipsis)
            }
        },
        expandedHeight = maxOf(TopAppBarDefaults.TopAppBarExpandedHeight, hoehe),
        navigationIcon = { ZurueckKnopf(onZurueck, schliessen) },
        actions = actions,
        colors = farben,
    )
}
