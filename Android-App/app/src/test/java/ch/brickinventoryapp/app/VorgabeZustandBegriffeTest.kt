package ch.brickinventoryapp.app

import android.content.Context
import android.content.res.Configuration
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.ressourcen.R
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.Locale

/**
 * Die zwei Vorgaben für den Zustand beim Hinzufügen, wie die App sie in beiden Sprachen
 * lädt: Die eigene (Einstellungen) und die für alle Konten (Hintergrundarbeiten) heissen
 * verschieden, und der Hinweis zur eigenen nennt die Wahl, die es wirklich gibt.
 *
 * Gegenproben (Patches unter gegenproben/, Robolectric, misst die CI):
 *   zwei-vorgaben-gleich-benannt  beide wieder „Standard-Zustand“ → rot „die eigene Vorgabe …“
 *   hinweis-nennt-leer            Hinweis wieder „Leer = globale Vorgabe …“ → rot „der Hinweis …“
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class VorgabeZustandBegriffeTest {

    private val sprachen = listOf(Locale.forLanguageTag("de-CH"), Locale.ENGLISH)

    private fun inSprache(sprache: Locale): Context {
        val ctx: Context = ApplicationProvider.getApplicationContext()
        return ctx.createConfigurationContext(Configuration(ctx.resources.configuration).apply { setLocale(sprache) })
    }

    @Test
    fun `die eigene Vorgabe und die fuer alle Konten heissen verschieden`() {
        for (sprache in sprachen) {
            val c = inSprache(sprache)
            assertNotEquals("$sprache: zweimal derselbe Name", c.getString(R.string.settings_default_condition),
                c.getString(R.string.monitoring_default_condition))
        }
    }

    @Test
    fun `der Hinweis nennt die Wahl, die neben Neu und Gebraucht steht`() {
        for (sprache in sprachen) {
            val c = inSprache(sprache)
            val wahl = c.getString(R.string.settings_default_condition_global)
            val hinweis = c.getString(R.string.settings_default_condition_hint)
            assertTrue("$sprache: „$hinweis“ nennt „$wahl“ nicht", Regex("[„“\"]${Regex.escape(wahl)}[“”\"]").containsMatchIn(hinweis))
        }
    }
}
