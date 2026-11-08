package ch.brickinventoryapp.data

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.data.api.ApiJson
import ch.brickinventoryapp.data.lokal.Bearbeitung
import ch.brickinventoryapp.data.lokal.Bestandsart
import ch.brickinventoryapp.data.lokal.room.BestandDatenbank
import ch.brickinventoryapp.data.lokal.room.RoomAusgang
import ch.brickinventoryapp.data.lokal.room.RoomBestand
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.io.File

/**
 * Das eingecheckte Room-Schema (core-data/schemas) passt zur Datenbank, und jede
 * frühere Fassung wird mit den Migrationen zur neuesten, ohne dass der Ausgang
 * etwas verliert. Eine ältere Datenbank wird dabei aus ihrem eingecheckten
 * Schema gebaut — wie MigrationTestHelper, ohne room-testing als weitere
 * Abhängigkeit. Läuft nur in der CI (Room braucht Android).
 *
 * Gegenproben misst der CI-Job `gegenproben` (Android-App/gegenproben/, er
 * verlangt Rot): bestand-migration-entfernt, -spalte-falsch, -ohne-schluessel.
 * Eine Änderung an 2.json taugt nicht als Gegenprobe: Room schreibt das Schema
 * beim Übersetzen neu.
 */
@RunWith(RobolectricTestRunner::class)
class BestandMigrationTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val ordner = File("schemas/${BestandDatenbank::class.java.name}")

    private fun schema(version: Int): JsonObject =
        Json.parseToJsonElement(File(ordner, "$version.json").readText()).jsonObject["database"]!!.jsonObject

    private fun fassungen(): List<Int> =
        ordner.listFiles().orEmpty().mapNotNull { it.name.removeSuffix(".json").toIntOrNull() }.sorted()

    /** Spalten und Indizes einer Tabelle, so wie SQLite sie meldet. */
    private fun aufbau(abfrage: (String) -> Cursor, tabelle: String): List<String> {
        fun zeilen(sql: String, f: (Cursor) -> String) = abfrage(sql).use { c ->
            buildList { while (c.moveToNext()) add(f(c)) }
        }
        val spalten = zeilen("PRAGMA table_info(`$tabelle`)") { c ->
            (1..5).joinToString("|") { c.getString(it) ?: "null" }
        }
        val indizes = zeilen("PRAGMA index_list(`$tabelle`)") { c -> c.getString(1) + "|" + c.getString(2) }
            .map { i -> i + zeilen("PRAGMA index_info(`${i.substringBefore('|')}`)") { c -> c.getString(2) } }
        return spalten + indizes.sorted()
    }

    /** Eine leere Datenbank genau nach dem eingecheckten Schema der Fassung [version]. */
    private fun nachSchema(db: SQLiteDatabase, version: Int) {
        val s = schema(version)
        for (e in s["entities"]!!.jsonArray.map { it.jsonObject }) {
            val t = e["tableName"]!!.jsonPrimitive.content
            db.execSQL(e["createSql"]!!.jsonPrimitive.content.replace("\${TABLE_NAME}", t))
            for (i in e["indices"]?.jsonArray.orEmpty())
                db.execSQL(i.jsonObject["createSql"]!!.jsonPrimitive.content.replace("\${TABLE_NAME}", t))
        }
        for (q in s["setupQueries"]!!.jsonArray) db.execSQL(q.jsonPrimitive.content)
        db.version = version
    }

    @Test
    fun `das eingecheckte Schema der neuesten Fassung ist das der Datenbank`() {
        val room = Room.inMemoryDatabaseBuilder(context, BestandDatenbank::class.java).allowMainThreadQueries().build()
        try {
            val echt = room.openHelper.writableDatabase
            val neueste = fassungen().last()
            assertEquals("Für die Fassung der Datenbank fehlt das eingecheckte Schema", echt.version, neueste)
            val soll = SQLiteDatabase.create(null)
            nachSchema(soll, neueste)
            val tabellen = schema(neueste)["entities"]!!.jsonArray.map { it.jsonObject["tableName"]!!.jsonPrimitive.content }
            assertTrue(tabellen.containsAll(listOf("bestand", "bestand_stand", "ausgang")))
            for (t in tabellen) {
                assertEquals("das eingecheckte Schema weicht bei `$t` von der Datenbank ab",
                    aufbau({ soll.rawQuery(it, null) }, t), aufbau({ echt.query(it) }, t))
            }
            assertEquals(neueste, schema(neueste)["version"]!!.jsonPrimitive.int)
            soll.close()
        } finally {
            room.close()
        }
    }

    @Test
    fun `jede frühere Fassung wird ohne Verlust zur neuesten, jeder Posten hat einen eigenen Schlüssel`() {
        val frueher = fassungen().dropLast(1)
        assertTrue("Mindestens Fassung 1 muss eingecheckt sein", 1 in frueher)
        for (v in frueher) {
            val name = "migration-$v.db"
            context.deleteDatabase(name)
            SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath(name).apply { parentFile?.mkdirs() }, null).use { alt ->
                nachSchema(alt, v)
                for (n in 1..2) alt.execSQL(
                    "INSERT INTO ausgang (bereich, bearbeitung, erstellt, versuche) VALUES ('a', ?, $n, 0)",
                    arrayOf(ApiJson.encodeToString(Bearbeitung.serializer(), Bearbeitung.SetMenge("1000$n-1", n))))
                alt.execSQL("INSERT INTO bestand (bereich, art, schluessel, position, inhalt) VALUES ('a', 'SETS', '1', 0, '{}')")
            }
            val room = Room.databaseBuilder(context, BestandDatenbank::class.java, name)
                .addMigrations(*BestandDatenbank.MIGRATIONEN).allowMainThreadQueries().build()
            try {
                val posten = runBlocking { RoomAusgang(room).alle("a") }
                assertEquals("Fassung $v: der Ausgang ist vollständig und in Reihenfolge",
                    listOf(Bearbeitung.SetMenge("10001-1", 1), Bearbeitung.SetMenge("10002-1", 2)), posten.map { it.bearbeitung })
                assertTrue("Fassung $v: jeder Posten hat einen Schlüssel", posten.all { it.schluessel.length == 36 })
                assertEquals("Fassung $v: jeder Posten hat einen eigenen Schlüssel", 2, posten.map { it.schluessel }.toSet().size)
                assertEquals(listOf("1"), runBlocking { RoomBestand(room).lies("a", Bestandsart.SETS) }.zeilen.map { it.schluessel })
            } finally {
                room.close()
                context.deleteDatabase(name)
            }
        }
    }
}
