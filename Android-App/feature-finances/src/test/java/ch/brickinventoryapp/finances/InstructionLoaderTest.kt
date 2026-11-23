package ch.brickinventoryapp.finances

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.InstructionRepository
import ch.brickinventoryapp.data.util.InstructionStore
import ch.brickinventoryapp.finances.ui.pdf.InstructionLoader
import ch.brickinventoryapp.finances.ui.pdf.PdfHolder
import ch.brickinventoryapp.finances.ui.pdf.PdfRenderConnection
import ch.brickinventoryapp.finances.ui.viewmodel.voucherPdfAddress
import ch.brickinventoryapp.security.StoreCipher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/**
 * The viewer's loader takes a voucher PDF only into memory and gives it no file, while an
 * instruction is downloaded into the cache. The network is a recorder that stops after the
 * call; what follows (memfd, renderer) needs a device.
 *
 * Counter-checks (local, Robolectric):
 *   `pdfStore(…, confidential)` → `pdfStore(…, false)` in the loader → red “a voucher PDF …” (a file)
 *   the memory branch downloads into a cache file instead           → red “a voucher PDF …” (download to disk)
 */
@RunWith(RobolectricTestRunner::class)
class InstructionLoaderTest {

    private val ctx: Context = ApplicationProvider.getApplicationContext()

    private class Stop : RuntimeException("stopped after the network")

    private class Recorder : InstructionRepository {
        val calls = mutableListOf<String>()
        val targets = mutableListOf<File>()
        override suspend fun load(url: String, target: File, once: Boolean, progress: (Long, Long) -> Unit) {
            calls += "file"; targets += target
            throw Stop()
        }
        override suspend fun loadInTheStorage(url: String, progress: (Long, Long) -> Unit): ByteArray {
            calls += "memory"
            throw Stop()
        }
    }

    private fun load(address: String): Recorder {
        val network = Recorder()
        val loader = InstructionLoader(ctx, network, InstructionStore(StoreCipher { ByteArray(32) { 3 } }), Dispatchers.Unconfined,
            PdfRenderConnection(ctx))
        runCatching { runBlocking { loader.load(address, PdfHolder()) {} } }
            .onSuccess { error("the recorder stops every load") }
            .onFailure { assertTrue("unexpected: $it", it is Stop) }
        return network
    }

    private fun files() = ctx.cacheDir.walkTopDown().filter { it.isFile }.toList()

    @Test
    fun `a voucher PDF goes only into memory and gets no file`() {
        val before = files()
        val network = load(voucherPdfAddress("https://brick.example", 7))
        assertEquals(listOf("memory"), network.calls)
        assertEquals(before, files())
    }

    @Test
    fun `an instruction is downloaded into the cache`() {
        val network = load("https://brick.example/api/v2/instructions/42/file")
        assertEquals(listOf("file"), network.calls)
        assertEquals(ctx.cacheDir, network.targets.single().parentFile)
    }
}
