package ch.brickinventoryapp.model.ui

/**
 * A sentence in building blocks, for the snackbar as for error fields in the state. ViewModel
 * and data layer name resource and values; the sentence is formed only by the UI in
 * the language it is currently showing. A finished string in the state would stay in the
 * old language after a language switch, and a test could only compare text.
 */

sealed interface Message {
    /** A finished sentence, e.g. the server's. */
    data class Text(val text: String) : Message

    /** A sentence from the resources and its values; a value may itself be a message. */
    data class Resource(val id: Int, val values: List<Any> = emptyList()) : Message

    /** A quantity sentence (plurals): [count] chooses the form, [values] fill it. */
    data class Quantity(val id: Int, val count: Int, val values: List<Any> = listOf(count)) : Message
}
