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
 * Der Lichtabfall einer lackierten Flaeche — Licht oben, Schatten unten.
 *
 * Dieselben vier Haltepunkte wie `linear-gradient(180deg, …)` in
 * themes/hochglanz.css.
 *
 * ── Warum der Lichtsaum schmaler wurde (Nachtrag 165) ─────────────────────
 *
 * Aus dem Entwurf kamen 0.55 auf 42% der Hoehe. Marco: „In der Android App ist
 * der Glanz zu stark." Er hat recht — auf dem Telefon frisst der breite
 * Weissanteil die Deckelfarbe weg, und die Deckelfarbe IST der Takt dieses
 * Designs (siehe themes/noppe.css). Jetzt 0.34 auf 30%: ein Lichtsaum statt
 * einer Waesche.
 *
 * Die dunkle Haelfte bleibt unveraendert. Sie gibt dem Deckel seine Woelbung
 * und war nie das Problem. Sie stehen hier als Zahlen und nicht in
 * design-tokens.json, weil sie keine FARBE sind: Ein Verlauf aus Weiss- und
 * Schwarzanteilen liegt ueber jeder beliebigen Grundfarbe und gehoert damit
 * nicht in eine Palette.
 */
val LackVerlauf = Brush.verticalGradient(
    0.00f to Color.White.copy(alpha = 0.34f),
    0.30f to Color.White.copy(alpha = 0.10f),
    0.62f to Color.Black.copy(alpha = 0.10f),
    1.00f to Color.Black.copy(alpha = 0.20f),
)

/**
 * Die Form EINER Noppe: unten bündig am Deckel, oben rund.
 *
 * Dieselbe Form, die styles.css als Maske führt (`--noppen-form`). Sie steht
 * hier als eigener Wert und nicht dreimal im Baustein, damit beide
 * Oberflächen sie an genau einer Stelle führen.
 */
val NoppenForm = RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp)

/**
 * Der Lichtabfall auf der Steinkante — Licht oben, Kante unten.
 *
 * Dieselben Haltepunkte wie `linear-gradient(180deg, …)` fuer `.sc::before` in
 * themes/brick.css. Viel schwaecher als LackVerlauf: Das Stein-Design ist
 * mattes Plastik, kein Lack. Ohne ihn ist die Kante eine Flaeche, mit ihm ein
 * Koerper — und ohne ihn saehe die App wieder anders aus als das Web.
 */
val SteinKantenVerlauf = Brush.verticalGradient(
    0.00f to Color.White.copy(alpha = 0.20f),
    0.40f to Color.White.copy(alpha = 0.05f),
    1.00f to Color.Black.copy(alpha = 0.12f),
)

/**
 * Die MASSE einer Noppenreihe — dieselben Zahlen wie im CSS.
 *
 * ── Warum als ein Satz und nicht als fünf Parameter ───────────────────────
 *
 * Die beiden Designs unterscheiden sich in genau diesen Zahlen und in sonst
 * nichts. Einzeln übergeben würden sie an der Aufrufstelle stehen — verteilt
 * über drei Bildschirme, und beim nächsten Nachbessern zieht eine Stelle nicht
 * mit. Als benannter Satz stehen sie einmal, neben der CSS-Datei, aus der sie
 * kommen.
 *
 * Marcos Befund, der dazu geführt hat: Im Stein-Design zeichnete das Web flache
 * KREISE über die ganze Breite, die App vier abgerundete Noppen links. Zwei
 * Oberflächen, zwei Formen, zwei Zahlenreihen.
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
     * Abstand von der Oberkante der Kante — `top` im CSS. NEGATIV heisst: Die
     * Noppen stehen über, wie an einem echten Stein. Dann muss die Reihe
     * AUSSERHALB der Karte gezeichnet werden (siehe NoppenReihe).
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
 * Noppen-„Deckel" für Stein-Karten: eine schmale, farbige Leiste mit hellen
 * Noppen links. Wird oben in Karten platziert und über das Karten-Clipping
 * automatisch oben abgerundet.
 *
 * ── Die Form der Noppe (Nachtrag 163) ────────────────────────────────
 *
 * Ein Rechteck mit RUNDER OBERKANTE, oben am Deckel angesetzt — die Noppe von
 * vorn gesehen, so wie sie im Entwurf steht und wie themes/noppe.css sie
 * zeichnet. Vorher standen hier Kreise: Marcos Vorgabe sind einheitliche
 * Ansichten, und ein Kreis in der App neben einer Noppe im Web sind zwei
 * Designs. Die Masse (13 × 6, Radius 4, Abstand 7) sind dieselben wie dort.
 *
 * ── Der Glanz (Nachtrag 162) ────────────────────────────────────────────────
 *
 * Mit `glanz = true` woelbt sich der Deckel: derselbe Lichtabfall wie im Web,
 * und die Noppen werden Kuppen statt heller Scheiben. Als PARAMETER und nicht
 * als zweiter Baustein — es ist derselbe Deckel in einem anderen Material, und
 * zwei Bausteine liefen beim naechsten Nachbessern auseinander.
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
 * Nur die Noppen — ohne die Kante darunter.
 *
 * ── Warum das ein eigener Baustein ist (Nachtrag 169) ───────────────────────
 *
 * Marco: „Geht es nicht, dass die Noppen oberhalb des Bereichs sind?" Im Web
 * loest das ein `top:-6px` zusammen mit `overflow:visible` an der Kachel. In
 * Compose gibt es kein `overflow:visible`: Die Material-Card klippt auf ihre
 * Form, und was ueber ihren Rand ragt, ist weg.
 *
 * Deshalb wird die Reihe fuer das Stein-Design NEBEN der Karte gezeichnet und
 * per Offset darueber geschoben. Sie ist damit kein zweiter Deckel, sondern
 * der Teil des einen Deckels, der ausserhalb liegen muss.
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
 * Der schraege Lichtstreifen — die Spiegelung auf einer Glasflaeche.
 *
 * ── Wo er liegen darf ───────────────────────────────────────────────────────
 *
 * Auf dem BILDFELD und auf farbigen Flaechen, NICHT auf der ganzen Kachel. Ein
 * weisser Schleier ueber weissem Text ist kein Glanz, sondern Grau: Die erste
 * Fassung des Entwurfs hatte ihn ueber der ganzen Karte, und die Kacheln sahen
 * blasser aus als ohne Glanz statt lackierter. Gesehen hat man das erst im
 * Browser, nicht an den Werten.
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
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold
            )
        }
    }
}
