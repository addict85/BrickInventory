package ch.brickinventoryapp.dataapi.message

import ch.brickinventoryapp.model.text.Message
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * One path for transient messages — the snackbar has exactly one place on the
 * screen, so there is exactly one channel to it. With one channel per ViewModel
 * every place that uses a ViewModel would need a forwarding block;
 * if it is missing, the messages disappear silently.
 */
interface MessageChannel {
    val message: StateFlow<Message?>
    fun show(message: Message?)

    /** A finished sentence; null shows nothing. */
    fun show(text: String?) = show(text?.let(Message::Text))
    fun acknowledge()

    /** The one way to build it, for Hilt and tests alike; the implementation stays internal. */
    companion object {
        operator fun invoke(): MessageChannel = MessageQueue()
    }
}

internal class MessageQueue : MessageChannel {

    private val _message = MutableStateFlow<Message?>(null)
    private val queue = ArrayDeque<Message>()

    /** The message whose turn it is; null means: nothing to show. */
    override val message: StateFlow<Message?> = _message.asStateFlow()

    /**
     * Queues [message]; null shows nothing. A second message waits until the
     * first is acknowledged instead of replacing it. The same message twice
     * in a row comes only once, and no more than [PLACES] wait.
     */
    override fun show(message: Message?) {
        if (message == null) return
        synchronized(queue) {
            when {
                _message.value == null -> _message.value = message
                message == (queue.lastOrNull() ?: _message.value) -> Unit
                queue.size < PLACES -> queue.addLast(message)
            }
        }
    }

    /** The displayed message is done (seen or superseded); the next one moves up. */
    override fun acknowledge() {
        synchronized(queue) { _message.value = queue.removeFirstOrNull() }
    }

    private companion object {
        /** Nobody reads more than a few messages in a row; the oldest count. */
        const val PLACES = 5
    }
}
