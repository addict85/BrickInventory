package ch.brickinventoryapp.offline

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import ch.brickinventoryapp.model.local.StockKind
import ch.brickinventoryapp.offline.room.InventoryDatabase
import ch.brickinventoryapp.offline.room.RoomInventory
import ch.brickinventoryapp.offline.room.RoomOutbox
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
 * The checked-in Room schema (core-offline/schemas) matches the database, and every
 * earlier version becomes the newest with the migrations without the outbox
 * losing anything. An older database is built from its checked-in
 * schema — like MigrationTestHelper, without room-testing as a further
 * dependency. Runs only in CI (Room needs Android).
 *
 * Counter-checks are measured by the CI job `counter-checks` (Android-App/counter-checks/, it
 * requires red): bestand-migration-entfernt, -spalte-falsch, -ohne-schluessel,
 * -ohne-filterspalten (2 → 3 does not fill the filter columns). How 2 → 3 reads version-2 JSON
 * is checked by ColumnsVersion2Test without Android.
 * Counter-checks for 3 → 4 (Robolectric, local): the loop over KINDS_RENAMED_IN_4 left out →
 * red „version 3 becomes 4 …“ (the row keeps kind TEILE); the pair "versuche" to "attempts"
 * left out → both tests red („Migration didn't properly handle: outbox“).
 * A change to the schema of the newest version is no use as a counter-check: Room
 * rewrites it when compiling.
 */
@RunWith(RobolectricTestRunner::class)
class StockMigrationTest {

    private val context: Context = ApplicationProvider.getApplicationContext()
    private val folder = File("schemas/${InventoryDatabase::class.java.name}")

    private fun schema(version: Int): JsonObject =
        Json.parseToJsonElement(File(folder, "$version.json").readText()).jsonObject["database"]!!.jsonObject

    private fun versions(): List<Int> =
        folder.listFiles().orEmpty().mapNotNull { it.name.removeSuffix(".json").toIntOrNull() }.sorted()

    /** Columns and indices of a table, as SQLite reports them. */
    private fun setup(query: (String) -> Cursor, table: String): List<String> {
        fun rows(sql: String, f: (Cursor) -> String) = query(sql).use { c ->
            buildList { while (c.moveToNext()) add(f(c)) }
        }
        val columns = rows("PRAGMA table_info(`$table`)") { c ->
            (1..5).joinToString("|") { c.getString(it) ?: "null" }
        }
        val indexes = rows("PRAGMA index_list(`$table`)") { c -> c.getString(1) + "|" + c.getString(2) }
            .map { i -> i + rows("PRAGMA index_info(`${i.substringBefore('|')}`)") { c -> c.getString(2) } }
        return columns + indexes.sorted()
    }

    /** An empty database exactly by the checked-in schema of version [version]. */
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
            val real = room.openHelper.writableDatabase
            val newest = versions().last()
            assertEquals("the checked-in schema is missing for the database version", real.version, newest)
            val should = SQLiteDatabase.create(null)
            afterSchema(should, newest)
            val tables = schema(newest)["entities"]!!.jsonArray.map { it.jsonObject["tableName"]!!.jsonPrimitive.content }
            assertTrue(tables.containsAll(listOf("stock", "stock_state", "outbox")))
            for (t in tables) {
                assertEquals("the checked-in schema differs from the database at `$t`",
                    setup({ should.rawQuery(it, null) }, t), setup({ real.query(it) }, t))
            }
            assertEquals(newest, schema(newest)["version"]!!.jsonPrimitive.int)
            should.close()
        } finally {
            room.close()
        }
    }

    @Test
    fun `every earlier version becomes the newest without loss, every item has its own key, every row its filters`() {
        val earlier = versions().dropLast(1)
        assertTrue("at least version 1 must be checked in", 1 in earlier)
        for (v in earlier) {
            val name = "migration-$v.db"
            context.deleteDatabase(name)
            SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath(name).apply { parentFile?.mkdirs() }, null).use { old ->
                afterSchema(old, v)
                // From version 2 on every item already carries its key (migration 1→2 or when writing).
                for (n in 1..2) {
                    // The way every previous version of the app wrote an item (outbox form version 1).
                    val b = """{"type":"set_menge","setNumber":"1000$n-1","schritt":$n}"""
                    if (v >= 2) old.execSQL(
                        "INSERT INTO ausgang (bereich, bearbeitung, erstellt, versuche, schluessel) VALUES ('a', ?, $n, 0, ?)",
                        arrayOf(b, UUID.randomUUID().toString()))
                    else old.execSQL("INSERT INTO ausgang (bereich, bearbeitung, erstellt, versuche) VALUES ('a', ?, $n, 0)", arrayOf(b))
                }
                // Fixed sample of version 2 instead of SetItem: the migration must not hang on today's model.
                val set = """{"set_number":"10002-1","name":"Polizeiwache","theme":"City","storage":"Kiste 2","conditions":[]}"""
                if (v >= 3) old.execSQL("INSERT INTO bestand (bereich, art, schluessel, position, inhalt, suchtext, thema, lagerort) " +
                    "VALUES ('a', 'SETS', '10002-1', 0, ?, '10002-1 polizeiwache', 'City', 'Kiste 2')", arrayOf(set))
                else old.execSQL("INSERT INTO bestand (bereich, art, schluessel, position, inhalt) VALUES ('a', 'SETS', '10002-1', 0, ?)",
                    arrayOf(set))
                // Only 2 → 3 drops an unreadable row; version 3 never wrote one.
                if (v < 3) old.execSQL("INSERT INTO bestand (bereich, art, schluessel, position, inhalt) VALUES ('a', 'SETS', 'kaputt', 1, '{}')")
            }
            val room = Room.databaseBuilder(context, InventoryDatabase::class.java, name)
                .addMigrations(*InventoryDatabase.MIGRATIONS).allowMainThreadQueries().build()
            try {
                val item = runBlocking { RoomOutbox(room).all("a") }
                assertEquals("version $v: the outbox is complete and in order",
                    listOf(Editing.SetQuantity("10001-1", 1), Editing.SetQuantity("10002-1", 2)), item.map { it.editing })
                assertTrue("version $v: every item has a key", item.all { it.key.length == 36 })
                assertEquals("version $v: every item has a key of its own", 2, item.map { it.key }.toSet().size)
                val stock = RoomInventory(room)
                assertEquals("version $v: the readable list stays, the unreadable row goes",
                    listOf("10002-1"), runBlocking { stock.read("a", StockKind.SETS) }.list.map { it.key })
                for (f in listOf(FilterColumns(theme = "City"), FilterColumns(storageLocation = "Kiste 2"), FilterColumns(searchText = "POLIZEI")))
                    assertEquals("version $v: the filter columns are filled from the JSON ($f)", listOf("10002-1"),
                        runBlocking { stock.filter("a", StockKind.SETS, f) }.list.map { it.key })
            } finally {
                room.close()
                context.deleteDatabase(name)
            }
        }
    }

    @Test
    fun `version 3 becomes 4 with every column, list kind, state and outbox item of its rows`() {
        val name = "migration-3-4.db"
        context.deleteDatabase(name)
        SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath(name).apply { parentFile?.mkdirs() }, null).use { old ->
            afterSchema(old, 3)
            old.execSQL("INSERT INTO bestand (bereich, art, schluessel, position, inhalt, suchtext, thema, lagerort, farbe, kategorie, " +
                "ersatzteil, zustand) VALUES ('a', 'TEILE', '3001/5', 7, ?, '3001 brick 2 x 4', NULL, 'Kiste 1', 'Red', 'Bricks', 1, 'U')",
                arrayOf(PART))
            old.execSQL("INSERT INTO bestand_stand (bereich, art, stand) VALUES ('a', 'TEILE', 1700000000000)")
            old.execSQL("INSERT INTO ausgang (id, bereich, bearbeitung, erstellt, versuche, schluessel) VALUES (5, 'a', ?, 42, 2, 'k-5')",
                arrayOf(EDIT))
        }
        val room = Room.databaseBuilder(context, InventoryDatabase::class.java, name)
            .addMigrations(*InventoryDatabase.MIGRATIONS).allowMainThreadQueries().build()
        try {
            val db = room.openHelper.writableDatabase
            fun row(sql: String) = db.query(sql).use { c ->
                assertTrue("no row for $sql", c.moveToFirst())
                (0 until c.columnCount).map { c.getString(it) }
            }
            assertEquals(listOf("a", "PARTS", "3001/5", "7", PART, "3001 brick 2 x 4", null, "Kiste 1", "Red", "Bricks", "1", "U"),
                row("SELECT area, kind, `key`, position, content, searchText, theme, storageLocation, color, category, sparePart, " +
                    "condition FROM stock"))
            assertEquals(listOf("a", "PARTS", "1700000000000"), row("SELECT area, kind, state FROM stock_state"))
            assertEquals(listOf("5", "a", EDIT, "42", "2", "k-5"), row("SELECT id, area, editing, created, attempts, `key` FROM outbox"))
            val parts = runBlocking { RoomInventory(room).read("a", StockKind.PARTS) }
            assertEquals("the list is readable under its new kind", listOf("3001/5"), parts.list.map { it.key })
            assertEquals(1700000000000, parts.state)
        } finally {
            room.close()
            context.deleteDatabase(name)
        }
    }

    private companion object {
        const val PART = """{"part_number":"3001","color_id":5,"part_name":"Brick 2 x 4","total_quantity":3}"""
        const val EDIT = """{"type":"set_menge","setNumber":"10001-1","schritt":1}"""
    }
}
