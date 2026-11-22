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
 * Counter-checks (patches under counter-checks/, Robolectric, measured by CI):
 *   zwei-vorgaben-gleich-benannt  both again „Standard-Zustand“ → red “the own default …”
 *   hinweis-nennt-leer            hint again „Leer = globale Vorgabe …“ → red “the hint …”
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class DefaultStateTermsTest {

    private val languages = listOf(Locale.forLanguageTag("de-CH"), Locale.ENGLISH)

    private fun inLanguage(language: Locale): Context {
        val ctx: Context = ApplicationProvider.getApplicationContext()
        return ctx.createConfigurationContext(Configuration(ctx.resources.configuration).apply { setLocale(language) })
    }

    @Test
    fun `the own default and the one for all accounts have different names`() {
        for (language in languages) {
            val c = inLanguage(language)
            assertNotEquals("$language: zweimal derselbe Name", c.getString(R.string.settings_default_condition),
                c.getString(R.string.monitoring_default_condition))
        }
    }

    @Test
    fun `the hint names the choice next to New and Used`() {
        for (language in languages) {
            val c = inLanguage(language)
            val choice = c.getString(R.string.settings_default_condition_global)
            val hint = c.getString(R.string.settings_default_condition_hint)
            assertTrue("$language: “$hint” does not name “$choice”", Regex("[„“\"]${Regex.escape(choice)}[“”\"]").containsMatchIn(hint))
        }
    }
}
