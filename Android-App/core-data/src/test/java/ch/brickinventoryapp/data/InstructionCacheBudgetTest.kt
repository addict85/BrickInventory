package ch.brickinventoryapp.data

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.util.InstructionStore
import ch.brickinventoryapp.dataapi.instructions.INSTRUCTION_EXTENSION
import ch.brickinventoryapp.dataapi.instructions.INSTRUCTION_PREFIX
import ch.brickinventoryapp.security.StoreCipher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File
import java.io.RandomAccessFile

/**
 * Before an instruction is loaded, the PDF view cache is trimmed to its budget, the oldest first:
 * viewed instructions stay for reopening and resuming, but at up to 300 MB each they need a limit.
 * That the download goes through the api client is checked by InstructionDownloadTest.
 *
 * Counter-check (run here): the `prunePdfCache(…)` call removed from load → red “before loading, the cache …”.
 */
@RunWith(RobolectricTestRunner::class)
class InstructionCacheBudgetTest {

    private val ctx: Context = ApplicationProvider.getApplicationContext()
    private val client = OkHttpClient.Builder().addInterceptor { chain ->
        Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("OK")
            .body("%PDF-1.4 instruction".toResponseBody("application/pdf".toMediaType())).build()
    }.build()
    private val download = InstructionDownload(ctx, client, InstructionStore(StoreCipher { ByteArray(32) { 4 } }), Dispatchers.Unconfined)

    private fun cached(name: String, megabytes: Long, age: Long) = File(ctx.cacheDir, "$INSTRUCTION_PREFIX$name$INSTRUCTION_EXTENSION").apply {
        // Sparse: the length counts for the budget, the disk stays empty.
        RandomAccessFile(this, "rw").use { it.setLength(megabytes * 1024 * 1024) }
        setLastModified(System.currentTimeMillis() - age)
    }

    private fun load(): File {
        val target = File(ctx.cacheDir, "${INSTRUCTION_PREFIX}10294$INSTRUCTION_EXTENSION")
        runBlocking { download.load("https://nas.example/api/v2/instructions/10294-1.pdf", target, once = false) { _, _ -> } }
        return target
    }

    @Test
    fun `before loading, the cache is trimmed to its budget, the oldest first`() {
        val newer = cached("75192", 300, age = 1_000)
        val older = cached("10179", 300, age = 2_000)
        load()
        assertTrue("the newer instruction was deleted", newer.isFile)
        assertFalse("the cache grows past its budget", older.exists())
    }
}
