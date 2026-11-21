package ch.brickinventoryapp.offline.room

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.Transaction
import androidx.room.Update
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.flow.Flow
import java.util.UUID

/**
 * A row of a local list: the server model as JSON ([inhalt]) and
 * next to it the columns the server filters by. Without network the
 * same query answers the search here; a new display field still needs no
 * migration, only a new filter does.
 */
@Entity(tableName = "bestand", primaryKeys = ["bereich", "art", "schluessel"])
internal data class InventoryRow(
    val bereich: String,
    val art: String,
    val schluessel: String,
    val position: Int,
    val inhalt: String,
    @ColumnInfo(defaultValue = "''") val suchtext: String = "",
    val thema: String? = null,
    val lagerort: String? = null,
    val farbe: String? = null,
    val kategorie: String? = null,
    val ersatzteil: Boolean? = null,
    val zustand: String? = null,
)

/** When the server last delivered a list — for „Offline – Stand von …“. */
@Entity(tableName = "bestand_stand", primaryKeys = ["bereich", "art"])
internal data class InventoryStatus(val bereich: String, val art: String, val stand: Long)

/**
 * An outbox item; [id] rises and is the order of sending.
 * [schluessel] is the item's Idempotency-Key (since version 2).
 */
@Entity(tableName = "ausgang", indices = [Index("bereich")])
internal data class ExitRow(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val bereich: String,
    val bearbeitung: String,
    val erstellt: Long,
    val versuche: Int = 0,
    @ColumnInfo(defaultValue = "''") val schluessel: String,
)

@Dao
internal abstract class InventoryDao {
    @Query("SELECT * FROM bestand WHERE bereich = :bereich AND art = :art ORDER BY position")
    abstract fun observe(bereich: String, art: String): Flow<List<InventoryRow>>

    @Query("SELECT * FROM bestand WHERE bereich = :bereich AND art = :art ORDER BY position")
    abstract suspend fun lies(bereich: String, art: String): List<InventoryRow>

    /** The filters as at the server; a null parameter does not restrict. [suche] is a LIKE pattern. */
    @Query("""SELECT * FROM bestand WHERE bereich = :bereich AND art = :art
        AND (:suche IS NULL OR suchtext LIKE :suche ESCAPE '\')
        AND (:thema IS NULL OR thema = :thema) AND (:lagerort IS NULL OR lagerort = :lagerort)
        AND (:farbe IS NULL OR farbe = :farbe) AND (:kategorie IS NULL OR kategorie = :kategorie)
        AND (:ersatzteil IS NULL OR ersatzteil = :ersatzteil) AND (:zustand IS NULL OR zustand = :zustand)
        ORDER BY position""")
    abstract suspend fun filtere(
        bereich: String, art: String, suche: String?, thema: String?, lagerort: String?,
        farbe: String?, kategorie: String?, ersatzteil: Boolean?, zustand: String?,
    ): List<InventoryRow>

    @Query("SELECT stand FROM bestand_stand WHERE bereich = :bereich AND art = :art")
    abstract fun observeStatus(bereich: String, art: String): Flow<Long?>

    @Query("SELECT stand FROM bestand_stand WHERE bereich = :bereich AND art = :art")
    abstract suspend fun stand(bereich: String, art: String): Long?

    @Query("DELETE FROM bestand WHERE bereich = :bereich AND art = :art")
    abstract suspend fun deleteList(bereich: String, art: String)

    @Insert
    abstract suspend fun addOne(zeilen: List<InventoryRow>)

    @Update
    abstract suspend fun refresh(zeilen: List<InventoryRow>)

    @Query("DELETE FROM bestand WHERE bereich = :bereich AND art = :art AND schluessel IN (:schluessel)")
    abstract suspend fun deleteKeys(bereich: String, art: String, schluessel: List<String>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun setStatus(stand: InventoryStatus)

    /** All or nothing: a reader never sees a half-replaced list. */
    @Transaction
    open suspend fun ersetze(bereich: String, art: String, zeilen: List<InventoryRow>, stand: Long?) {
        deleteList(bereich, art)
        addOne(zeilen)
        if (stand != null) setStatus(InventoryStatus(bereich, art, stand))
    }

    /**
     * Bring the list to [zeilen] while writing only differences: a local
     * edit usually changes one row, not hundreds. Positions see [positionen].
     */
    @Transaction
    open suspend fun sameAn(bereich: String, art: String, zeilen: List<InventoryRow>) {
        val alt = lies(bereich, art).associateBy { it.schluessel }
        val pos = positionen(alt.mapValues { it.value.position }, zeilen.map { it.schluessel })
        val neu = zeilen.mapIndexed { i, z -> z.copy(position = pos[i]) }
        val weg = alt.keys - neu.map { it.schluessel }.toSet()
        if (weg.isNotEmpty()) deleteKeys(bereich, art, weg.toList())
        val (bekannt, frisch) = neu.filter { alt[it.schluessel] != it }.partition { it.schluessel in alt }
        if (bekannt.isNotEmpty()) refresh(bekannt)
        if (frisch.isNotEmpty()) addOne(frisch)
    }

    @Query("DELETE FROM bestand WHERE bereich != :bereich")
    abstract suspend fun deleteOtherRows(bereich: String)

    @Query("DELETE FROM bestand_stand WHERE bereich != :bereich")
    abstract suspend fun deleteOtherStates(bereich: String)

    @Query("DELETE FROM bestand")
    abstract suspend fun emptyRows()

    @Query("DELETE FROM bestand_stand")
    abstract suspend fun emptyStates()
}

@Dao
internal interface ExitDao {
    @Query("SELECT COUNT(*) FROM ausgang WHERE bereich = :bereich")
    fun anzahl(bereich: String): Flow<Int>

    @Insert
    suspend fun addOne(zeile: ExitRow): Long

    @Query("SELECT * FROM ausgang WHERE bereich = :bereich ORDER BY id")
    suspend fun alle(bereich: String): List<ExitRow>

    @Query("DELETE FROM ausgang WHERE id = :id")
    suspend fun entferne(id: Long)

    @Query("UPDATE ausgang SET versuche = versuche + 1 WHERE id = :id")
    suspend fun attemptFailed(id: Long)

    @Query("DELETE FROM ausgang")
    suspend fun leere()
}

/**
 * Whoever changes the schema raises the version, writes a migration and checks in
 * the schema from core-offline/schemas: the outbox carries changes that exist only
 * here — a destructive fresh start would lose them.
 */
@Database(entities = [InventoryRow::class, InventoryStatus::class, ExitRow::class], version = 3, exportSchema = true)
internal abstract class InventoryDatabase : RoomDatabase() {
    abstract fun bestand(): InventoryDao
    abstract fun ausgang(): ExitDao

    companion object {
        const val NAME = "bestand.db"

        /** All migrations, in the order of the versions. */
        val MIGRATIONS: Array<Migration> = arrayOf(MIGRATION_1_2, MIGRATION_2_3)
    }
}

/**
 * 1 → 2: every waiting item gets its Idempotency-Key. One that was already
 * sent once before the update carried none; from now on it has a
 * fixed one, so that its further attempts take effect only once at the server.
 */
internal val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE `ausgang` ADD COLUMN `schluessel` TEXT NOT NULL DEFAULT ''")
        val ids = mutableListOf<Long>()
        db.query("SELECT id FROM `ausgang`").use { c -> while (c.moveToNext()) ids += c.getLong(0) }
        for (id in ids) db.execSQL("UPDATE `ausgang` SET `schluessel` = ? WHERE id = ?", arrayOf<Any>(UUID.randomUUID().toString(), id))
    }
}

/**
 * 2 → 3: filter columns. The stored lists stay and get their values
 * from the JSON next to them — otherwise the search without network would find nothing until the next
 * sync. Reading goes via [ColumnsFassung2], never via today's
 * models; an unreadable row would be dropped on reading anyway, here it goes right away.
 */
internal val MIGRATION_2_3 = object : Migration(2, 3) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE `bestand` ADD COLUMN `suchtext` TEXT NOT NULL DEFAULT ''")
        for (column in listOf("thema", "lagerort", "farbe", "kategorie")) db.execSQL("ALTER TABLE `bestand` ADD COLUMN `$column` TEXT")
        db.execSQL("ALTER TABLE `bestand` ADD COLUMN `ersatzteil` INTEGER")
        db.execSQL("ALTER TABLE `bestand` ADD COLUMN `zustand` TEXT")
        val zeilen = mutableListOf<Array<String>>()
        db.query("SELECT bereich, art, schluessel, inhalt FROM `bestand`").use { c ->
            while (c.moveToNext()) zeilen += Array(4) { c.getString(it) }
        }
        for ((bereich, art, schluessel, inhalt) in zeilen) {
            val limit = arrayOf<Any?>(bereich, art, schluessel)
            val m = ColumnsFassung2.aus(art, inhalt)
            if (m == null) db.execSQL("DELETE FROM `bestand` WHERE bereich = ? AND art = ? AND schluessel = ?", limit)
            else db.execSQL("UPDATE `bestand` SET suchtext = ?, thema = ?, lagerort = ?, farbe = ?, kategorie = ?, " +
                "ersatzteil = ?, zustand = ? WHERE bereich = ? AND art = ? AND schluessel = ?",
                arrayOf<Any?>(m.suchtext.orEmpty(), m.thema, m.lagerort, m.farbe, m.kategorie, m.ersatzteil?.let { if (it) 1 else 0 },
                    m.zustand, *limit))
        }
    }
}
