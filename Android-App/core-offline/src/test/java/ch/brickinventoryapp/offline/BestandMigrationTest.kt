package ch.brickinventoryapp.offline

import ch.brickinventoryapp.model.local.StockKind
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.offline.room.InventoryDatabase
import ch.brickinventoryapp.offline.room.RoomExit
import ch.brickinventoryapp.offline.room.RoomInventory
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
 * liest, prüft ColumnsFassung2Test ohne Android.
 * Eine Änderung am Schema der neuesten Fassung taugt nicht als Gegenprobe: Room
 * schreibt es beim Übersetzen neu.
 */
@RunWith(RobolectricTestRunner::class)
class BestandMigrationTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val folder = File("schemas/${InventoryDatabase::class.java.name}")

    private fun schema(version: Int): JsonObject =
        Json.parseToJsonElement(File(folder, "$version.json").readText()).jsonObject["database"]!!.jsonObject

    private fun versions(): List<Int> =
        folder.listFiles().orEmpty().mapNotNull { it.name.removeSuffix(".json").toIntOrNull() }.sorted()

    /** Spalten und Indizes einer Tabelle, so wie SQLite sie meldet. */
    private fun setup(abfrage: (String) -> Cursor, table: String): List<String> {
        fun zeilen(sql: String, f: (Cursor) -> String) = abfrage(sql).use { c ->
            buildList { while (c.moveToNext()) add(f(c)) }
        }
        val spalten = zeilen("PRAGMA table_info(`$table`)") { c ->
            (1..5).joinToString("|") { c.getString(it) ?: "null" }
        }
        val indexes = zeilen("PRAGMA index_list(`$table`)") { c -> c.getString(1) + "|" + c.getString(2) }
            .map { i -> i + zeilen("PRAGMA index_info(`${i.substringBefore('|')}`)") { c -> c.getString(2) } }
        return spalten + indexes.sorted()
    }

    /** Eine leere Datenbank genau nach dem eingecheckten Schema der Fassung [version]. */
    private fun afterSchema(db: SQLiteDatabase, version: Int) {
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
    fun `the checked-in schema of the newest version is the database's`() {
        val room = Room.inMemoryDatabaseBuilder(context, InventoryDatabase::class.java).allowMainThreadQueries().build()
        try {
            val echt = room.openHelper.writableDatabase
            val neueste = versions().last()
            assertEquals("Für die Fassung der Datenbank fehlt das eingecheckte Schema", echt.version, neueste)
            val soll = SQLiteDatabase.create(null)
            afterSchema(soll, neueste)
            val tables = schema(neueste)["entities"]!!.jsonArray.map { it.jsonObject["tableName"]!!.jsonPrimitive.content }
            assertTrue(tables.containsAll(listOf("bestand", "bestand_stand", "ausgang")))
            for (t in tables) {
                assertEquals("das eingecheckte Schema weicht bei `$t` von der Datenbank ab",
                    setup({ soll.rawQuery(it, null) }, t), setup({ echt.query(it) }, t))
            }
            assertEquals(neueste, schema(neueste)["version"]!!.jsonPrimitive.int)
            soll.close()
        } finally {
            room.close()
        }
    }

    @Test
    fun `every earlier version becomes the newest without loss, every item has its own key, every row its filters`() {
        val frueher = versions().dropLast(1)
        assertTrue("Mindestens Fassung 1 muss eingecheckt sein", 1 in frueher)
        for (v in frueher) {
            val name = "migration-$v.db"
            context.deleteDatabase(name)
            SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath(name).apply { parentFile?.mkdirs() }, null).use { alt ->
                afterSchema(alt, v)
                // Ab Fassung 2 trägt jeder Posten seinen Schlüssel schon (Migration 1→2 oder beim Schreiben).
                for (n in 1..2) {
                    // So, wie jede bisherige Fassung der App einen Posten schrieb (Ausgangsform Fassung 1).
                    val b = """{"type":"set_menge","setNumber":"1000$n-1","schritt":$n}"""
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
            val room = Room.databaseBuilder(context, InventoryDatabase::class.java, name)
                .addMigrations(*InventoryDatabase.MIGRATIONS).allowMainThreadQueries().build()
            try {
                val posten = runBlocking { RoomExit(room).alle("a") }
                assertEquals("Fassung $v: der Ausgang ist vollständig und in Reihenfolge",
                    listOf(Editing.SetMenge("10001-1", 1), Editing.SetMenge("10002-1", 2)), posten.map { it.bearbeitung })
                assertTrue("Fassung $v: jeder Posten hat einen Schlüssel", posten.all { it.schluessel.length == 36 })
                assertEquals("Fassung $v: jeder Posten hat einen eigenen Schlüssel", 2, posten.map { it.schluessel }.toSet().size)
                val bestand = RoomInventory(room)
                assertEquals("Fassung $v: die lesbare Liste bleibt, die unlesbare Zeile geht",
                    listOf("10002-1"), runBlocking { bestand.lies("a", StockKind.SETS) }.liste.map { it.schluessel })
                for (f in listOf(Filterspalten(thema = "City"), Filterspalten(lagerort = "Kiste 2"), Filterspalten(suchtext = "POLIZEI")))
                    assertEquals("Fassung $v: die Filterspalten sind aus dem JSON gefüllt ($f)", listOf("10002-1"),
                        runBlocking { bestand.filtere("a", StockKind.SETS, f) }.liste.map { it.schluessel })
            } finally {
                room.close()
                context.deleteDatabase(name)
            }
        }
    }
}
