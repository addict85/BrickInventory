package ch.brickinventoryapp.finances

import ch.brickinventoryapp.finances.ui.pdf.PDF_BITMAP_MAX_PX
import ch.brickinventoryapp.finances.ui.pdf.bitmapDimensions
import ch.brickinventoryapp.finances.ui.screens.renderLevel
import org.junit.Test
import ch.brickinventoryapp.testing.Quellen

/**
 * The PDF viewer can zoom — and stays sharp while doing so, without blowing
 * up memory.
 *
 * ── What is checked here, and what is NOT ───────────────────────────────────
 *
 * COMPUTED is the calculation: [renderLevel] and [bitmapDimensions] were pulled out of
 * PdfViewerScreen for exactly this reason, so that they run without a device. The
 * area limit with the square root is the spot where a sign or
 * root error would not stand out: the display looks correct, only the memory
 * fills up or the image stays coarse.
 *
 * READ is the rest, because no Compose runs here: that the
 * modifier order is correct, that `canPan = { false }` is present, and that the
 * old bitmap stays up on a step change. These are statements about the
 * component, not about behavior — but they are the three decisions
 * that a later change can accidentally reverse without it standing out.
 *
 * NOT checked, and visible only on the device: whether the two-finger gesture
 * wins against the LazyColumn's scrolling. From the source of foundation
 * (gestures/Transformable.kt, DragGestureDetector.kt) it follows that they do
 * not get in each other's way and that, in doubt, the list scrolls instead of
 * doing both; which of the two is first past the threshold on an almost vertical
 * gesture is decided by the hardware. That is why there is also the double tap and the
 * two buttons in the header.
 */
class PdfZoomTest {

    private val A4 = 1.4142f      // Hoehe / Breite einer A4-Seite

    @Test
    fun `without zoom it renders at single width, with zoom higher`() {
        // Level 1 applies ONLY at exactly 1x. That is intentional: as long as there is no
        // zoom, the viewer should use as much memory as before; once
        // zoomed, sharpness matters more.
        assert(renderLevel(1f) == 1) { "1x muss Stufe 1 sein, war ${renderLevel(1f)}" }
        assert(renderLevel(1.25f) == 2) { "1,25x muss Stufe 2 sein, war ${renderLevel(1.25f)}" }
        assert(renderLevel(2f) == 2) { "2x muss Stufe 2 sein, war ${renderLevel(2f)}" }
        assert(renderLevel(2.5f) == 3) { "2,5x muss Stufe 3 sein, war ${renderLevel(2.5f)}" }
        assert(renderLevel(5f) == 3) { "5x muss Stufe 3 sein, war ${renderLevel(5f)}" }
    }

    @Test
    fun `the level stays at three no matter how far it is zoomed`() {
        // The upper limit of the zoom is 5x; raising it later must not drag the
        // render resolution along with it. Hence checked up to 100.
        var z = 1f
        while (z <= 100f) {
            val stufe = renderLevel(z)
            assert(stufe in 1..3) { "Stufe $stufe bei Zoom $z liegt ausserhalb 1..3" }
            z += 0.37f
        }
        // And the opposite direction: a nonsensical value must not fall below 1,
        // otherwise the bitmap would be 0 pixels wide.
        assert(renderLevel(0f) == 1) { "Zoom 0 muss Stufe 1 ergeben" }
        assert(renderLevel(-3f) == 1) { "Ein negativer Zoom muss Stufe 1 ergeben" }
    }

    @Test
    fun `below the limit the desired width stays untouched`() {
        val (w, h) = bitmapDimensions(1080, A4)
        assert(w == 1080) { "1080 px liegen weit unter der Grenze, geliefert wurde $w" }
        assert(h == (1080 * A4).toInt()) { "Hoehe $h passt nicht zu 1080 x $A4" }
        // Counter-check for the limit itself: this case must not touch it,
        // otherwise it says nothing about the unbounded path.
        assert(w.toLong() * h < PDF_BITMAP_MAX_PX) {
            "Der Fall liegt schon an der Grenze (${w.toLong() * h}) — dann prueft er " +
                "nicht den unbegrenzten Weg."
        }
    }

    @Test
    fun `above the limit it is capped, in both directions`() {
        // 3240 px is level 3 of a 1080-px device — the case that
        // actually occurs in practice.
        val gewuenscht = 3240
        val (w, h) = bitmapDimensions(gewuenscht, A4)

        assert(w < gewuenscht) {
            "$gewuenscht px bei A4 sind ${gewuenscht.toLong() * (gewuenscht * A4).toInt()} " +
                "Pixel und liegen damit ueber der Grenze von $PDF_BITMAP_MAX_PX — es haette " +
                "gekappt werden muessen, geliefert wurde aber die vollen $w."
        }
        assert(w.toLong() * h <= PDF_BITMAP_MAX_PX) {
            "Nach dem Kappen sind es noch ${w.toLong() * h} Pixel, erlaubt sind " +
                "$PDF_BITMAP_MAX_PX. Dann greift der Riegel nicht."
        }
        // The aspect ratio must be preserved. Capping only the width would be the
        // obvious mistake — the page would then be squashed, and by so
        // little that one might take it for the instruction manual itself.
        val verhaeltnis = h.toFloat() / w.toFloat()
        assert(kotlin.math.abs(verhaeltnis - A4) < 0.01f) {
            "Seitenverhaeltnis nach dem Kappen $verhaeltnis statt $A4 — die Seite waere verzerrt."
        }
    }

    @Test
    fun `the bolt holds for portrait and landscape and for nonsensical input`() {
        for (ratio in listOf(0.5f, 0.707f, 1f, 1.4142f, 2f, 3f)) {
            for (breite in listOf(1, 320, 1080, 2160, 3240, 8000, 40000)) {
                val (w, h) = bitmapDimensions(breite, ratio)
                assert(w >= 1 && h >= 1) { "Masse $w x $h bei ($breite, $ratio) — 0 ist keine Bitmap" }
                assert(w.toLong() * h <= PDF_BITMAP_MAX_PX) {
                    "($breite, $ratio) ergibt ${w.toLong() * h} Pixel, erlaubt sind $PDF_BITMAP_MAX_PX"
                }
                assert(w <= breite.coerceAtLeast(1)) {
                    "($breite, $ratio) ergibt $w — breiter als gewuenscht wird nie gerendert"
                }
            }
        }
        // A width of 0 or less must not yield an empty bitmap.
        for (b in listOf(0, -1, -5000)) {
            val (w, h) = bitmapDimensions(b, A4)
            assert(w >= 1 && h >= 1) { "Breite $b ergab $w x $h" }
        }
    }

    // ── The three decisions that can accidentally be reversed ─────────

    private val quelle: String by lazy {
        Quellen.withoutComments(Quellen.lies("finances/ui/screens/PdfSeiten.kt"))
    }

    @Test
    fun `the gesture claims no one-finger drags`() {
        assert(Regex("""transformable\(\s*state\s*=\s*\w+\s*,\s*canPan\s*=\s*\{\s*false\s*\}""")
            .containsMatchIn(quelle)) {
            "Der transformable-Aufruf steht nicht mehr mit `canPan = { false }` da. " +
                "Ohne das beansprucht die Geste auch Einfinger-Zuege, und die Liste " +
                "rollt nicht mehr — nachgelesen in foundation/gestures/Transformable.kt, " +
                "detectZoom(): der Schwellwert kommt dann ueber " +
                "`panMotion > touchSlop && canPan(...)`.\nGefunden:\n" +
                (Regex("""\.transformable\([^)]*\)""").find(quelle)?.value ?: "kein transformable-Aufruf")
        }
    }

    @Test
    fun `transformable stands behind horizontalScroll`() {
        val h = quelle.indexOf(".horizontalScroll(")
        val t = quelle.indexOf(".transformable(")
        assert(h >= 0) { "Kein horizontalScroll mehr — womit wird dann waagerecht verschoben?" }
        assert(t >= 0) { "Kein transformable mehr — womit wird dann gezoomt?" }
        assert(h < t) {
            "transformable steht VOR horizontalScroll. Dann ist das waagerechte " +
                "Rollen das tiefere Glied und sieht die Bewegung zuerst; eine " +
                "Zwei-Finger-Geste, deren Finger auseinandergehen, kann es fuer sich " +
                "beanspruchen, und der Zoom kommt nie zum Zug."
        }
    }

    @Test
    fun `on a level change the old page stays`() {
        // remember WITHOUT the render width, LaunchedEffect WITH it: only this way is it
        // re-rendered without the display first going blank. The
        // keys compared are PdfPage's parameters, not fixed names.
        // Counter-check: gegenproben/pdf-bitmap-an-renderbreite.patch → red here.
        val kopf = Regex("""fun PdfPage\((\w+): PdfQuelle, (\w+): Int, (\w+): Int[,)]""").find(quelle)
        assert(kopf != null) { "PdfPage(quelle: PdfQuelle, index: Int, renderBreite: Int) nicht gefunden." }
        val (pdf, seite, breite) = kopf!!.destructured
        fun schluessel(pattern: String) =
            Regex(pattern).find(quelle)?.groupValues?.get(1)?.split(",")?.map { it.trim() }
        val gemerkt = schluessel("""var bitmap by remember\(([^)]*)\)""")
        assert(gemerkt == listOf(pdf, seite)) {
            "Der Bitmap-Zustand haengt an $gemerkt statt nur an ($pdf, $seite). Haengt er " +
                "auch an der Renderbreite, wird er beim Stufenwechsel zurueckgesetzt: " +
                "auf allen sichtbaren Seiten blitzt der Ladekreis auf, und weil leere " +
                "Seiten eine andere Hoehe haben als gerenderte, verliert man beim " +
                "Zoomen die Stelle."
        }
        val newRendered = schluessel("""LaunchedEffect\(([^)]*\b$breite\b[^)]*)\)""")
        assert(newRendered?.toSet() == setOf(pdf, seite, breite)) {
            "Der LaunchedEffect haengt nicht an ($pdf, $seite, $breite), sondern an $newRendered — " +
                "ohne $breite wird beim Zoomen nie in hoeherer Aufloesung nachgerendert " +
                "und das Bild bleibt grob."
        }
        assert(Regex("""if \(neu != null\) bitmap = neu""").containsMatchIn(quelle)) {
            "Die neue Bitmap wird nicht mehr nur bei Erfolg uebernommen. Scheitert " +
                "ein Render, waere die Seite danach leer statt in der alten Aufloesung da."
        }
    }

    @Test
    fun `the double tap reads the current zoom, not the one from back then`() {
        // pointerInput(Unit) is deliberately not set up anew — otherwise
        // every recalculation would break off a running gesture. For this, the block holds fixed the
        // closure of the FIRST composition. If the double tap reads `zoom`
        // directly, it sees 1 forever and only ever zooms in.
        //
        // That is the kind of bug that does not stand out when trying it: zooming in
        // works, and that zooming back out does not work gets blamed on the
        // operation.
        assert(quelle.contains("val zoomJetzt by rememberUpdatedState(zoom)")) {
            "Es gibt kein rememberUpdatedState fuer den Zoom mehr — dann liest der " +
                "Doppeltipp den eingefrorenen Wert aus der ersten Komposition."
        }
        val tip = Regex("detectTapGestures\\(onDoubleTap = \\{(.*?)\\}\\)", RegexOption.DOT_MATCHES_ALL)
            .find(quelle)?.groupValues?.get(1)
        assert(tip != null) { "Kein detectTapGestures(onDoubleTap = ...) mehr gefunden." }
        assert(tip!!.contains("zoomJetzt") && tip.contains("setzeZoomJetzt")) {
            "Der Doppeltipp greift nicht auf die nachgefuehrten Werte zu:\n$tip"
        }
        assert(!Regex("[^A-Za-z]zoom[^A-Za-z]").containsMatchIn(tip)) {
            "Der Doppeltipp liest `zoom` unmittelbar — das ist der eingefrorene " +
                "Wert aus der ersten Komposition:\n$tip"
        }
    }

    @Test
    fun `during a two-finger gesture the list does not scroll`() {
        // The one weakness that was already named while building it: the LazyColumn
        // is the DEEPER member and sees the movement before the transformable.
        // If a gesture diverges even a little vertically, it
        // claims the list — and no zooming happens.
        assert(quelle.contains("userScrollEnabled = !zweiFinger")) {
            "Die Liste rollt waehrend einer Zwei-Finger-Geste weiter. Dann gewinnt " +
                "sie den Streit um die Bewegung und der Zoom kommt nicht zum Zug."
        }
        assert(quelle.contains("awaitPointerEvent(PointerEventPass.Initial)")) {
            "Die Finger werden nicht mehr im Initial-Durchgang gezaehlt. Nur dort " +
                "sieht der Zaehler sie VOR der Liste; im Main-Durchgang kaeme er zu spaet."
        }
        // The counter must claim NOTHING — otherwise it is the same conflict
        // with the roles swapped.
        val block = Regex(
            "awaitPointerEventScope \\{(.*?)\\n {16}\\}", RegexOption.DOT_MATCHES_ALL
        ).find(quelle)?.groupValues?.get(1)
        assert(block != null) { "Kein awaitPointerEventScope-Block mehr gefunden." }
        assert(!block!!.contains("consume()")) {
            "Der Finger-Zaehler beansprucht Ereignisse:\n$block"
        }
    }

    @Test
    fun `the zoom computes with the finger point when measuring`() {
        // The calculation itself is checked by PdfZoomAnchorTest. Here only that it is
        // called where the old layout and the new zoom are both available at once.
        val measure = Regex("""\.layout \{ messbar, grenzen ->(.*?)\n {16}\}""", RegexOption.DOT_MATCHES_ALL)
            .find(quelle)?.groupValues?.get(1)
        assert(measure != null) { "Kein .layout { messbar, grenzen -> ... } vor dem Rollen mehr." }
        for (teil in listOf("zoomZielY(", "requestScrollToItem(", "zoomZielX(", "dispatchRawDelta(")) {
            assert(measure!!.contains(teil)) { "Beim Messen fehlt $teil:\n$measure" }
        }
        assert(quelle.indexOf(".layout {") < quelle.indexOf(".horizontalScroll(")) {
            "Die Messung steht nicht vor horizontalScroll — dann kappt es das Ziel an der alten Breite."
        }
    }

    @Test
    fun `the zoom does not run via a graphicsLayer`() {
        assert(!quelle.contains("graphicsLayer")) {
            "Im PDF-Betrachter steht ein graphicsLayer. Der streckt die gerenderte " +
                "Bitmap statt sie neu zu rendern — bei 4x ist eine Teilenummer " +
                "unleserlich —, skaliert ausserdem das Sichtfeld der LazyColumn " +
                "(ein Zug rollt dann Faktor-mal so weit) und braucht einen " +
                "Verschiebe-Offset, der gegen die Inhaltsgroesse begrenzt werden " +
                "muesste. Die Begruendung steht im Kopfkommentar von PdfPages."
        }
    }
}
