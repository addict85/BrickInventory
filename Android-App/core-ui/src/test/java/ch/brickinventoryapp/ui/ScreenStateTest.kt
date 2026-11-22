package ch.brickinventoryapp.ui

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Sources

/**
 * Screen state survives rotation and process death.
 *
 * ── The finding ──────────────────────────────────────────────────────────────
 *
 * Almost all screen state lived in `remember { mutableStateOf(...) }`. That
 * holds only per composition: on a screen rotation, a switch into
 * dark mode, or after Android has killed the process in the background,
 * everything starts over at the default. For users that means: search field
 * empty, filters reset, half-filled dialog gone.
 *
 * `rememberSaveable` stores the value in the Bundle and restores it.
 *
 * ── Why NOT blanket ────────────────────────────────────────────────────────
 *
 * There are three kinds of state, and the distinction is the actual
 * substance of this check:
 *
 *  1. What a human has entered or chosen — search term, filter,
 *     opened dialog, form fields. This SHOULD survive.
 *
 *  2. What describes an ongoing operation — `isLoading`, `queueLoading`.
 *     This must NOT survive: if `isLoading = true` came back after a rotation,
 *     the coroutine that resets it would no longer be running — the
 *     loading spinner would stay forever.
 *
 *     This also includes an ongoing DRAG GESTURE (`dragging`, `dragShare` in
 *     the catalog's year bar). It used to sit on `rememberSaveable`
 *     and thus fell under neither of the two kinds. If `dragging = true` came
 *     back after a rotation, no finger would be on the bar anymore — the
 *     label would stay put until someone drags next. The same trap
 *     as with the loading spinner, hence the same rule.
 *
 *  3. What was measured ONCE — the occupancy of the preview cache on
 *     disk. This also must NOT survive, but for the opposite
 *     reason: not because the producer would still be running, but because NO ONE
 *     refreshes it anymore — the restored number would stand there
 *     permanently wrong. See the expression `measured` further below;
 *     it also explains why a layout measurement is explicitly NOT
 *     included.
 *
 *  4. Passwords and codes. The Bundle sits on disk on process death;
 *     they don't belong in it and are entered again after a rotation.
 *     Counter-check: `pwNew` in StartPasswordMask back on
 *     `rememberSaveable` → red „Passwoerter und Codes …“; the exception `secret`
 *     removed from the first test → red „vom Menschen eingegebener Zustand …“.
 *
 * The same trap has already snapped shut once in this tree: ScrollMemory.kt
 * notes in its own explanation that the marker there as
 * `rememberSaveable` "permanently disabled restoration after the first
 * visit". That's why this file is explicitly
 * excluded here.
 */
class ScreenStateTest {

    private val uiRoot = File(Sources.root, "ui")

    // All UI files: every module has its ui/ under its own package root.
    private fun kotlinFiles(): List<File> = Sources.below("ui")

    /** Lines of the form `var x by remember { mutableStateOf(...) }` — without comment lines. */
    private fun stateRows(f: File): List<Pair<Int, String>> =
        f.readLines().mapIndexed { i, z -> (i + 1) to z }
            .filter { (_, z) ->
                val t = z.trim()
                !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*") &&
                    Regex("""\bby\s+remember(Saveable)?\s*\{\s*mutableStateOf\(""").containsMatchIn(z)
            }

    private val nameFrom = Regex("""\b(?:var|val)\s+(\w+)\s+by\s+remember""")

    /**
     * State of a RUNNING OPERATION — this must not be restored.
     *
     * `export` was added later (BrickLink wishlist): the list knew
     * "laeuft", "loading", "saving" — but not the spelling actually
     * used in the tree. `isExporting` on the PDF button had therefore
     * always been `rememberSaveable` and is the case this rule is built against:
     *
     * The lesson is the same as for this whole series: one thing in two
     * spellings, and the search only knows one.
     */
    private val transient = Regex("""(?i)load|loading|busy|running|running|load|pending|saving|saves|scanning|scannt|progress|progress|zieh|drag|export|focus|focus|finger""")

    // ── „finger" was added with the zoom in the PDF viewer ────────────────────
    //
    // `twoFinger` in PdfViewerScreen.kt records whether two fingers are
    // CURRENTLY on the glass; as long as they are, the list doesn't scroll, so
    // the two-finger gesture gets through for zooming.
    //
    // After a rotation, no finger is on the glass anymore. A
    // restored "two fingers are down" would leave the list permanently
    // locked until someone next touches it with two fingers — the
    // list would no longer scroll, and no one would find the cause.
    //
    // That's the same trap as with the ongoing drag gesture (`dragging`)
    // further up: a value survives, the event that resets it
    // is gone. A finger count always describes the gesture of now, never
    // something a person entered.

    /**
     * Markers for scroll-position restoration — must survive EVEN LESS.
     *
     * ── Why this is its own category ──────────────────────
     *
     * In the first pass of this conversion, only an exception for the
     * FILE ScrollMemory.kt stood here. But CatalogScreen.kt has its own,
     * identically-named marker — the same mechanism, a different file. It got
     * caught too, and ListScrollPositionTest failed over it.
     *
     * Rightly so: if such a marker survives the trip to the detail page, the
     * list counts as restored forever after the very first visit, and
     * returning never scrolls back again.
     *
     * That's why the KIND of state is now checked, not its location.
     */
    private val rollMarker = Regex("""(?i)restored|userGesture|hadSaved""")

    /**
     * ONE-TIME MEASURED VALUES — these must be read anew, not restored.
     *
     * The case: `storeBytes` in MonitoringSections.kt records how many
     * bytes the preview cache under filesDir occupies. The value is read ONCE
     * when the row is built and after that only updated by the clear
     * button.
     *
     * If it sat on `rememberSaveable`, the number would come back from the
     * Bundle after a process death — but the cache on disk may have
     * changed in the meantime (another screen filled it, Android killed the
     * process between two sessions). A wrong number would then
     * stand there permanently, because NOTHING reads it again. The same trap
     * as with the loading spinner: a value survives, the page that
     * produces it is no longer running.
     *
     * ── The boundary, and why it doesn't mean "every measurement" ──────────
     *
     * `heightPx` in CatalogScreen.kt is ALSO a measurement and rightly sits
     * on `rememberSaveable`: it comes from `onSizeChanged`, and this producer
     * runs again right after a rotation — the restored value
     * gets overwritten in the next layout pass anyway and only
     * bridges that one frame in between.
     *
     * What matters, then, isn't THAT something was measured, but whether the
     * producer still runs after the rotation. That's why this expression
     * only covers cache-occupancy measurements, not layout sizes.
     */
    private val measured = Regex("""(?i)bytes|occupied|belegung""")

    /**
     * Passwords and codes (kind 4): never in the Bundle. Likewise `unlocked` of
     * the step lock: fetched back from the Bundle, it would bypass the device lock.
     */
    private val secret = Regex("""(?i)passw|^pw(?!$)|^(zf|factor)?code$|^unlocked$""")

    /** Values the Bundle cannot hold. */
    private val notSavable = Regex("""Offset|listOf|mapOf|setOf|Bitmap""")

    /**
     * ZoomableImageDialog: scale and offset belong together; the offset
     * is not saveable, so only half the job would be saved.
     *
     * ── ScrollMemory.kt stood here and was unnecessary ──────────────────────
     *
     * Verified, not assumed: NO line of this file reaches the rule at all.
     * Its four markers are named `restored`,
     * `hadSaved` and `userGesture` — all already covered by `rollMarker`.
     *
     * The check hinges on the KIND of state (see the KDoc on rollMarker), not
     * on its location; an exception per file would exempt every later state too.
     */
    private val excepted = setOf("ZoomableImageDialog.kt")

    /** Secret, transient, scroll marker, measured or not saveable: these states stay on remember. */
    private fun mayBeForgotten(name: String, row: String): Boolean =
        secret.containsMatchIn(name) || transient.containsMatchIn(name) || rollMarker.containsMatchIn(name) ||
            measured.containsMatchIn(name) || notSavable.containsMatchIn(row)

    @Test
    fun `state entered by a human survives a rotation`() {
        val missed = mutableListOf<String>()
        val exceptionUsed = mutableSetOf<String>()
        for (f in kotlinFiles()) {
            for ((zn, z) in stateRows(f)) {
                if ("rememberSaveable" in z) continue
                val name = nameFrom.find(z)?.groupValues?.get(1) ?: continue
                if (mayBeForgotten(name, z)) continue
                // An excluded file is still SEARCHED: its match
                // proves the exception still describes something. If it were
                // skipped outright instead, a dead entry would stay in place
                // for years and block a whole file — exactly that is what had
                // happened with ScrollMemory.kt.
                if (f.name in excepted) { exceptionUsed += f.name; continue }
                missed += "${f.name}:$zn  $name"
            }
        }
        assertTrue(
            "Diese Zustände gehen bei einer Bildschirmdrehung verloren — " +
                "rememberSaveable statt remember:\n  " + missed.joinToString("\n  "),
            missed.isEmpty(),
        )
        val stale = (excepted - exceptionUsed).sorted()
        assertTrue(
            "Diese Ausnahmen beschreiben nichts mehr: " + stale.joinToString(", ") +
                " — die Datei hat keinen Zustand, den diese Pruefung ueberhaupt meldete. " +
                "Raus damit, sonst sperrt der Eintrag sie auch fuer alles Kuenftige.",
            stale.isEmpty(),
        )
    }

    @Test
    fun `running operation and scroll memory are NOT restored`() {
        val wrong = mutableListOf<String>()
        for (f in kotlinFiles()) {
            for ((zn, z) in stateRows(f)) {
                if ("rememberSaveable" !in z) continue
                val name = nameFrom.find(z)?.groupValues?.get(1) ?: continue
                if (transient.containsMatchIn(name) || rollMarker.containsMatchIn(name) ||
                    measured.containsMatchIn(name)
                ) wrong += "${f.name}:$zn  $name"
            }
        }
        assertTrue(
            "Ein laufender Vorgang, ein Merker der Rollpositions-" +
                "Wiederherstellung oder eine einmalig gemessene Belegung darf " +
                "NICHT wiederhergestellt werden — der Ladekringel bliebe für " +
                "immer stehen, die Rückkehr aus der Detailseite spränge nie " +
                "mehr zurück, bzw. es stünde dauerhaft eine falsche Zahl da:\n  " +
                wrong.joinToString("\n  "),
            wrong.isEmpty(),
        )
    }

    @Test
    fun `passwords and codes are not saved in the bundle`() {
        val found = mutableListOf<String>()
        val secured = mutableListOf<String>()
        for (f in kotlinFiles()) {
            for ((zn, z) in stateRows(f)) {
                val name = nameFrom.find(z)?.groupValues?.get(1) ?: continue
                if (!secret.containsMatchIn(name)) continue
                found += name
                if ("rememberSaveable" in z) secured += "${f.name}:$zn  $name"
            }
        }
        assertTrue("Keine Passwortfelder gefunden — greift die Suche?", "pwNew" in found && "password" in found)
        assertTrue("remember statt rememberSaveable:\n  " + secured.joinToString("\n  "), secured.isEmpty())
    }

    @Test
    fun `ScrollMemory deliberately uses remember and sticks to it`() {
        // Not for completeness's sake: this file has already had the bug
        // once before. A later batch conversion shouldn't
        // accidentally pick it up again.
        val f = File(uiRoot, "ScrollMemory.kt")
        assertTrue("ScrollMemory.kt gibt es nicht mehr — diese Prüfung anpassen", f.exists())
        val rows = stateRows(f)
        assertTrue("ScrollMemory.kt hat keinen remember-Zustand mehr", rows.isNotEmpty())
        assertTrue(
            "ScrollMemory.kt wurde auf rememberSaveable umgestellt. Genau das " +
                "schaltete die Wiederherstellung nach dem ersten Betreten für immer ab.",
            rows.none { "rememberSaveable" in it.second },
        )
    }
}
