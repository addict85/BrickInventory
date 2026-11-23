package ch.brickinventoryapp.data

import ch.brickinventoryapp.security.TrustCipher
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.IOException

/**
 * A sign-out job lies in WorkManager's database only as one ciphertext under
 * the details' key: address, pin and origin are not readable in it. With a
 * locked device it waits instead of giving up.
 *
 * Counter-checks (kotlinc and JUnit locally):
 *   A  put() returns the text unencrypted → red “the job lies in the queue only
 *      encrypted …”; counter-checks/job-in-plaintext.patch
 *   B  read() turns Gesperrt into Unlesbar → red “locked the job waits …”;
 *      counter-checks/job-locked-abandoned.patch
 */
class JobStoreTest {

    private var locked = false
    private val cipher = TrustCipher(info = {
        if (locked) throw IOException("Keystore gerade nicht bereit")
        ByteArray(32) { 5 }
    }) { ByteArray(32) { 6 } }
    private val store = JobStore(cipher::encryptDetail, cipher::openDetail)

    private val job = RedemptionJob(
        "https://brick.example.org:8443/inventar", "e1:R0VIRUlNVEVYVA==", "sha256/AAAABBBBCCCC=", "https://brick.example.org:8443",
    )

    @Test
    fun `the job lies in the queue only encrypted and comes back whole`() {
        val secret = store.put(job)!!
        for (part in listOf("brick", "example", "8443", "inventar", "R0VIRUlNVEVYVA", "AAAABBBBCCCC"))
            assertFalse("„$part“ stands readable in the job: $secret", part in secret)
        assertEquals(JobState.Da(job), store.read(secret))

        val without = RedemptionJob("https://nas.local", "e1:WA==", pin = null)
        assertEquals("Without a pin, origin like the server", JobState.Da(without), store.read(store.put(without)!!))
    }

    @Test
    fun `locked the job waits, a foreign or broken one yields nothing`() {
        val secret = store.put(job)!!
        locked = true
        assertEquals(JobState.LockedState, store.read(secret))
        assertNull("Locked, nothing is put into the queue", store.put(job))
        locked = false
        assertEquals(JobState.Unreadable, store.read("kein-base64-%%%"))
        assertEquals("Under another name it does not count", JobState.Unreadable,
            store.read(cipher.encryptDetail("1\nhttps://x\nt\n\n", "server_url")!!))
        assertEquals("An unknown form does not count", JobState.Unreadable,
            store.read(cipher.encryptDetail("2\nhttps://x\nt\n\n", "entwertungsauftrag")!!))
    }
}
