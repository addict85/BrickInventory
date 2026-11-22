package ch.brickinventoryapp.app

import android.content.Context
import android.content.res.Configuration
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.resources.R
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Locale

/**
 * The two defaults for the condition when adding, as the app loads them in both languages:
 * the own one (settings) and the one for all accounts (background work) have different
 * names, and the hint for the own one names the choice that really exists.
 *
 * Counter-checks (patches under gegenproben/, Robolectric, measured by CI):
 *   zwei-vorgaben-gleich-benannt  both again „Standard-Zustand“ → red “the own default …”
 *   hinweis-nennt-leer            hint again „Leer = globale Vorgabe …“ → red “the hint …”
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class DefaultStateTermsTest {

    private val languages = listOf(Locale.forLanguageTag("de-CH"), Locale.ENGLISH)

    private fun inLanguage(sprache: Locale): Context {
        val ctx: Context = ApplicationProvider.getApplicationContext()
        return ctx.createConfigurationContext(Configuration(ctx.resources.configuration).apply { setLocale(sprache) })
    }

    @Test
    fun `the own default and the one for all accounts have different names`() {
        for (sprache in languages) {
            val c = inLanguage(sprache)
            assertNotEquals("$sprache: zweimal derselbe Name", c.getString(R.string.settings_default_condition),
                c.getString(R.string.monitoring_default_condition))
        }
    }

    @Test
    fun `the hint names the choice next to New and Used`() {
        for (sprache in languages) {
            val c = inLanguage(sprache)
            val wahl = c.getString(R.string.settings_default_condition_global)
            val hinweis = c.getString(R.string.settings_default_condition_hint)
            assertTrue("$sprache: „$hinweis“ nennt „$wahl“ nicht", Regex("[„“\"]${Regex.escape(wahl)}[“”\"]").containsMatchIn(hinweis))
        }
    }
}
