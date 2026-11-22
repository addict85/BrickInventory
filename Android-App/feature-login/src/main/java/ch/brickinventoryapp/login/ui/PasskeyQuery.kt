package ch.brickinventoryapp.login.ui

/**
 * The call to the Credential Manager. It needs an Activity and the
 * Play services; the ViewModel only needs its result and is therefore handed
 * the query from the screen (a fake in the test).
 */
internal fun interface PasskeyQuery {
    /** [optionsJson]: the server's WebAuthn options, unchanged. */
    suspend fun fetch(optionsJson: String): PasskeyResult
}

internal sealed interface PasskeyResult {
    /** The authenticator's answer as WebAuthn JSON, for the server. */
    data class Response(val json: String) : PasskeyResult
    /** Dialog closed: that is a decision, not an error. */
    data object Cancelled : PasskeyResult
    data object NoPasskey : PasskeyResult
    data class Failure(val reason: String?) : PasskeyResult
}
