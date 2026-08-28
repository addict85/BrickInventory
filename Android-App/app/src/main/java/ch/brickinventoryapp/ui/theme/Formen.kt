package ch.brickinventoryapp.ui.theme

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
 * Formen und Erhebungen an EINER Stelle.
 *
 * ── Warum es das gibt (Nachtrag 120) ─────────────────────────────────────────
 *
 * Im Baum standen 129 fest eingetragene `RoundedCornerShape(N.dp)` in neun
 * verschiedenen Radien, und die Kartenoptik
 *
 *     shape = RoundedCornerShape(16.dp),
 *     elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
 *     colors = CardDefaults.cardColors(containerColor = …surface)
 *
 * stand siebenmal wörtlich da. „Mach die Karten runder" hiess damit: vierzehn
 * Stellen suchen und hoffen, keine zu übersehen.
 *
 * Auffällig war das, weil die FARBEN es längst richtig machen — zwei Designs
 * über `colorScheme`, Diagrammfarben über [LocalChartColors]. Formen und
 * Erhebungen waren von dieser Sorgfalt ausgenommen.
 *
 * Die Werte hier sind ZAHLENGLEICH mit dem, was vorher dastand. Dieser Nachtrag
 * verschiebt nur, wo sie stehen — er ändert nichts am Aussehen. Ein Design
 * ändert man danach, in einem eigenen Schritt, den man auch ansehen kann.
 *
 * BEWUSST NICHT an `MaterialTheme(shapes = …)` gehängt: Das würde auch alle
 * Bauteile umformen, die HEUTE keine Form angeben und deshalb die
 * Material3-Vorgabe benutzen — eine Änderung, die sich ohne Gerät nicht
 * beurteilen lässt. Der Schritt bleibt offen und ist dann eine Zeile.
 */
object Formen {
    /** Karten und Abschnitte. */
    val karte = RoundedCornerShape(16.dp)
    /** Chips (Filter, Auswahl) — die häufigste Form im Baum. */
    val chip = RoundedCornerShape(20.dp)
    /** Knöpfe und Eingabefelder. */
    val knopf = RoundedCornerShape(12.dp)
    /** Kachelbilder und kleinere Flächen. */
    val kachel = RoundedCornerShape(10.dp)
    /** Hinweisleisten und eingebettete Flächen. */
    val leiste = RoundedCornerShape(14.dp)
    /** Etiketten und kleine Marken. */
    val etikett = RoundedCornerShape(8.dp)
    /** Sehr kleine Marken (Zustandspunkte, Zähler). */
    val marke = RoundedCornerShape(6.dp)
    /** Schwebende Aktionsknöpfe (FAB) in Galerie, Teile, Minifiguren. */
    val fab = RoundedCornerShape(18.dp)
    /** Trennstriche und Fortschrittsbalken — fast eckig. */
    val strich = RoundedCornerShape(2.dp)

    /** Erhebung einer flachen Karte (Listen, Abschnitte). */
    val karteErhebung = 1.dp
    /** Erhebung einer hervorgehobenen Karte (Anmeldung, Dialoge, Kennzahlen). */
    val karteErhebungHoch = 2.dp
}

/**
 * Die Karte, die im Baum mehrfach zeichengleich abgeschrieben war.
 *
 * Sie kapselt NUR die Hülle — Form, Erhebung, Flächenfarbe, volle Breite. Der
 * Innenabstand bleibt beim Aufrufer, weil genau darin sich die Fundstellen
 * unterschieden (14 dp hier, 16 dp dort, mit und ohne Zeilenabstand). Ihn
 * hierher zu ziehen hiesse, an vier Stellen das Aussehen zu ändern, und dieser
 * Nachtrag soll nichts am Aussehen ändern.
 */
@Composable
fun AppKarte(
    modifier: Modifier = Modifier,
    /**
     * Antippbar machen. Material3 hat dafür eine EIGENE `Card`-Überladung mit
     * Wellenanzeige; deshalb wird hier verzweigt statt ein `clickable` an die
     * unantippbare Fassung gehängt — das sähe anders aus.
     */
    onClick: (() -> Unit)? = null,
    inhalt: @Composable ColumnScope.() -> Unit
) {
    val form = Formen.karte
    val erhebung = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebung)
    val farben = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    if (onClick == null) {
        Card(modifier = modifier.fillMaxWidth(), shape = form,
             elevation = erhebung, colors = farben, content = inhalt)
    } else {
        Card(onClick = onClick, modifier = modifier.fillMaxWidth(), shape = form,
             elevation = erhebung, colors = farben, content = inhalt)
    }
}

/**
 * Farben mit BEDEUTUNG, die das Material-Schema nicht kennt.
 *
 * ── Warum (Nachtrag 120) ─────────────────────────────────────────────────────
 * Zwölf Farben standen fest im Quelltext verteilt: `Color(0xFF16A34A)` für
 * Erfolg in MonitoringScreen und SetDetailComponents, `Color(0xFF22C55E)` für
 * dasselbe in SetupScreen und BarcodeScannerScreen — zwei verschiedene Grüns
 * für dieselbe Aussage, in vier Dateien. Im Stein-Design zogen sie nicht mit.
 *
 * Material3 hat für „erfolgreich" und „Warnung" keine Rolle; erfunden werden
 * müssen sie also. Aber einmal, nicht viermal.
 *
 * Die Werte sind zahlengleich mit dem, was vorher dastand — bis auf die
 * Vereinheitlichung der beiden Grüns auf `0xFF16A34A`, das häufigere.
 */
data class StatusFarben(
    val erfolg: Color,
    val warnung: Color,
    val fehler: Color,
)

val LocalStatusFarben = staticCompositionLocalOf {
    StatusFarben(
        erfolg  = Color(0xFF16A34A),
        warnung = Color(0xFFE3B341),
        fehler  = Color(0xFFDC2626),
    )
}
