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
 * A row of a local list: the server model as JSON ([content]) and
 * next to it the columns the server filters by. Without network the
 * same query answers the search here; a new display field still needs no
 * migration, only a new filter does.
 */
@Entity(tableName = "stock", primaryKeys = ["area", "kind", "key"])
internal data class InventoryRow(
    val area: String,
    val kind: String,
    val key: String,
    val position: Int,
    val content: String,
    @ColumnInfo(defaultValue = "''") val searchText: String = "",
    val theme: String? = null,
    val storageLocation: String? = null,
    val color: String? = null,
    val category: String? = null,
    val sparePart: Boolean? = null,
    val condition: String? = null,
)

/** When the server last delivered a list — for „Offline – Stand von …“. */
@Entity(tableName = "stock_state", primaryKeys = ["area", "kind"])
internal data class InventoryStatus(val area: String, val kind: String, val state: Long)

/**
 * An outbox item; [id] rises and is the order of sending.
 * [key] is the item's Idempotency-Key (since version 2).
 */
@Entity(tableName = "outbox", indices = [Index("area")])
internal data class OutboxRow(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val area: String,
    val editing: String,
    val created: Long,
    val attempts: Int = 0,
    @ColumnInfo(defaultValue = "''") val key: String,
)

@Dao
internal abstract class InventoryDao {
    @Query("SELECT * FROM stock WHERE area = :area AND kind = :kind ORDER BY position")
    abstract fun observe(area: String, kind: String): Flow<List<InventoryRow>>

    @Query("SELECT * FROM stock WHERE area = :area AND kind = :kind ORDER BY position")
    abstract suspend fun read(area: String, kind: String): List<InventoryRow>

    /** The filters as at the server; a null parameter does not restrict. [search] is a LIKE pattern. */
    @Query("""SELECT * FROM stock WHERE area = :area AND kind = :kind
        AND (:search IS NULL OR searchText LIKE :search ESCAPE '\')
        AND (:theme IS NULL OR theme = :theme) AND (:storageLocation IS NULL OR storageLocation = :storageLocation)
        AND (:color IS NULL OR color = :color) AND (:category IS NULL OR category = :category)
        AND (:sparePart IS NULL OR sparePart = :sparePart) AND (:condition IS NULL OR condition = :condition)
        ORDER BY position""")
    abstract suspend fun filter(
        area: String, kind: String, search: String?, theme: String?, storageLocation: String?,
        color: String?, category: String?, sparePart: Boolean?, condition: String?,
    ): List<InventoryRow>

    @Query("SELECT state FROM stock_state WHERE area = :area AND kind = :kind")
    abstract fun observeStatus(area: String, kind: String): Flow<Long?>

    @Query("SELECT state FROM stock_state WHERE area = :area AND kind = :kind")
    abstract suspend fun state(area: String, kind: String): Long?

    @Query("DELETE FROM stock WHERE area = :area AND kind = :kind")
    abstract suspend fun deleteList(area: String, kind: String)

    @Insert
    abstract suspend fun addOne(rows: List<InventoryRow>)

    @Update
    abstract suspend fun refresh(rows: List<InventoryRow>)

    @Query("DELETE FROM stock WHERE area = :area AND kind = :kind AND `key` IN (:key)")
    abstract suspend fun deleteKeys(area: String, kind: String, key: List<String>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    abstract suspend fun setStatus(state: InventoryStatus)

    /** All or nothing: a reader never sees a half-replaced list. */
    @Transaction
    open suspend fun replace(area: String, kind: String, rows: List<InventoryRow>, state: Long?) {
        deleteList(area, kind)
        addOne(rows)
        if (state != null) setStatus(InventoryStatus(area, kind, state))
    }

    /**
     * Bring the list to [rows] while writing only differences: a local
     * edit usually changes one row, not hundreds. Positions see [positions].
     */
    @Transaction
    open suspend fun syncRows(area: String, kind: String, rows: List<InventoryRow>) {
        val old = read(area, kind).associateBy { it.key }
        val pos = positions(old.mapValues { it.value.position }, rows.map { it.key })
        val newValue = rows.mapIndexed { i, z -> z.copy(position = pos[i]) }
        val gone = old.keys - newValue.map { it.key }.toSet()
        if (gone.isNotEmpty()) deleteKeys(area, kind, gone.toList())
        val (known, fresh) = newValue.filter { old[it.key] != it }.partition { it.key in old }
        if (known.isNotEmpty()) refresh(known)
        if (fresh.isNotEmpty()) addOne(fresh)
    }

    @Query("DELETE FROM stock WHERE area != :area")
    abstract suspend fun deleteOtherRows(area: String)

    @Query("DELETE FROM stock_state WHERE area != :area")
    abstract suspend fun deleteOtherStates(area: String)

    @Query("DELETE FROM stock")
    abstract suspend fun emptyRows()

    @Query("DELETE FROM stock_state")
    abstract suspend fun emptyStates()
}

@Dao
internal interface OutboxDao {
    @Query("SELECT COUNT(*) FROM outbox WHERE area = :area")
    fun count(area: String): Flow<Int>

    @Insert
    suspend fun addOne(row: OutboxRow): Long

    @Query("SELECT * FROM outbox WHERE area = :area ORDER BY id")
    suspend fun all(area: String): List<OutboxRow>

    @Query("DELETE FROM outbox WHERE id = :id")
    suspend fun remove(id: Long)

    @Query("UPDATE outbox SET attempts = attempts + 1 WHERE id = :id")
    suspend fun attemptFailed(id: Long)

    @Query("DELETE FROM outbox")
    suspend fun empty()
}

/**
 * Whoever changes the schema raises the version, writes a migration and checks in
 * the schema from core-offline/schemas: the outbox carries changes that exist only
 * here — a destructive fresh start would lose them.
 */
@Database(entities = [InventoryRow::class, InventoryStatus::class, OutboxRow::class], version = 4, exportSchema = true)
internal abstract class InventoryDatabase : RoomDatabase() {
    abstract fun stock(): InventoryDao
    abstract fun outbox(): OutboxDao

    companion object {
        const val NAME = "bestand.db"

        /** All migrations, in the order of the versions. */
        val MIGRATIONS: Array<Migration> = arrayOf(MIGRATION_1_2, MIGRATION_2_3, MIGRATION_3_4)
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
 * sync. Reading goes via [ColumnsVersion2], never via today's
 * models; an unreadable row would be dropped on reading anyway, here it goes right away.
 */
internal val MIGRATION_2_3 = object : Migration(2, 3) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE `bestand` ADD COLUMN `suchtext` TEXT NOT NULL DEFAULT ''")
        for (column in listOf("thema", "lagerort", "farbe", "kategorie")) db.execSQL("ALTER TABLE `bestand` ADD COLUMN `$column` TEXT")
        db.execSQL("ALTER TABLE `bestand` ADD COLUMN `ersatzteil` INTEGER")
        db.execSQL("ALTER TABLE `bestand` ADD COLUMN `zustand` TEXT")
        val rows = mutableListOf<Array<String>>()
        db.query("SELECT bereich, art, schluessel, inhalt FROM `bestand`").use { c ->
            while (c.moveToNext()) rows += Array(4) { c.getString(it) }
        }
        for ((area, kind, key, content) in rows) {
            val limit = arrayOf<Any?>(area, kind, key)
            val m = ColumnsVersion2.from(kind, content)
            if (m == null) db.execSQL("DELETE FROM `bestand` WHERE bereich = ? AND art = ? AND schluessel = ?", limit)
            else db.execSQL("UPDATE `bestand` SET suchtext = ?, thema = ?, lagerort = ?, farbe = ?, kategorie = ?, " +
                "ersatzteil = ?, zustand = ? WHERE bereich = ? AND art = ? AND schluessel = ?",
                arrayOf<Any?>(m.searchText.orEmpty(), m.theme, m.storageLocation, m.color, m.category, m.sparePart?.let { if (it) 1 else 0 },
                    m.condition, *limit))
        }
    }
}

/**
 * 3 → 4: tables, columns and list kinds get English names. Renaming keeps every row,
 * the outbox order (id) and the defaults; the outbox index is rebuilt under Room's new name.
 * The names of version 3 stay literal here: a migration must not follow later renames.
 */
internal val MIGRATION_3_4 = object : Migration(3, 4) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("DROP INDEX IF EXISTS `index_ausgang_bereich`")
        for ((table, columns) in COLUMNS_RENAMED_IN_4) {
            for ((old, new) in columns) db.execSQL("ALTER TABLE `$table` RENAME COLUMN `$old` TO `$new`")
            db.execSQL("ALTER TABLE `$table` RENAME TO `${TABLES_RENAMED_IN_4.getValue(table)}`")
        }
        db.execSQL("CREATE INDEX IF NOT EXISTS `index_outbox_area` ON `outbox` (`area`)")
        for (table in listOf("stock", "stock_state")) {
            for ((old, new) in KINDS_RENAMED_IN_4) db.execSQL("UPDATE `$table` SET `kind` = ? WHERE `kind` = ?", arrayOf<Any>(new, old))
        }
    }
}

internal val TABLES_RENAMED_IN_4 = mapOf("bestand" to "stock", "bestand_stand" to "stock_state", "ausgang" to "outbox")

internal val COLUMNS_RENAMED_IN_4: Map<String, List<Pair<String, String>>> = mapOf(
    "bestand" to listOf(
        "bereich" to "area", "art" to "kind", "schluessel" to "key", "inhalt" to "content", "suchtext" to "searchText",
        "thema" to "theme", "lagerort" to "storageLocation", "farbe" to "color", "kategorie" to "category",
        "ersatzteil" to "sparePart", "zustand" to "condition",
    ),
    "bestand_stand" to listOf("bereich" to "area", "art" to "kind", "stand" to "state"),
    "ausgang" to listOf(
        "bereich" to "area", "bearbeitung" to "editing", "erstellt" to "created", "versuche" to "attempts", "schluessel" to "key",
    ),
)

/** The column `kind` holds the name of the list kind (StockKind); version 3 wrote the former names. */
internal val KINDS_RENAMED_IN_4 = listOf(
    "MERKLISTE" to "WANTED_LIST", "TEILE" to "PARTS", "FIGUREN" to "FIGURES", "MANUELLE_TEILE" to "MANUAL_PARTS",
    "MANUELLE_FIGUREN" to "MANUAL_FIGURES", "GUTSCHEINE" to "VOUCHERS", "PREISALARME" to "PRICE_ALARMS",
    "LAGERORTE" to "STORAGE_LOCATIONS", "KENNZAHLEN" to "METRICS", "KATALOG_META" to "CATALOG_META",
)
