package ch.brickinventoryapp.ui.theme

import ch.brickinventoryapp.ui.components.fokusRahmen
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/**
 * Formen und Erhebungen an einer Stelle, wie die Farben über `colorScheme`: „Mach
 * die Karten runder“ soll eine Zeile sein, nicht vierzehn Fundstellen. Nicht an
 * `MaterialTheme(shapes = …)` gehängt, weil das auch alle Bauteile umformte, die
 * heute die Material3-Vorgabe benutzen.
 */
object Formen {
    /**
     * Der Eckenradius der Leiste, geteilt von [leiste] und [kachelBildEcken]: Das
     * Kachelbild sitzt oben bündig in der Karte; verschiedene Radien liessen es
     * überstehen oder einen Spalt.
     */
    private val leisteRadius = 14.dp

    /** Karten und Abschnitte. */
    val karte = RoundedCornerShape(16.dp)
    /** Chips (Filter, Auswahl) — die häufigste Form im Baum. */
    val chip = RoundedCornerShape(20.dp)
    /**
     * Eingabefelder. Knöpfe haben keine eigene Form: Sie tragen alle die Pille der
     * Material-Vorgabe, damit Einrichten, Anmelden und Dialoge gleich aussehen
     * (DesignTokensTest verbietet `shape =` an Knöpfen).
     */
    val feld = RoundedCornerShape(12.dp)
    /** Kachelbilder und kleinere Flächen. */
    val kachel = RoundedCornerShape(10.dp)
    /** Hinweisleisten und eingebettete Flächen. */
    val leiste = RoundedCornerShape(leisteRadius)
    /** Etiketten und kleine Marken. */
    val etikett = RoundedCornerShape(8.dp)
    /** Sehr kleine Marken (Zustandspunkte, Zähler). */
    val marke = RoundedCornerShape(6.dp)
    /** Schwebende Aktionsknöpfe (FAB) in Galerie, Teile, Minifiguren. */
    val fab = RoundedCornerShape(18.dp)
    /** Trennstriche und Fortschrittsbalken — fast eckig. */
    val strich = RoundedCornerShape(2.dp)

    /** Die oberen Ecken eines Kachelbildes — passt zwingend zu [leiste]. */
    val kachelBildEcken = RoundedCornerShape(topStart = leisteRadius, topEnd = leisteRadius)

    /**
     * Masse einer Bestandskachel (Teile- und Minifiguren-Reiter): Beide zeigen
     * dieselbe Rasterbreite, und nur hier stehen die Zahlen, damit keine still
     * abweicht.
     */
    val kachelBreite = 112.dp
    /**
     * Höhe der Bestandskachel, nachgerechnet für den schlimmsten Fall bei bodySmall
     * (16 dp Zeilenhöhe):
     * Ausführlich: docs/begruendungen/core-ui/ui/theme/Formen.kt.md#kachelhoehe
     */
    val kachelHoehe  = 208.dp

    /** Erhebung einer flachen Karte (Listen, Abschnitte). */
    val karteErhebung = 1.dp
    /** Erhebung einer hervorgehobenen Karte (Anmeldung, Dialoge, Kennzahlen). */
    val karteErhebungHoch = 2.dp
}

/**
 * Die Kartenhülle — Form, Erhebung, Flächenfarbe, volle Breite. Der Innenabstand
 * bleibt beim Aufrufer, weil er sich an den Fundstellen unterschied.
 */
@Composable
fun AppKarte(
    modifier: Modifier = Modifier,
    /**
     * Antippbar machen. Material3 hat dafür eine eigene `Card`-Überladung mit
     * Wellenanzeige; ein `clickable` an der unantippbaren Fassung sähe anders aus.
     */
    onClick: (() -> Unit)? = null,
    /** Was das Antippen tut, für TalkBack („Doppeltippen, um Details zu öffnen“). */
    onClickLabel: String? = null,
    inhalt: @Composable ColumnScope.() -> Unit
) {
    val form = Formen.karte
    val erhebung = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebung)
    val farben = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    if (onClick == null) {
        Card(modifier = modifier.fillMaxWidth(), shape = form,
             elevation = erhebung, colors = farben, content = inhalt)
    } else {
        // Card(onClick) setzt keine Rolle; TalkBack nannte die Kachel nicht als Knopf.
        val bedienung = Modifier.fokusRahmen(form).semantics {
            role = Role.Button
            onClick(label = onClickLabel) { onClick(); true }
        }
        Card(onClick = onClick, modifier = modifier.fillMaxWidth().then(bedienung), shape = form,
             elevation = erhebung, colors = farben, content = inhalt)
    }
}

/**
 * Farben mit Bedeutung, die das Material-Schema nicht kennt („erfolgreich“,
 * „Warnung“) — einmal festgelegt statt verstreut, damit sie mit dem Design
 * mitziehen. Die Werte je Design stehen in statusFarbenFuer() in Theme.kt.
 */
data class StatusFarben(
    val erfolg: Color,
    val warnung: Color,
    val fehler: Color,
)

val LocalStatusFarben = staticCompositionLocalOf {
    StatusFarben(
        erfolg  = Color(0xFF166534),
        warnung = Color(0xFFE3B341),
        fehler  = Color(0xFFB91C1C),
    )
}
