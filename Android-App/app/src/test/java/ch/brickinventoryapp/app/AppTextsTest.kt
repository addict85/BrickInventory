package ch.brickinventoryapp.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.LoginState
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.model.domain.ErrorCode
import ch.brickinventoryapp.model.util.TextSource
import ch.brickinventoryapp.state.ui.viewmodel.AppTexts
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The one place that turns an error kind into a sentence, with real resources:
 * if the server sends a sentence, its sentence applies — it knows the case better and answers
 * in the account's language —, also for 401 and with an error code. Without a sentence
 * the app formulates itself.
 *
 * Counter-checks (patches under counter-checks/, Robolectric, measured by CI):
 *   servermeldung-ohne-vorrang   the check for failure.message removed → red “the server's sentence …”
 *   servermeldung-nach-code      the error code before the server message → red “the server's sentence …”
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AppTextsTest {

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val texts = AppTexts(object : TextSource {
        override fun text(id: Int, vararg args: Any?) = ctx.getString(id, *args)
        override fun quantity(id: Int, count: Int, vararg args: Any?) = ctx.resources.getQuantityString(id, count, *args)
    }, object : LoginState {
        override val authTokenState: StateFlow<String?> = MutableStateFlow("token")
    })

    @Test
    fun `the server's sentence takes precedence over any own one`() {
        val sentence = "Für dieses Datum gibt es schon einen Kaufpreis"
        assertEquals(sentence, texts.message(Outcome.Failure.Server(409, sentence)))
        assertEquals("also on 401", "Benutzername oder Passwort falsch",
            texts.message(Outcome.Failure.Rejected("Benutzername oder Passwort falsch")))
        assertEquals("also with an error code", sentence, texts.message(Outcome.Failure.Server(429, sentence, ErrorCode.TOO_MANY_CONNECTIONS)))

        val own = texts.message(Outcome.Failure.Server(500))
        assertTrue("without a sentence from the server none is shown", own.isNotBlank())
        assertNotEquals(own, texts.message(Outcome.Failure.Server(429, "", ErrorCode.TOO_MANY_CONNECTIONS)))
    }
}
