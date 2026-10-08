package ch.brickinventoryapp

import ch.brickinventoryapp.ui.screens.PDF_BITMAP_MAX_PX
import ch.brickinventoryapp.ui.screens.bitmapMasse
import ch.brickinventoryapp.ui.screens.renderStufe
import org.junit.Test

/**
 * Der PDF-Betrachter kann zoomen — und bleibt dabei scharf, ohne den Speicher
 * zu sprengen.
 *
 * ── Woher dieser Test kommt ─────────────────────────────────────────────────
 *
 * Marcos Wunsch: „Kannst du bei den PDF Viewer in der Android App und der
 * Webapp dass man Zoom kann?"
 *
 * ── Was hier geprueft wird, und was NICHT ───────────────────────────────────
 *
 * GERECHNET wird die Rechnung: [renderStufe] und [bitmapMasse] sind genau
 * deshalb aus PdfViewerScreen herausgezogen, dass sie ohne Geraet laufen. Die
 * Flaechenbegrenzung mit der Wurzel ist die Stelle, an der ein Vorzeichen- oder
 * Wurzelfehler nicht auffaellt: Die Anzeige sieht richtig aus, nur der Speicher
 * laeuft voll oder das Bild bleibt grob.
 *
 * GELESEN wird der Rest, weil hier kein Compose laeuft: dass die
 * Modifier-Reihenfolge stimmt, dass `canPan = { false }` dasteht und dass die
 * alte Bitmap beim Stufenwechsel stehen bleibt. Das sind Aussagen ueber den
 * Bauteil, nicht ueber das Verhalten — aber es sind die drei Entscheidungen,
 * die ein spaeterer Eingriff versehentlich umdrehen kann, ohne dass es auffaellt.
 *
 * NICHT geprueft, und nur auf dem Geraet zu sehen: ob die Zwei-Finger-Geste
 * gegen das Rollen der LazyColumn gewinnt. Aus der Quelle von foundation
 * (gestures/Transformable.kt, DragGestureDetector.kt) folgt, dass sie sich
 * nicht in die Quere kommen und dass im Zweifel die Liste rollt statt beides zu
 * tun; welche von beiden bei einer fast senkrechten Geste zuerst am Schwellwert
 * ist, entscheidet die Hardware. Darum gibt es ausserdem den Doppeltipp und die
 * zwei Knoepfe in der Kopfzeile.
 */
class PdfZoomTest {

    private val A4 = 1.4142f      // Hoehe / Breite einer A4-Seite

    @Test
    fun `ohne Zoom wird in einfacher Breite gerendert, mit Zoom hoeher`() {
        // Stufe 1 gilt NUR bei genau 1x. Das ist gewollt: Solange nicht gezoomt
        // ist, soll der Betrachter so viel Speicher brauchen wie bisher; sobald
        // gezoomt ist, zaehlt Schaerfe mehr.
        assert(renderStufe(1f) == 1) { "1x muss Stufe 1 sein, war ${renderStufe(1f)}" }
        assert(renderStufe(1.25f) == 2) { "1,25x muss Stufe 2 sein, war ${renderStufe(1.25f)}" }
        assert(renderStufe(2f) == 2) { "2x muss Stufe 2 sein, war ${renderStufe(2f)}" }
        assert(renderStufe(2.5f) == 3) { "2,5x muss Stufe 3 sein, war ${renderStufe(2.5f)}" }
        assert(renderStufe(5f) == 3) { "5x muss Stufe 3 sein, war ${renderStufe(5f)}" }
    }

    @Test
    fun `die Stufe bleibt bei drei, egal wie weit gezoomt wird`() {
        // Der obere Anschlag des Zooms ist 5x; eine spaetere Erhoehung darf die
        // Renderaufloesung nicht mitreissen. Darum bis 100 geprueft.
        var z = 1f
        while (z <= 100f) {
            val stufe = renderStufe(z)
            assert(stufe in 1..3) { "Stufe $stufe bei Zoom $z liegt ausserhalb 1..3" }
            z += 0.37f
        }
        // Und die Gegenrichtung: ein unsinniger Wert darf nicht unter 1 fallen,
        // sonst waere die Bitmap 0 Pixel breit.
        assert(renderStufe(0f) == 1) { "Zoom 0 muss Stufe 1 ergeben" }
        assert(renderStufe(-3f) == 1) { "Ein negativer Zoom muss Stufe 1 ergeben" }
    }

    @Test
    fun `unterhalb der Grenze bleibt die gewuenschte Breite unangetastet`() {
        val (w, h) = bitmapMasse(1080, A4)
        assert(w == 1080) { "1080 px liegen weit unter der Grenze, geliefert wurde $w" }
        assert(h == (1080 * A4).toInt()) { "Hoehe $h passt nicht zu 1080 x $A4" }
        // Gegenprobe zur Grenze selbst: Dieser Fall darf sie nicht beruehren,
        // sonst sagt er nichts ueber den unbegrenzten Weg aus.
        assert(w.toLong() * h < PDF_BITMAP_MAX_PX) {
            "Der Fall liegt schon an der Grenze (${w.toLong() * h}) — dann prueft er " +
                "nicht den unbegrenzten Weg."
        }
    }

    @Test
    fun `oberhalb der Grenze wird gekappt, und zwar in beiden Richtungen`() {
        // 3240 px ist die Stufe 3 eines 1080-px-Geraets — der Fall, der in
        // Wirklichkeit auftritt.
        val gewuenscht = 3240
        val (w, h) = bitmapMasse(gewuenscht, A4)

        assert(w < gewuenscht) {
            "$gewuenscht px bei A4 sind ${gewuenscht.toLong() * (gewuenscht * A4).toInt()} " +
                "Pixel und liegen damit ueber der Grenze von $PDF_BITMAP_MAX_PX — es haette " +
                "gekappt werden muessen, geliefert wurde aber die vollen $w."
        }
        assert(w.toLong() * h <= PDF_BITMAP_MAX_PX) {
            "Nach dem Kappen sind es noch ${w.toLong() * h} Pixel, erlaubt sind " +
                "$PDF_BITMAP_MAX_PX. Dann greift der Riegel nicht."
        }
        // Das Seitenverhaeltnis muss bleiben. Nur die Breite zu kappen waere der
        // naheliegende Fehler — die Seite waere dann gestaucht, und zwar so
        // wenig, dass man es fuer die Anleitung selbst halten koennte.
        val verhaeltnis = h.toFloat() / w.toFloat()
        assert(kotlin.math.abs(verhaeltnis - A4) < 0.01f) {
            "Seitenverhaeltnis nach dem Kappen $verhaeltnis statt $A4 — die Seite waere verzerrt."
        }
    }

    @Test
    fun `der Riegel haelt fuer hoch und quer und fuer unsinnige Eingaben`() {
        for (ratio in listOf(0.5f, 0.707f, 1f, 1.4142f, 2f, 3f)) {
            for (breite in listOf(1, 320, 1080, 2160, 3240, 8000, 40000)) {
                val (w, h) = bitmapMasse(breite, ratio)
                assert(w >= 1 && h >= 1) { "Masse $w x $h bei ($breite, $ratio) — 0 ist keine Bitmap" }
                assert(w.toLong() * h <= PDF_BITMAP_MAX_PX) {
                    "($breite, $ratio) ergibt ${w.toLong() * h} Pixel, erlaubt sind $PDF_BITMAP_MAX_PX"
                }
                assert(w <= breite.coerceAtLeast(1)) {
                    "($breite, $ratio) ergibt $w — breiter als gewuenscht wird nie gerendert"
                }
            }
        }
        // Eine Breite von 0 oder weniger darf keine leere Bitmap ergeben.
        for (b in listOf(0, -1, -5000)) {
            val (w, h) = bitmapMasse(b, A4)
            assert(w >= 1 && h >= 1) { "Breite $b ergab $w x $h" }
        }
    }

    // ── Die drei Entscheidungen, die man versehentlich umdrehen kann ─────────

    private val quelle: String by lazy {
        Quellen.ohneKommentare(Quellen.lies("ui/screens/PdfViewerScreen.kt"))
    }

    @Test
    fun `die Geste beansprucht keine Einfinger-Zuege`() {
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
    fun `transformable steht hinter horizontalScroll`() {
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
    fun `beim Stufenwechsel bleibt die alte Seite stehen`() {
        // remember OHNE die Renderbreite, LaunchedEffect MIT ihr: nur so wird neu
        // gerendert, ohne dass die Anzeige vorher leer wird.
        assert(Regex("""var bitmap by remember\(file, index\)""").containsMatchIn(quelle)) {
            "Der Bitmap-Zustand haengt nicht mehr nur an (file, index). Haengt er " +
                "auch an der Renderbreite, wird er beim Stufenwechsel zurueckgesetzt: " +
                "auf allen sichtbaren Seiten blitzt der Ladekreis auf, und weil leere " +
                "Seiten eine andere Hoehe haben als gerenderte, verliert man beim " +
                "Zoomen die Stelle."
        }
        assert(Regex("""LaunchedEffect\(file, index, renderBreitePx\)""").containsMatchIn(quelle)) {
            "Der LaunchedEffect haengt nicht an renderBreitePx — dann wird beim " +
                "Zoomen nie in hoeherer Aufloesung nachgerendert und das Bild bleibt grob."
        }
        assert(Regex("""if \(neu != null\) bitmap = neu""").containsMatchIn(quelle)) {
            "Die neue Bitmap wird nicht mehr nur bei Erfolg uebernommen. Scheitert " +
                "ein Render, waere die Seite danach leer statt in der alten Aufloesung da."
        }
    }

    @Test
    fun `der Doppeltipp liest den aktuellen Zoom, nicht den von damals`() {
        // pointerInput(Unit) wird absichtlich nicht neu aufgesetzt — sonst riss
        // jede Neuberechnung eine laufende Geste ab. Dafuer haelt der Block die
        // Huelle der ERSTEN Komposition fest. Liest der Doppeltipp `zoom`
        // unmittelbar, sieht er fuer immer 1 und zoomt nur noch hinein.
        //
        // Das ist der Fehler, der beim Ausprobieren nicht auffaellt: Hineinzoomen
        // geht, und dass das Zurueckzoomen nicht geht, haelt man fuer die
        // Bedienung.
        assert(quelle.contains("val zoomJetzt by rememberUpdatedState(zoom)")) {
            "Es gibt kein rememberUpdatedState fuer den Zoom mehr — dann liest der " +
                "Doppeltipp den eingefrorenen Wert aus der ersten Komposition."
        }
        val tipp = Regex("detectTapGestures\\(onDoubleTap = \\{(.*?)\\}\\)", RegexOption.DOT_MATCHES_ALL)
            .find(quelle)?.groupValues?.get(1)
        assert(tipp != null) { "Kein detectTapGestures(onDoubleTap = ...) mehr gefunden." }
        assert(tipp!!.contains("zoomJetzt") && tipp.contains("setzeZoomJetzt")) {
            "Der Doppeltipp greift nicht auf die nachgefuehrten Werte zu:\n$tipp"
        }
        assert(!Regex("[^A-Za-z]zoom[^A-Za-z]").containsMatchIn(tipp)) {
            "Der Doppeltipp liest `zoom` unmittelbar — das ist der eingefrorene " +
                "Wert aus der ersten Komposition:\n$tipp"
        }
    }


    @Test
    fun `waehrend einer Zwei-Finger-Geste rollt die Liste nicht`() {
        // Die eine Schwaeche, die beim Bauen schon benannt war: Die LazyColumn
        // ist das TIEFERE Glied und sieht die Bewegung vor dem transformable.
        // Geht eine Geste auch nur ein wenig senkrecht auseinander, beansprucht
        // sie die Liste — und gezoomt wird nicht. Marcos Befund: „Das zoomen in
        // der Android-App verhaelt sich noch nicht gut."
        assert(quelle.contains("userScrollEnabled = !zweiFinger")) {
            "Die Liste rollt waehrend einer Zwei-Finger-Geste weiter. Dann gewinnt " +
                "sie den Streit um die Bewegung und der Zoom kommt nicht zum Zug."
        }
        assert(quelle.contains("awaitPointerEvent(PointerEventPass.Initial)")) {
            "Die Finger werden nicht mehr im Initial-Durchgang gezaehlt. Nur dort " +
                "sieht der Zaehler sie VOR der Liste; im Main-Durchgang kaeme er zu spaet."
        }
        // Der Zaehler darf NICHTS beanspruchen — sonst ist es derselbe Streit
        // mit vertauschten Rollen.
        val block = Regex(
            "awaitPointerEventScope \\{(.*?)\\n {16}\\}", RegexOption.DOT_MATCHES_ALL
        ).find(quelle)?.groupValues?.get(1)
        assert(block != null) { "Kein awaitPointerEventScope-Block mehr gefunden." }
        assert(!block!!.contains("consume()")) {
            "Der Finger-Zaehler beansprucht Ereignisse:\n$block"
        }
    }

    @Test
    fun `der Zoom haelt die Stelle fest`() {
        // Ohne Anker waechst die Seite aus der oberen linken Ecke heraus: Wer in
        // eine Teilenummer hineinzoomt, sieht danach einen anderen Ausschnitt.
        assert(Regex("""senkrecht\.scrollToItem\(""").containsMatchIn(quelle)) {
            "Senkrecht wird nicht nachgefuehrt — beim Zoomen verliert man die Stelle."
        }
        assert(Regex("""firstVisibleItemScrollOffset \* f""").containsMatchIn(quelle)) {
            "Der Versatz wird nicht mit dem Zoomfaktor mitgerechnet. Ohne das bleibt " +
                "die Zahl stehen, waehrend die Seite waechst — die Anzeige wandert."
        }
        assert(Regex("""waagrecht\.scrollTo\(""").containsMatchIn(quelle)) {
            "Waagerecht wird nicht nachgefuehrt. Beim Hineinzoomen aus 1x waechst die " +
                "Seite sonst nach rechts aus dem Bild."
        }
        // scrollToItem und NICHT scrollBy: Ein Delta waere je nach Zeitpunkt
        // gegen die alte oder die neue Groesse gerechnet.
        assert(!Regex("""senkrecht\.scrollBy\(""").containsMatchIn(quelle)) {
            "Senkrecht wird mit einem Delta nachgefuehrt. Das ist je nach Zeitpunkt " +
                "gegen die alte oder die neue Seitengroesse gerechnet; scrollToItem " +
                "(Index + Versatz) ist davon unabhaengig."
        }
        // EIN langlebiger Effekt, nicht einer je Zoomwert.
        assert(Regex("""snapshotFlow \{ zoomJetzt \}""").containsMatchIn(quelle)) {
            "Die Nachfuehrung haengt nicht mehr an einem snapshotFlow. Mit dem Zoom als " +
                "Effekt-Schluessel wird sie bei jedem Bild der Geste abgebrochen und neu " +
                "gestartet — und jede abgebrochene Nachfuehrung ist ein Stueck Abdrift."
        }
    }

    @Test
    fun `der Zoom laeuft nicht ueber einen graphicsLayer`() {
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
