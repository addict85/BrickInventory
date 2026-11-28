package ch.brickinventoryapp.app

import ch.brickinventoryapp.testing.Sources
import org.junit.Test

/**
 * All ViewModels are ordinary ViewModels — none inherits its context.
 *
 * ── Why that is more than uniformity ─────────────────────────────────────────
 * `MainViewModel` was the ONLY `AndroidViewModel` in the tree. CatalogViewModel
 * and MonitoringViewModel are ordinary `ViewModel`s and get the
 * context injected — just like PreviewMemory, PreferencesManager and
 * PdfExportManager. So two patterns for the same thing, and the rarer one was
 * the more expensive:
 *
 * `AndroidViewModel` requires a real `Application` in the constructor. That way
 * the class cannot be built in a JVM test — and that is the reason
 * why the large part of the Android tests READS source instead of executing
 * code. A test can then only check the assumption „loadSets() sets the loading state“
 * on the wording, not on the flow.
 *
 * The context has stayed the same: `getApplication<Application>()
 * .applicationContext` and Hilt's `@ApplicationContext` deliver the same
 * object. What changes is only that it comes in through the door instead of from
 * the superclass — and thus is replaceable in a test.
 *
 * This check keeps the path open. It does NOT claim that the
 * behavior tests already exist; it prevents the door from closing again.
 *
 * Counter-checks (performed, via the stand-in script in the tools folder):
 *   a) MainViewModel set back to `AndroidViewModel(application)`
 *      → sub-step 1 red.
 *   b) the `@ApplicationContext` parameter removed → sub-step 2 red.
 */
class ViewModelDesignTest {

    private fun viewModelFiles() = Sources.all()
        .filter { it.name.endsWith("ViewModel.kt") }
        .map { it.name to Sources.withoutComments(it.readText()) }

    @Test
    fun `no ViewModel inherits its context`() {
        val files = viewModelFiles()
        assert(files.size >= 3) {
            "Only ${files.size} ViewModel files found — pattern outdated? " +
                "An empty search would be silently green."
        }
        val hits = files.filter { (_, s) -> s.contains("AndroidViewModel") }.map { it.first }
        assert(hits.isEmpty()) {
            "Diese ViewModels erben von AndroidViewModel: ${'$'}{hits.joinToString()}.\n" +
                "AndroidViewModel requires a real Application in the constructor — the class " +
                "then cannot be built in any JVM test. The Context comes via " +
                "@ApplicationContext, as in CatalogViewModel and in the whole data layer."
        }
    }

    @Test
    fun `whoever needs a context gets it injected`() {
        // The opposite direction: a ViewModel that uses ctx must also have
        // declared it. Otherwise the rule above could be circumvented by a silent
        // recourse to some other source.
        for ((name, s) in viewModelFiles()) {
            // `ctx\.` with a dot no longer applies here: since the messages run via
            // AppLanguage.localizedContext(ctx), the context stands
            // almost everywhere as an ARGUMENT, not as receiver. The first version
            // of this rule was thus ineffective — it stood out in the
            // counter-check that stayed green.
            if (!Regex("""\bctx\b""").containsMatchIn(s)) continue
            assert(s.contains("@param:ApplicationContext")) {
                "$name uses ctx but does not get it via @ApplicationContext"
            }
        }
    }
}
