package ch.brickinventoryapp.offline.room

import android.content.Context
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import ch.brickinventoryapp.security.Ablageschluessel
import net.zetetic.database.sqlcipher.SQLiteDatabase
import net.zetetic.database.sqlcipher.SupportOpenHelperFactory
import java.io.File
import java.io.IOException
import java.util.concurrent.atomic.AtomicReference

/**
 * The stock database (inventory, purchase prices, outbox) lies encrypted with SQLCipher;
 * its key is derived from the [Ablageschluessel]. Preparation happens
 * only on first opening, on Room's thread: keystore and the one-time takeover
 * of a plaintext legacy stock do not belong on the main thread.
 */
internal class EncryptedInventoryFactory(
    private val context: Context,
    private val ablage: Ablageschluessel,
) : SupportSQLiteOpenHelper.Factory {
    override fun create(configuration: SupportSQLiteOpenHelper.Configuration): SupportSQLiteOpenHelper {
        val datei = context.getDatabasePath(configuration.name ?: InventoryDatabase.NAME)
        val helper = LaterOpened(configuration.name, { ablage.stand }) {
            System.loadLibrary("sqlcipher")
            val passwort = sqlcipherPassword(ablage.fuer(PURPOSE))
            prepare(datei, passwort, ablage.newCreated)
            SupportOpenHelperFactory(passwort).create(configuration)
        }
        // On sign-out (Ablageschluessel.erneuere): nothing stays behind with the old key.
        ablage.beforeRenewal {
            helper.schliesse()
            deleteDatabase(datei)
        }
        return helper
    }

    private companion object {
        const val PURPOSE = "bestand.db"
    }
}

/**
 * Passes on to the actual helper, which exists only at first access. After
 * a new store key ([stand]) it is rebuilt, empty and with the new one.
 */
private class LaterOpened(
    override val databaseName: String?,
    private val stand: () -> Long,
    private val erzeuge: () -> SupportSQLiteOpenHelper,
) : SupportSQLiteOpenHelper {
    @Volatile private var wal: Boolean? = null
    private val innen = AtomicReference<Pair<Long, SupportSQLiteOpenHelper>?>(null)

    private fun helper(): SupportSQLiteOpenHelper {
        innen.get()?.takeIf { it.first == stand() }?.let { return it.second }
        synchronized(this) {
            innen.get()?.takeIf { it.first == stand() }?.let { return it.second }
            val vorher = stand()
            val neu = erzeuge().also { h -> wal?.let(h::setWriteAheadLoggingEnabled) }
            innen.getAndSet(vorher to neu)?.second?.close()
            return neu
        }
    }

    /** Without its own lock: the call comes under the store key's lock. */
    fun schliesse() {
        innen.getAndSet(null)?.second?.close()
    }

    override fun setWriteAheadLoggingEnabled(enabled: Boolean) {
        wal = enabled
    }

    override val writableDatabase: SupportSQLiteDatabase get() = helper().writableDatabase
    override val readableDatabase: SupportSQLiteDatabase get() = helper().readableDatabase
    override fun close() = schliesse()
}

/** SQLCipher takes x'…' as a ready key, without the slow derivation from a password. */
internal fun sqlcipherPassword(schluessel: ByteArray): ByteArray =
    ("x'" + schluessel.joinToString("") { "%02x".format(it) } + "'").toByteArray(Charsets.US_ASCII)

/** Is there an unencrypted SQLite file here? Encrypted, it starts with randomness. */
internal fun isPlaintextDatabase(datei: File): Boolean {
    if (!datei.isFile || datei.length() < HEADER.size) return false
    val anfang = ByteArray(HEADER.size)
    datei.inputStream().use { if (it.read(anfang) != HEADER.size) return false }
    return anfang.contentEquals(HEADER)
}

private val HEADER = "SQLite format 3\u0000".toByteArray(Charsets.US_ASCII)

/**
 * Take over a plaintext legacy stock once (sqlcipher_export). Encrypted with a
 * lost key it can no longer be read: then the store starts empty, the
 * server has the stock; only changes not yet sent are lost.
 */
private fun prepare(datei: File, passwort: ByteArray, keyNew: Boolean) {
    when {
        !datei.isFile -> Unit
        isPlaintextDatabase(datei) -> encryptPlaintext(datei, passwort)
        keyNew -> deleteDatabase(datei)
    }
}

private fun encryptPlaintext(datei: File, passwort: ByteArray) {
    val ziel = File(datei.parentFile, datei.name + ".neu")
    deleteDatabase(ziel)
    val alt = SQLiteDatabase.openDatabase(datei.path, "", null, SQLiteDatabase.OPEN_READWRITE, null, null)
    try {
        val fassung = alt.version
        // Path from getDatabasePath, key only hex digits: nothing that would break the SQL.
        alt.rawExecSQL("ATTACH DATABASE '${ziel.path.replace("'", "''")}' AS neu KEY \"${String(passwort, Charsets.US_ASCII)}\"")
        alt.rawExecSQL("SELECT sqlcipher_export('neu')")
        alt.rawExecSQL("PRAGMA neu.user_version = $fassung")
        alt.rawExecSQL("DETACH DATABASE neu")
    } finally {
        alt.close()
    }
    deleteDatabase(datei)
    if (!ziel.renameTo(datei)) throw IOException("Verschlüsselte Datenbank nicht an ihren Platz gelegt")
}

private fun deleteDatabase(datei: File) {
    for (extension in listOf("", "-wal", "-shm", "-journal")) File(datei.path + extension).delete()
}
