package ch.brickinventoryapp.state.ui.viewmodel

import ch.brickinventoryapp.data.LoginState
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.repository.errorTextToCode
import ch.brickinventoryapp.model.util.TextSource
import ch.brickinventoryapp.state.ui.errorTextArgument
import ch.brickinventoryapp.state.ui.errorTextId
import ch.brickinventoryapp.state.ui.withTechnicalCause
import javax.inject.Inject

/** In the app's language, not the system's: the text source fetches it via LanguageManager. */
class AppTexts @Inject constructor(
    private val source: TextSource,
    private val prefs: LoginState,
) : Texts {
    override fun text(id: Int, vararg args: Any?): String = source.text(id, *args)

    override fun quantity(id: Int, count: Int, vararg args: Any?): String = source.quantity(id, count, *args)

    override fun loggedIn() = prefs.authTokenState.value?.isNotBlank() == true

    override fun message(error: Outcome.Failure): String {
        if (error.message.isNotBlank()) return error.message
        errorTextToCode(error.code)?.let { return text(it) }
        val id = errorTextId(error)
        val sentence = errorTextArgument(error)?.let { text(id, it) } ?: text(id)
        return withTechnicalCause(sentence, error)
    }
}
