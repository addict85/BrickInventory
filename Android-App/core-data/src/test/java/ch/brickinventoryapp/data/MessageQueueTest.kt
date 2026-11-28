package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.testing.text
import ch.brickinventoryapp.model.text.Message
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors

/**
 * Two messages shortly after one another: the second waits until the first is
 * acknowledged instead of replacing it. Writing happens only via show() and quittiere().
 *
 * Counter-checks:
 *   message-overwrites   show() sets the value directly → red “the second …”
 *   message-twice         without comparison with the last one → red “the same …” and
 *                           “a resource stays …” (measured with kotlinc: the same
 *                           resource comes twice)
 */
class MessageQueueTest {

    @Test
    fun `the second message waits for the acknowledgement of the first`() {
        val channel = MessageChannel()
        channel.show("gespeichert")
        channel.show("offline gemerkt")
        assertEquals("gespeichert", channel.text)
        channel.acknowledge()
        assertEquals("offline gemerkt", channel.text)
        channel.acknowledge()
        assertNull(channel.text)
    }

    @Test
    fun `a resource stays a domain value until the UI shows it`() {
        val channel = MessageChannel()
        channel.show(Message.Resource(7, listOf(3)))
        channel.show(Message.Resource(7, listOf(3)))
        channel.show(Message.Resource(7, listOf(4)))
        assertEquals(Message.Resource(7, listOf(3)), channel.message.value)
        channel.acknowledge()
        assertEquals("other values are a different message", Message.Resource(7, listOf(4)), channel.message.value)
        channel.acknowledge()
        assertNull(channel.message.value)
    }

    @Test
    fun `the same message in a row comes once, null shows nothing`() {
        val channel = MessageChannel()
        channel.show(null as String?)
        assertNull(channel.text)
        repeat(3) { channel.show("Netzfehler") }
        channel.show("gespeichert")
        channel.show("gespeichert")
        assertEquals("Netzfehler", channel.text)
        channel.acknowledge()
        assertEquals("gespeichert", channel.text)
        channel.acknowledge()
        assertNull(channel.text)
    }

    @Test
    fun `at most five wait, the oldest stay`() {
        val channel = MessageChannel()
        (1..10).forEach { channel.show("m$it") }
        val seen = mutableListOf<String>()
        while (true) {
            seen += channel.text ?: break
            channel.acknowledge()
        }
        assertEquals((1..6).map { "m$it" }, seen)
    }

    @Test
    fun `concurrent writers lose nothing`() {
        val channel = MessageChannel()
        val pool = Executors.newFixedThreadPool(4)
        val go = CountDownLatch(1)
        val done = CountDownLatch(4)
        repeat(4) { i -> pool.execute { go.await(); channel.show("t$i"); done.countDown() } }
        go.countDown()
        done.await()
        pool.shutdown()
        val seen = mutableSetOf<String>()
        while (true) {
            seen += channel.text ?: break
            channel.acknowledge()
        }
        assertEquals(setOf("t0", "t1", "t2", "t3"), seen)
    }
}
