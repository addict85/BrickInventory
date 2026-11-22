package ch.brickinventoryapp.app

import org.junit.Test
import ch.brickinventoryapp.testing.Sources

/**
 * State belongs in an instance, not at file level.
 *
 * ── The finding ──────────────────────────────────────────────────────────────
 * The feature files are extension functions on MainViewModel, and an
 * extension has no fields. What they had to remember anyway — which
 * loading job to cancel, which filter generation currently applies — therefore stood
 * as `private var` at FILE LEVEL:
 *
 *     private var catalogSearchJob, catalogListJob, catalogDetailJob
 *     private var catalogGeneration
 *     private var gallerySearchJob, galleryListJob, galleryGeneration
 *
 * That is process-wide mutable state. The comment in
 * CatalogFeature.kt even said so itself: „Job-Referenz prozessweit am VM".
 * It only works as long as there is exactly one instance per process. Two would
 * share cancellation jobs and generation — one load would cancel the other,
 * and nobody would think of looking there.
 *
 * For the catalog it is fixed: the functions stand in CatalogViewModel and
 * hold their jobs as fields.
 *
 * ── And the gallery? ─────────────────────────────────────────────────────────
 * It had the same three. An own GalleryViewModel would have been the
 * wrong answer here though: GalleryFeature writes seventeen times into AppUiState,
 * and `sets` is read in SIXTEEN files — barcode, SetDetail, catalog,
 * parts list. That is app state, not screen state; extracted it would be
 * the same god object under a new name, with wiring in sixteen
 * files on top.
 *
 * The three variables have therefore become FIELDS of the MainViewModel — exactly
 * where `partsJob` has always been. So the project already knew the right
 * answer; the gallery just did not follow its own pattern.
 *
 * Thus no exception is left in the list, and the rule applies to ui/
 * completely.
 *
 * Counter-check (performed): `private var catalogGeneration = 0` put back at
 * file level → the check reports file and line. Without the return
 * it reports nothing.
 */
class NoFileWideStateTest {

    /**
     * Empty — and it should stay that way.
     *
     * The second test below reports every entry that is no longer
     * needed. An entry here is a reminder, not a carte blanche.
     */
    private val stillOpen = emptySet<String>()

    @Test
    fun `no feature file holds mutable state at file level`() {
        val files = Sources.below("ui")
        val findings = mutableListOf<String>()
        for (f in files) {
            if (f.name in stillOpen) continue
            Sources.withoutComments(f.readText()).lines().forEachIndexed { i, z ->
                // Column 0 AND no `remember`. Indentation alone is not enough in
                // this tree: BarcodeResultDialog.kt was extracted from
                // AppNavigation.kt without reindenting the body
                // — there `var x by remember { … }` stand in
                // column 0 and are still in the composable. `remember` EXISTS
                // only there; it is thus the reliable distinguishing
                // feature, not the column.
                if (Regex("""^(?:private |internal |public )?var \w+""").containsMatchIn(z) &&
                    !z.contains("remember")
                )
                    findings += "${f.name}:${i + 1}  ${z.trim()}"
            }
        }
        assert(findings.isEmpty()) {
            "Veraenderlicher Zustand auf Dateiebene ist prozessweit — er ueberlebt " +
                "jede Instanz und wird zwischen allen geteilt:\n  " + findings.joinToString("\n  ")
        }
    }

    @Test
    fun `the exception list contains nothing dead`() {
        // The same rule as in StateDomainBoundaryTest: an exception that
        // nobody needs any more is a permission that nobody checks any more.
        val dead = stillOpen.filter { name ->
            val f = Sources.all().firstOrNull { it.name == name } ?: return@filter true
            Sources.withoutComments(f.readText()).lines().none {
                Regex("""^(?:private |internal |public )?var \w+""").containsMatchIn(it) &&
                    !it.contains("remember")
            }
        }
        assert(dead.isEmpty()) {
            "Diese Dateien stehen als offen in der Liste, halten aber keinen " +
                "dateiweiten Zustand mehr — Eintrag loeschen, dann gilt die Regel " +
                "auch fuer sie: ${dead.joinToString()}"
        }
    }
}
