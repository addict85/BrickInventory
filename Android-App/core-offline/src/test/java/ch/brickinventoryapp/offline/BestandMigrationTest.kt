package ch.brickinventoryapp.offline

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.offline.room.BestandDatenbank
import ch.brickinventoryapp.offline.room.RoomAusgang
import ch.brickinventoryapp.offline.room.RoomBestand
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
import java.util.UUID

/**
 * Das eingecheckte Room-Schema (core-offline/schemas) passt zur Datenbank, und jede
 * frühere Fassung wird mit den Migrationen zur neuesten, ohne dass der Ausgang
 * etwas verliert. Eine ältere Datenbank wird dabei aus ihrem eingecheckten
 * Schema gebaut — wie MigrationTestHelper, ohne room-testing als weitere
 * Abhängigkeit. Läuft nur in der CI (Room braucht Android).
 *
 * Gegenproben misst der CI-Job `gegenproben` (Android-App/gegenproben/, er
 * verlangt Rot): bestand-migration-entfernt, -spalte-falsch, -ohne-schluessel,
 * -ohne-filterspalten (2 → 3 füllt die Filterspalten nicht). Wie 2 → 3 Fassung-2-JSON
 * liest, prüft SpaltenFassung2Test ohne Android.
 * Eine Änderung am Schema der neuesten Fassung taugt nicht als Gegenprobe: Room
 * schreibt es beim Übersetzen neu.
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
    fun `jede frühere Fassung wird ohne Verlust zur neuesten, jeder Posten hat einen eigenen Schlüssel, jede Zeile ihre Filter`() {
        val frueher = fassungen().dropLast(1)
        assertTrue("Mindestens Fassung 1 muss eingecheckt sein", 1 in frueher)
        for (v in frueher) {
            val name = "migration-$v.db"
            context.deleteDatabase(name)
            SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath(name).apply { parentFile?.mkdirs() }, null).use { alt ->
                nachSchema(alt, v)
                // Ab Fassung 2 trägt jeder Posten seinen Schlüssel schon (Migration 1→2 oder beim Schreiben).
                for (n in 1..2) {
                    val b = AblageJson.encodeToString(Bearbeitung.serializer(), Bearbeitung.SetMenge("1000$n-1", n))
                    if (v >= 2) alt.execSQL(
                        "INSERT INTO ausgang (bereich, bearbeitung, erstellt, versuche, schluessel) VALUES ('a', ?, $n, 0, ?)",
                        arrayOf(b, UUID.randomUUID().toString()))
                    else alt.execSQL("INSERT INTO ausgang (bereich, bearbeitung, erstellt, versuche) VALUES ('a', ?, $n, 0)", arrayOf(b))
                }
                // Feste Probe der Fassung 2 statt SetItem: Die Migration darf nicht am heutigen Modell hängen.
                val set = """{"set_number":"10002-1","name":"Polizeiwache","theme":"City","storage":"Kiste 2","conditions":[]}"""
                alt.execSQL("INSERT INTO bestand (bereich, art, schluessel, position, inhalt) VALUES ('a', 'SETS', '10002-1', 0, ?)",
                    arrayOf(set))
                alt.execSQL("INSERT INTO bestand (bereich, art, schluessel, position, inhalt) VALUES ('a', 'SETS', 'kaputt', 1, '{}')")
            }
            val room = Room.databaseBuilder(context, BestandDatenbank::class.java, name)
                .addMigrations(*BestandDatenbank.MIGRATIONEN).allowMainThreadQueries().build()
            try {
                val posten = runBlocking { RoomAusgang(room).alle("a") }
                assertEquals("Fassung $v: der Ausgang ist vollständig und in Reihenfolge",
                    listOf(Bearbeitung.SetMenge("10001-1", 1), Bearbeitung.SetMenge("10002-1", 2)), posten.map { it.bearbeitung })
                assertTrue("Fassung $v: jeder Posten hat einen Schlüssel", posten.all { it.schluessel.length == 36 })
                assertEquals("Fassung $v: jeder Posten hat einen eigenen Schlüssel", 2, posten.map { it.schluessel }.toSet().size)
                val bestand = RoomBestand(room)
                assertEquals("Fassung $v: die lesbare Liste bleibt, die unlesbare Zeile geht",
                    listOf("10002-1"), runBlocking { bestand.lies("a", Bestandsart.SETS) }.liste.map { it.schluessel })
                for (f in listOf(Filterspalten(thema = "City"), Filterspalten(lagerort = "Kiste 2"), Filterspalten(suchtext = "POLIZEI")))
                    assertEquals("Fassung $v: die Filterspalten sind aus dem JSON gefüllt ($f)", listOf("10002-1"),
                        runBlocking { bestand.filtere("a", Bestandsart.SETS, f) }.liste.map { it.schluessel })
            } finally {
                room.close()
                context.deleteDatabase(name)
            }
        }
    }
}
