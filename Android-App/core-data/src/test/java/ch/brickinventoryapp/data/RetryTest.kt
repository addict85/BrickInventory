package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.NetworkState.RetryPolicy
import ch.brickinventoryapp.data.repository.Outcome
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The retry rule of the fetches: only on temporary errors, with
 * growing pause, and without network not at all — then the store shows its state.
 *
 * Counter-checks (kotlinc and JUnit against NetworkState.Wiederholung):
 *   A  the pause not doubled → red “a temporary error is retried with
 *      growing pause” ([1000, 1000, 1000, 1000])
 *   B  the check for NO_NETWORK removed → red “without network there is no waiting”
 *   C  the check `transient` removed → red “an answer of the server is not
 *      retried”
 */
class RetryTest {

    private val pauses = mutableListOf<Long>()
    private var situation = NetworkState.Kind.WIFI

    private fun rule(attempts: Int = 5) = RetryPolicy.forTest(attempts, { situation }) { pauses += it }

    private fun fetches(vararg results: Outcome<String>): Pair<MutableList<Outcome<String>>, suspend () -> Outcome<String>> {
        val rest = results.toMutableList()
        val called = mutableListOf<Outcome<String>>()
        return called to { rest.removeAt(0).also { called += it } }
    }

    @Test
    fun `a temporary error is retried with growing pause`() = runBlocking {
        val network = Outcome.Failure.Network()
        val (called, fetch) = fetches(network, network, network, network, Outcome.Success("da"))
        assertEquals(Outcome.Success("da"), rule().retry(fetch))
        assertEquals(5, called.size)
        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L), pauses)
    }

    @Test
    fun `after the last attempt the error comes back`() = runBlocking {
        val network = Outcome.Failure.Timeout
        val (called, fetch) = fetches(network, network, network)
        assertEquals(network, rule(attempts = 3).retry(fetch))
        assertEquals(3, called.size)
    }

    @Test
    fun `without network there is no waiting`() = runBlocking {
        situation = NetworkState.Kind.NO_NETWORK
        val (called, fetch) = fetches(Outcome.Failure.Network(), Outcome.Success("nie"))
        assertEquals(Outcome.Failure.Network(), rule().retry(fetch))
        assertEquals(1, called.size)
        assertEquals(emptyList<Long>(), pauses)
    }

    @Test
    fun `an answer of the server is not retried`() = runBlocking {
        val (called, fetch) = fetches(Outcome.Failure.Server(404), Outcome.Success("nie"))
        assertEquals(Outcome.Failure.Server(404), rule().retry(fetch))
        assertEquals(1, called.size)
    }

    @Test
    fun `at most limits the attempts, never below one`() = runBlocking {
        val network = Outcome.Failure.Network()
        val (called, fetch) = fetches(network, network, network)
        rule().atMost(2).retry(fetch)
        assertEquals(2, called.size)
        val (once, fetch2) = fetches(network)
        rule().atMost(0).retry(fetch2)
        assertEquals(1, once.size)
    }
}
