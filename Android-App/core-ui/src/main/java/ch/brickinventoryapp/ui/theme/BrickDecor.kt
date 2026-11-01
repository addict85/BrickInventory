package ch.brickinventoryapp.ui.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Der Lichtabfall einer lackierten Fläche — Licht oben, Schatten unten, dieselben
 * Haltepunkte wie in themes/hochglanz.css. Der Lichtsaum ist schmal (0.34 auf 30
 * %), damit er auf dem Telefon die Deckelfarbe nicht wegfrisst; sie ist der Takt
 * des Designs. Zahlen statt design-tokens.json, weil ein Verlauf aus Weiss- und
 * Schwarzanteilen keine Farbe ist, sondern über jeder Grundfarbe liegt.
 */
val LackVerlauf = Brush.verticalGradient(
    0.00f to Color.White.copy(alpha = 0.34f),
    0.30f to Color.White.copy(alpha = 0.10f),
    0.62f to Color.Black.copy(alpha = 0.10f),
    1.00f to Color.Black.copy(alpha = 0.20f),
)

/**
 * Die Form einer Noppe: unten bündig am Deckel, oben rund — dieselbe wie
 * `--noppen-form` in styles.css, an einer Stelle.
 */
val NoppenForm = RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp)

/**
 * Der Lichtabfall auf der Steinkante, dieselben Haltepunkte wie `.sc::before` in
 * themes/brick.css. Schwächer als LackVerlauf, weil das Stein-Design mattes
 * Plastik ist; ohne ihn wäre die Kante eine Fläche.
 */
val SteinKantenVerlauf = Brush.verticalGradient(
    0.00f to Color.White.copy(alpha = 0.20f),
    0.40f to Color.White.copy(alpha = 0.05f),
    1.00f to Color.Black.copy(alpha = 0.12f),
)

/**
 * Die Masse einer Noppenreihe — dieselben Zahlen wie im CSS, als ein Satz: Die
 * Designs unterscheiden sich genau darin, und verteilt über mehrere Aufrufstellen
 * zöge beim Nachbessern eine nicht mit.
 */
data class NoppenMass(
    /** Hoehe der Kante insgesamt — `height` der ::before-Regel im CSS. */
    val kanteHoehe: Dp,
    /** Abstand von Noppenmitte zu Noppenmitte — `mask-size` im CSS. */
    val takt: Dp,
    val breite: Dp,
    val hoehe: Dp,
    /** Einzug links und rechts — `left`/`right` im CSS. */
    val rand: Dp,
    /**
     * Abstand von der Oberkante der Kante — `top` im CSS. Negativ heisst: Die Noppen
     * stehen über wie an einem echten Stein; dann wird die Reihe ausserhalb der Karte
     * gezeichnet (NoppenReihe).
     */
    val oben: Dp,
    /** Füllt die Reihe die ganze Breite? Sonst gelten `anzahl` Stück. */
    val fuellend: Boolean,
    val anzahl: Int = 4,
) {
    /** Steht die Reihe über der Kante? Dann gehört sie nicht in die Karte. */
    val ueberstehend: Boolean get() = oben < 0.dp

    companion object {
        /** themes/brick.css: eine Reihe über die ganze Kante, Takt 17. */
        val Stein = NoppenMass(kanteHoehe = 22.dp, takt = 17.dp, breite = 10.dp,
                               hoehe = 6.dp, rand = 10.dp, oben = (-6).dp, fuellend = true)

        /** themes/noppe.css: vier Noppen auf dem Deckel, Takt 22. */
        val Deckel = NoppenMass(kanteHoehe = 16.dp, takt = 22.dp, breite = 14.dp,
                                hoehe = 7.dp, rand = 12.dp, oben = 6.dp, fuellend = false, anzahl = 4)
    }
}

/**
 * Noppen-Deckel für Stein-Karten: eine schmale farbige Leiste mit Noppen; das
 * Karten-Clipping rundet ihn oben ab. Die Noppe ist ein Rechteck mit runder
 * Oberkante wie in themes/noppe.css (13 × 6, Radius 4, Abstand 7). `glanz` wölbt
 * den Deckel — ein Parameter statt eines zweiten Bausteins, weil es derselbe
 * Deckel in anderem Material ist.
 */
@Composable
fun BrickStudCap(
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.primary,
    /** Ohne Angabe die Hoehe aus `mass` — dann steht keine Zahl am Aufruf. */
    height: Dp? = null,
    glanz: Boolean = false,
    mass: NoppenMass = NoppenMass.Deckel,
    noppenFarbe: Color? = null,
    /** Lichtabfall ueber der Grundfarbe — siehe SteinKantenVerlauf. */
    verlauf: Brush? = null,
) {
    Box(
        modifier
            .fillMaxWidth()
            .height(height ?: mass.kanteHoehe)
            .background(color)
            .then(if (verlauf != null) Modifier.background(verlauf) else Modifier)
            .then(if (glanz) Modifier.background(LackVerlauf) else Modifier)
    ) {
        // Steht die Reihe ueber der Kante, gehoert sie nicht hierher: Eine
        // Material-Card klippt auf ihre Form, und die Noppen waeren weg. Die
        // Aufrufstelle zeichnet sie dann neben der Karte (siehe GalleryScreen).
        if (!mass.ueberstehend) {
            NoppenReihe(
                mass = mass,
                modifier = Modifier.align(Alignment.TopStart).offset(y = mass.oben),
                farbe = noppenFarbe,
                glanz = glanz,
            )
        }
    }
}

/**
 * Nur die Noppen, ohne Kante: Compose kennt kein `overflow:visible`, und die Card
 * klippt auf ihre Form. Deshalb wird die Reihe neben der Karte gezeichnet und per
 * Offset darübergeschoben.
 */
@Composable
fun NoppenReihe(
    mass: NoppenMass,
    modifier: Modifier = Modifier,
    farbe: Color? = null,
    glanz: Boolean = false,
) {
    BoxWithConstraints(modifier.fillMaxWidth().height(mass.hoehe)) {
        // Wie viele Noppen passen auf die Kante? Im CSS rechnet das
        // `mask-repeat:repeat-x` von selbst aus; hier braucht es die Breite,
        // und die gibt es erst beim Messen. Genau dafuer BoxWithConstraints.
        val anzahl =
            if (mass.fuellend) (((maxWidth - mass.rand * 2) / mass.takt).toInt()).coerceAtLeast(1)
            else mass.anzahl
        Row(
            Modifier.align(Alignment.TopStart).padding(start = mass.rand),
            horizontalArrangement = Arrangement.spacedBy(mass.takt - mass.breite)
        ) {
            repeat(anzahl) {
                Box(
                    Modifier
                        .size(width = mass.breite, height = mass.hoehe)
                        .clip(NoppenForm)
                        // Die Kuppe: ein Lichtpunkt oben statt einer gleichmaessig
                        // hellen Scheibe. Derselbe radiale Verlauf wie
                        // `radial-gradient(ellipse at 50% 20%, …)` im Web.
                        .then(
                            if (glanz) Modifier.background(
                                Brush.radialGradient(
                                    0.00f to Color.White.copy(alpha = 0.95f),
                                    0.45f to Color.White.copy(alpha = 0.55f),
                                    1.00f to Color.White.copy(alpha = 0.18f),
                                )
                            ) else Modifier.background(
                                farbe ?: Color.White.copy(alpha = 0.55f)
                            )
                        )
                )
            }
        }
    }
}

/**
 * Der schräge Lichtstreifen — die Spiegelung auf Glas. Nur auf dem Bildfeld und
 * auf farbigen Flächen: Über weissem Text wäre ein weisser Schleier Grau statt
 * Glanz.
 */
val LichtStreifen = Brush.linearGradient(
    0.20f to Color.White.copy(alpha = 0.00f),
    0.36f to Color.White.copy(alpha = 0.85f),
    0.44f to Color.White.copy(alpha = 0.25f),
    0.56f to Color.White.copy(alpha = 0.00f),
)

/**
 * Farbige Wert-Kachel für die Set-Details (z. B. "Aktueller Wert" in Petrol,
 * "Kaufpreis" in Schiefer) — Label oben, großer Wert darunter.
 */
@Composable
fun BrickStatTile(
    label: String,
    value: String,
    container: Color,
    onContainer: Color,
    modifier: Modifier = Modifier
) {
    Box(
        modifier
            .clip(RoundedCornerShape(14.dp))
            .background(container)
            .padding(horizontal = 16.dp, vertical = 14.dp)
    ) {
        Column {
            Text(
                label,
                color = onContainer.copy(alpha = 0.85f),
                style = MaterialTheme.typography.labelMedium
            )
            Text(
                value,
                color = onContainer,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold
            )
        }
    }
}
