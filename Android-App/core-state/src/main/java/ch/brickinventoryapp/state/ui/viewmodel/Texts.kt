package ch.brickinventoryapp.state.ui.viewmodel

import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.network.util.reportsTheSessionLayer

/**
 * Texts and error messages for the extracted ViewModels.
 *
 * An interface instead of the Context, so a ViewModel can be built
 * and run without a device: the test supplies an implementation that returns the
 * resource number. The implementation for the device is AppTexts.
 */
interface Texts {
    fun text(id: Int, vararg args: Any?): String
    fun quantity(id: Int, count: Int, vararg args: Any?): String
    /** For error fields in forms — there, „nothing to say“ is not an answer. */
    fun message(error: Outcome.Failure): String
    /** Null means: the session layer has already reported the error. */
    fun messageForSnackbar(error: Outcome.Failure): String? =
        if (reportsTheSessionLayer(error is Outcome.Failure.Rejected, loggedIn())) null else message(error)
    /** Is there a token? The same source the interceptor reads. */
    fun loggedIn(): Boolean
}
