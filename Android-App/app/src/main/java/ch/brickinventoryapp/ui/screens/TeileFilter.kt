package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.brickinventoryapp.R

/**
 * Ein Filtereintrag der Teileliste: Wert, Beschriftung, Anzahl, Farbpunkt.
 *
 * Eine gemeinsame Form fuer Farbe UND Kategorie. Die beiden Listen kommen von
 * verschiedenen Adressen und tragen verschiedene Feldnamen, sehen aber gleich
 * aus und werden gleich bedient — genau die Stelle, an der in diesem Baum
 * sonst zwei Fassungen entstehen, die auseinanderlaufen.
 *
 * @param wert   Was als `color=` bzw. `category=` mitreist. "" heisst „alle".
 * @param anzahl Verschiedene Teile — dieselbe Zahl, die die Webapp zeigt.
 * @param farbe  Farbpunkt, nur bei der Farbliste.
 */
data class TeileFilterEintrag(
    val wert: String,
    val text: String,
    val anzahl: Int,
    val farbe: Color? = null,
)

/**
 * Farbe und Kategorie als zwei aufklappbare Filter.
 *
 * ── Warum es das jetzt gibt (Nachtrag 134) ──────────────────────────────────
 *
 * Die Webapp hat im Teile-Reiter zwei Filterlisten (03-parts.js,
 * `loadPartsFilters` → `#color-filter` und `#cat-filter`), jede mit der Anzahl
 * daneben. Die App bot ausschliesslich die Suche. Gefunden durch Messen: Ein
 * Vergleich der Server-Adressen beider Clients nannte 21 Adressen, die nur die
 * Webapp ruft — darunter /parts/colors und /parts/categories.
 *
 * Die Leitung lag bereits: `getParts` deklariert `@Query("color")` und
 * `@Query("category")` seit jeher, und das Repository reicht beide durch. Nur
 * gesetzt hat sie nie jemand.
 *
 * ── Warum ein Blatt statt einer langen Liste ────────────────────────────────
 *
 * Die Webapp hat eine Seitenspalte und zeigt beide Listen dauerhaft. Auf dem
 * Telefon waeren das zwei Bloecke, die den Bestand nach unten schieben. Ein
 * Chip mit der aktuellen Wahl und ein Blatt zum Aendern ist derselbe Weg, den
 * der Katalog fuer sein Thema geht (CatalogThemeSheet).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TeileFilterZeile(
    farben: List<TeileFilterEintrag>,
    kategorien: List<TeileFilterEintrag>,
    farbeGewaehlt: String,
    kategorieGewaehlt: String,
    onFarbe: (String) -> Unit,
    onKategorie: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    // Nichts geladen, nichts anzubieten: Ein Chip „Farbe" ohne Inhalt waere ein
    // Versprechen, das das Antippen nicht einloest.
    if (farben.isEmpty() && kategorien.isEmpty()) return

    var offenFarbe by rememberSaveable { mutableStateOf(false) }
    var offenKategorie by rememberSaveable { mutableStateOf(false) }

    val alle = stringResource(R.string.parts_filter_all)
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (farben.isNotEmpty()) {
            FilterChip(
                selected = farbeGewaehlt.isNotBlank(),
                onClick = { offenFarbe = true },
                label = {
                    Text(farben.firstOrNull { it.wert == farbeGewaehlt }?.text
                        ?: stringResource(R.string.parts_filter_color),
                        fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                },
                trailingIcon = { Icon(Icons.Default.ArrowDropDown, null, Modifier.size(18.dp)) },
            )
        }
        if (kategorien.isNotEmpty()) {
            FilterChip(
                selected = kategorieGewaehlt.isNotBlank(),
                onClick = { offenKategorie = true },
                label = {
                    Text(kategorien.firstOrNull { it.wert == kategorieGewaehlt }?.text
                        ?: stringResource(R.string.parts_filter_category),
                        fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                },
                trailingIcon = { Icon(Icons.Default.ArrowDropDown, null, Modifier.size(18.dp)) },
            )
        }
    }

    if (offenFarbe) {
        FilterBlatt(
            titel = stringResource(R.string.parts_filter_color),
            eintraege = farben, gewaehlt = farbeGewaehlt, alleText = alle,
            onWahl = { offenFarbe = false; onFarbe(it) },
            onSchliessen = { offenFarbe = false },
        )
    }
    if (offenKategorie) {
        FilterBlatt(
            titel = stringResource(R.string.parts_filter_category),
            eintraege = kategorien, gewaehlt = kategorieGewaehlt, alleText = alle,
            onWahl = { offenKategorie = false; onKategorie(it) },
            onSchliessen = { offenKategorie = false },
        )
    }
}

/**
 * Das Auswahlblatt — eine Fassung fuer beide Listen.
 *
 * „Alle" steht oben und ist immer da; ohne diesen Eintrag liesse sich ein
 * gesetzter Filter nur ueber den Zurueck-Weg wieder loswerden.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FilterBlatt(
    titel: String,
    eintraege: List<TeileFilterEintrag>,
    gewaehlt: String,
    alleText: String,
    onWahl: (String) -> Unit,
    onSchliessen: () -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onSchliessen) {
        Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 24.dp)) {
            Text(titel, fontWeight = FontWeight.Bold, fontSize = 17.sp)
            LazyColumn(Modifier.heightIn(max = 420.dp)) {
                item {
                    FilterZeile(alleText, null, null, gewaehlt.isBlank()) { onWahl("") }
                }
                items(eintraege.size, key = { eintraege[it].wert }) { i ->
                    val e = eintraege[i]
                    FilterZeile(e.text, e.anzahl, e.farbe, e.wert == gewaehlt) { onWahl(e.wert) }
                }
            }
        }
    }
}

/** Eine Zeile des Auswahlblatts. */
@Composable
private fun FilterZeile(
    text: String,
    anzahl: Int?,
    farbe: Color?,
    gewaehlt: Boolean,
    onKlick: () -> Unit,
) {
    Surface(
        onClick = onKlick,
        color = if (gewaehlt) MaterialTheme.colorScheme.primaryContainer
                else MaterialTheme.colorScheme.surface,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(horizontal = 8.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (farbe != null) {
                Box(Modifier.size(14.dp).clip(CircleShape).background(farbe))
                Spacer(Modifier.width(8.dp))
            }
            Text(text, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis,
                fontWeight = if (gewaehlt) FontWeight.Bold else FontWeight.Normal)
            if (anzahl != null) {
                Text(ch.brickinventoryapp.util.fmtInt(anzahl),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.15f))
}
