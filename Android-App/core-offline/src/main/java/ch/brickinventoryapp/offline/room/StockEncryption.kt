package ch.brickinventoryapp.offline.room

import android.content.Context
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import ch.brickinventoryapp.security.StoreKey
import net.zetetic.database.sqlcipher.SQLiteDatabase
import net.zetetic.database.sqlcipher.SupportOpenHelperFactory
import java.io.File
import java.io.IOException
import java.util.concurrent.atomic.AtomicReference

/**
 * The stock database (inventory, purchase prices, outbox) lies encrypted with SQLCipher;
 * its key is derived from the [StoreKey]. Preparation happens
 * only on first opening, on Room's thread: keystore and the one-time takeover
 * of a plaintext legacy stock do not belong on the main thread.
 */
internal class EncryptedInventoryFactory(
    private val context: Context,
    private val store: StoreKey,
) : SupportSQLiteOpenHelper.Factory {
    override fun create(configuration: SupportSQLiteOpenHelper.Configuration): SupportSQLiteOpenHelper {
        val file = context.getDatabasePath(configuration.name ?: InventoryDatabase.NAME)
        val helper = LaterOpened(configuration.name, { store.state }) {
            System.loadLibrary("sqlcipher")
            val password = sqlcipherPassword(store.forTarget(PURPOSE))
            prepare(file, password, store.newCreated)
            SupportOpenHelperFactory(password).create(configuration)
        }
        // On sign-out (Ablageschluessel.erneuere): nothing stays behind with the old key.
        store.beforeRenewal {
            helper.shutDown()
            deleteDatabase(file)
        }
        return helper
    }

    private companion object {
        const val PURPOSE = "bestand.db"
    }
}

/**
 * Passes on to the actual helper, which exists only at first access. After
 * a new store key ([state]) it is rebuilt, empty and with the new one.
 */
private class LaterOpened(
    override val databaseName: String?,
    private val state: () -> Long,
    private val generate: () -> SupportSQLiteOpenHelper,
) : SupportSQLiteOpenHelper {
    @Volatile private var wal: Boolean? = null
    private val inner = AtomicReference<Pair<Long, SupportSQLiteOpenHelper>?>(null)

    private fun helper(): SupportSQLiteOpenHelper {
        inner.get()?.takeIf { it.first == state() }?.let { return it.second }
        synchronized(this) {
            inner.get()?.takeIf { it.first == state() }?.let { return it.second }
            val before = state()
            val newValue = generate().also { h -> wal?.let(h::setWriteAheadLoggingEnabled) }
            inner.getAndSet(before to newValue)?.second?.close()
            return newValue
        }
    }

    /** Without its own lock: the call comes under the store key's lock. */
    fun shutDown() {
        inner.getAndSet(null)?.second?.close()
    }

    override fun setWriteAheadLoggingEnabled(enabled: Boolean) {
        wal = enabled
    }

    override val writableDatabase: SupportSQLiteDatabase get() = helper().writableDatabase
    override val readableDatabase: SupportSQLiteDatabase get() = helper().readableDatabase
    override fun close() = shutDown()
}

/** SQLCipher takes x'…' as a ready key, without the slow derivation from a password. */
internal fun sqlcipherPassword(key: ByteArray): ByteArray =
    ("x'" + key.joinToString("") { "%02x".format(it) } + "'").toByteArray(Charsets.US_ASCII)

/** Is there an unencrypted SQLite file here? Encrypted, it starts with randomness. */
internal fun isPlaintextDatabase(file: File): Boolean {
    if (!file.isFile || file.length() < HEADER.size) return false
    val begin = ByteArray(HEADER.size)
    file.inputStream().use { if (it.read(begin) != HEADER.size) return false }
    return begin.contentEquals(HEADER)
}

private val HEADER = "SQLite format 3\u0000".toByteArray(Charsets.US_ASCII)

/**
 * Take over a plaintext legacy stock once (sqlcipher_export). Encrypted with a
 * lost key it can no longer be read: then the store starts empty, the
 * server has the stock; only changes not yet sent are lost.
 */
private fun prepare(file: File, password: ByteArray, keyNew: Boolean) {
    when {
        !file.isFile -> Unit
        isPlaintextDatabase(file) -> encryptPlaintext(file, password)
        keyNew -> deleteDatabase(file)
    }
}

private fun encryptPlaintext(file: File, password: ByteArray) {
    val target = File(file.parentFile, file.name + ".neu")
    deleteDatabase(target)
    val old = SQLiteDatabase.openDatabase(file.path, "", null, SQLiteDatabase.OPEN_READWRITE, null, null)
    try {
        val version = old.version
        // Path from getDatabasePath, key only hex digits: nothing that would break the SQL.
        old.rawExecSQL("ATTACH DATABASE '${target.path.replace("'", "''")}' AS neu KEY \"${String(password, Charsets.US_ASCII)}\"")
        old.rawExecSQL("SELECT sqlcipher_export('neu')")
        old.rawExecSQL("PRAGMA neu.user_version = $version")
        old.rawExecSQL("DETACH DATABASE neu")
    } finally {
        old.close()
    }
    deleteDatabase(file)
    if (!target.renameTo(file)) throw IOException("Verschlüsselte Datenbank nicht an ihren Platz gelegt")
}

private fun deleteDatabase(file: File) {
    for (extension in listOf("", "-wal", "-shm", "-journal")) File(file.path + extension).delete()
}
