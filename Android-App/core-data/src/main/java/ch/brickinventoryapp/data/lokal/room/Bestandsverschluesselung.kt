package ch.brickinventoryapp.data.lokal.room

import android.content.Context
import androidx.sqlite.db.SupportSQLiteDatabase
import androidx.sqlite.db.SupportSQLiteOpenHelper
import ch.brickinventoryapp.util.Ablageschluessel
import net.zetetic.database.sqlcipher.SQLiteDatabase
import net.zetetic.database.sqlcipher.SupportOpenHelperFactory
import java.io.File
import java.io.IOException

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
    override fun create(configuration: SupportSQLiteOpenHelper.Configuration): SupportSQLiteOpenHelper =
        SpaeterGeoeffnet(configuration.name) {
            System.loadLibrary("sqlcipher")
            val passwort = sqlcipherPasswort(ablage.fuer(ZWECK))
            bereite(context.getDatabasePath(configuration.name ?: BestandDatenbank.NAME), passwort, ablage.neuAngelegt)
            SupportOpenHelperFactory(passwort).create(configuration)
        }

    private companion object {
        const val ZWECK = "bestand.db"
    }
}

/** Reicht an den eigentlichen Helfer weiter, den es erst beim ersten Zugriff gibt. */
private class SpaeterGeoeffnet(
    override val databaseName: String?,
    erzeuge: () -> SupportSQLiteOpenHelper,
) : SupportSQLiteOpenHelper {
    @Volatile private var wal: Boolean? = null
    private val innen by lazy { erzeuge().also { h -> wal?.let(h::setWriteAheadLoggingEnabled) } }

    override fun setWriteAheadLoggingEnabled(enabled: Boolean) {
        wal = enabled
    }

    override val writableDatabase: SupportSQLiteDatabase get() = innen.writableDatabase
    override val readableDatabase: SupportSQLiteDatabase get() = innen.readableDatabase
    override fun close() = innen.close()
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
