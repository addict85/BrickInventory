package ch.brickinventoryapp.data.lokal.room

import android.content.Context
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import ch.brickinventoryapp.data.util.Ablageschluessel
import net.zetetic.database.sqlcipher.SQLiteDatabase
import net.zetetic.database.sqlcipher.SupportOpenHelperFactory
import java.io.File
import java.io.IOException
import java.util.concurrent.atomic.AtomicReference

/**
 * Die Datenbank des Bestands (Inventar, Kaufpreise, Ausgang) liegt mit SQLCipher
 * verschlüsselt; ihr Schlüssel ist aus dem [Ablageschluessel] abgeleitet. Vorbereitet
 * wird erst beim ersten Öffnen, auf Rooms Faden: Keystore und die einmalige Übernahme
 * eines Klartext-Altbestands gehören nicht auf den Hauptfaden.
 */
internal class VerschluesselteBestandsfabrik(
    private val context: Context,
    private val ablage: Ablageschluessel,
) : SupportSQLiteOpenHelper.Factory {
    override fun create(configuration: SupportSQLiteOpenHelper.Configuration): SupportSQLiteOpenHelper {
        val datei = context.getDatabasePath(configuration.name ?: BestandDatenbank.NAME)
        val helfer = SpaeterGeoeffnet(configuration.name, { ablage.stand }) {
            System.loadLibrary("sqlcipher")
            val passwort = sqlcipherPasswort(ablage.fuer(ZWECK))
            bereite(datei, passwort, ablage.neuAngelegt)
            SupportOpenHelperFactory(passwort).create(configuration)
        }
        // Beim Abmelden (Ablageschluessel.erneuere): Mit dem alten Schlüssel bleibt nichts liegen.
        ablage.vorErneuerung {
            helfer.schliesse()
            loescheDatenbank(datei)
        }
        return helfer
    }

    private companion object {
        const val ZWECK = "bestand.db"
    }
}

/**
 * Reicht an den eigentlichen Helfer weiter, den es erst beim ersten Zugriff gibt. Nach
 * einem neuen Ablageschlüssel ([stand]) wird er neu gebaut, leer und mit dem neuen.
 */
private class SpaeterGeoeffnet(
    override val databaseName: String?,
    private val stand: () -> Long,
    private val erzeuge: () -> SupportSQLiteOpenHelper,
) : SupportSQLiteOpenHelper {
    @Volatile private var wal: Boolean? = null
    private val innen = AtomicReference<Pair<Long, SupportSQLiteOpenHelper>?>(null)

    private fun helfer(): SupportSQLiteOpenHelper {
        innen.get()?.takeIf { it.first == stand() }?.let { return it.second }
        synchronized(this) {
            innen.get()?.takeIf { it.first == stand() }?.let { return it.second }
            val vorher = stand()
            val neu = erzeuge().also { h -> wal?.let(h::setWriteAheadLoggingEnabled) }
            innen.getAndSet(vorher to neu)?.second?.close()
            return neu
        }
    }

    /** Ohne eigene Sperre: Der Aufruf kommt unter der Sperre des Ablageschlüssels. */
    fun schliesse() {
        innen.getAndSet(null)?.second?.close()
    }

    override fun setWriteAheadLoggingEnabled(enabled: Boolean) {
        wal = enabled
    }

    override val writableDatabase: SupportSQLiteDatabase get() = helfer().writableDatabase
    override val readableDatabase: SupportSQLiteDatabase get() = helfer().readableDatabase
    override fun close() = schliesse()
}

/** SQLCipher nimmt x'…' als fertigen Schlüssel, ohne die langsame Ableitung aus einem Passwort. */
internal fun sqlcipherPasswort(schluessel: ByteArray): ByteArray =
    ("x'" + schluessel.joinToString("") { "%02x".format(it) } + "'").toByteArray(Charsets.US_ASCII)

/** Liegt hier eine unverschlüsselte SQLite-Datei? Verschlüsselt beginnt sie mit Zufall. */
internal fun istKlartextDatenbank(datei: File): Boolean {
    if (!datei.isFile || datei.length() < KOPF.size) return false
    val anfang = ByteArray(KOPF.size)
    datei.inputStream().use { if (it.read(anfang) != KOPF.size) return false }
    return anfang.contentEquals(KOPF)
}

private val KOPF = "SQLite format 3\u0000".toByteArray(Charsets.US_ASCII)

/**
 * Altbestand im Klartext einmal übernehmen (sqlcipher_export). Verschlüsselt mit einem
 * verlorenen Schlüssel ist er nicht mehr zu lesen: Dann beginnt die Ablage leer, der
 * Server hat den Bestand; nur noch nicht gesendete Änderungen gehen verloren.
 */
private fun bereite(datei: File, passwort: ByteArray, schluesselNeu: Boolean) {
    when {
        !datei.isFile -> Unit
        istKlartextDatenbank(datei) -> verschluesseleKlartext(datei, passwort)
        schluesselNeu -> loescheDatenbank(datei)
    }
}

private fun verschluesseleKlartext(datei: File, passwort: ByteArray) {
    val ziel = File(datei.parentFile, datei.name + ".neu")
    loescheDatenbank(ziel)
    val alt = SQLiteDatabase.openDatabase(datei.path, "", null, SQLiteDatabase.OPEN_READWRITE, null, null)
    try {
        val fassung = alt.version
        // Pfad aus getDatabasePath, Schlüssel nur Hexziffern: nichts, was das SQL bräche.
        alt.rawExecSQL("ATTACH DATABASE '${ziel.path.replace("'", "''")}' AS neu KEY \"${String(passwort, Charsets.US_ASCII)}\"")
        alt.rawExecSQL("SELECT sqlcipher_export('neu')")
        alt.rawExecSQL("PRAGMA neu.user_version = $fassung")
        alt.rawExecSQL("DETACH DATABASE neu")
    } finally {
        alt.close()
    }
    loescheDatenbank(datei)
    if (!ziel.renameTo(datei)) throw IOException("Verschlüsselte Datenbank nicht an ihren Platz gelegt")
}

private fun loescheDatenbank(datei: File) {
    for (endung in listOf("", "-wal", "-shm", "-journal")) File(datei.path + endung).delete()
}
